import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, setSessionToken } from '../lib/api';
import type { Account, MarketData, Order, User } from '../types';

type AuthResponse = { user: User | null; demoEnabled?: boolean; token?: string };
type AppContextValue = {
  user: User | null;
  authLoading: boolean;
  demoEnabled: boolean;
  market?: MarketData;
  marketLoading: boolean;
  marketError: boolean;
  account?: Account;
  accountLoading: boolean;
  orders: Order[];
  ordersLoading: boolean;
  watchlist: string[];
  watchlistLoading: boolean;
  authMode: 'login' | 'register' | null;
  openAuth: (mode?: 'login' | 'register') => void;
  closeAuth: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  demoSignIn: () => Promise<void>;
  signOut: () => Promise<void>;
  toggleWatchlist: (symbol: string) => Promise<void>;
  refreshPrivate: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
  const authQuery = useQuery<AuthResponse>({ queryKey: ['auth'], queryFn: () => api('/auth/me'), staleTime: 60_000, retry: false });
  const user = authQuery.data?.user ?? null;
  const marketQuery = useQuery<MarketData>({ queryKey: ['market'], queryFn: () => api('/market'), refetchInterval: 60_000 });
  const accountQuery = useQuery<Account>({ queryKey: ['account'], queryFn: () => api('/account'), enabled: !!user });
  const ordersQuery = useQuery<{ orders: Order[] }>({ queryKey: ['orders'], queryFn: () => api('/orders'), enabled: !!user });
  const watchlistQuery = useQuery<{ symbols: string[] }>({ queryKey: ['watchlist'], queryFn: () => api('/watchlist'), enabled: !!user });

  useEffect(() => {
    const onUnauthorized = () => {
      const current = queryClient.getQueryData<AuthResponse>(['auth']);
      if (!current?.user) return;
      setSessionToken(null);
      queryClient.setQueryData(['auth'], { ...current, user: null });
      queryClient.removeQueries({ queryKey: ['account'] });
      queryClient.removeQueries({ queryKey: ['orders'] });
      queryClient.removeQueries({ queryKey: ['watchlist'] });
      toast.error('Your session has ended. Please sign in again.');
    };
    window.addEventListener('northstar:unauthorized', onUnauthorized);
    return () => window.removeEventListener('northstar:unauthorized', onUnauthorized);
  }, [queryClient]);

  useEffect(() => {
    const source = new EventSource('/api/market/stream');
    let lastPrivateRefresh = Date.now();
    source.addEventListener('quotes', event => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as MarketData;
        queryClient.setQueryData(['market'], data);
        // Limit orders may fill on a price tick. Refresh account data periodically as well.
        if (Date.now() - lastPrivateRefresh > 15_000) {
          lastPrivateRefresh = Date.now();
          queryClient.invalidateQueries({ queryKey: ['account'] });
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        }
      } catch { /* A malformed stream event should not break the workspace. */ }
    });
    return () => source.close();
  }, [queryClient]);

  const refreshPrivate = () => {
    queryClient.invalidateQueries({ queryKey: ['account'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['watchlist'] });
  };

  // The sign-in response alone does not prove the session survived: an embedded (cross-site) page
  // can have its session cookie dropped by the browser, which would sign the account straight back
  // out on the next request. Confirm with the server, and fall back to the returned bearer token.
  const finishSignIn = async (result: AuthResponse) => {
    let confirmed = await api<AuthResponse>('/auth/me').catch(() => null);
    if (confirmed && !confirmed.user && result.token) {
      setSessionToken(result.token);
      confirmed = await api<AuthResponse>('/auth/me').catch(() => null);
    }
    if (confirmed && !confirmed.user) {
      setSessionToken(null);
      throw new ApiError('This browser is blocking sign-in storage for this page. Open the app in its own browser tab and try again.', 401);
    }
    const user = confirmed?.user ?? result.user;
    queryClient.setQueryData(['auth'], { user, demoEnabled: confirmed?.demoEnabled ?? authQuery.data?.demoEnabled });
    refreshPrivate();
    setAuthMode(null);
    toast.success(`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}!`);
  };

  const signIn = async (email: string, password: string) => {
    await finishSignIn(await api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
  };
  const signUp = async (name: string, email: string, password: string) => {
    await finishSignIn(await api<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }));
  };
  const demoSignIn = async () => {
    await finishSignIn(await api<AuthResponse>('/auth/demo', { method: 'POST' }));
  };
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' });
    setSessionToken(null);
    queryClient.setQueryData(['auth'], { user: null, demoEnabled: authQuery.data?.demoEnabled });
    queryClient.removeQueries({ queryKey: ['account'] });
    queryClient.removeQueries({ queryKey: ['orders'] });
    queryClient.removeQueries({ queryKey: ['watchlist'] });
    toast.success('You have signed out.');
  };
  const toggleWatchlist = async (symbol: string) => {
    if (!user) { setAuthMode('login'); return; }
    const saved = (watchlistQuery.data?.symbols || []).includes(symbol);
    try {
      await api(`/watchlist/${symbol}`, { method: saved ? 'DELETE' : 'PUT' });
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      toast.success(saved ? `${symbol} removed from watchlist` : `${symbol} added to watchlist`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update watchlist.');
    }
  };

  return <AppContext.Provider value={{
    user, authLoading: authQuery.isLoading, demoEnabled: authQuery.data?.demoEnabled ?? false,
    market: marketQuery.data, marketLoading: marketQuery.isLoading, marketError: marketQuery.isError,
    account: user ? accountQuery.data : undefined, accountLoading: accountQuery.isLoading,
    orders: user ? ordersQuery.data?.orders ?? [] : [], ordersLoading: ordersQuery.isLoading,
    watchlist: user ? watchlistQuery.data?.symbols ?? [] : [], watchlistLoading: watchlistQuery.isLoading, authMode,
    openAuth: (mode = 'login') => setAuthMode(mode), closeAuth: () => setAuthMode(null),
    signIn, signUp, demoSignIn, signOut, toggleWatchlist, refreshPrivate,
  }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
