import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Bell, BriefcaseBusiness, ChevronDown, CircleHelp, Command, Compass,
  LayoutDashboard, Lightbulb, LogOut, Menu, Plus, ReceiptText, Repeat2, Search, ShieldCheck,
  Sparkles, Star, TrendingUp, X,
} from 'lucide-react';
import { AppProvider, useApp } from './state/AppContext';
import { AssetLogo, LoadingBlock } from './components/UI';
import { AccountSwitchButton, AccountTypeLabel, DemoBanner } from './components/AccountSwitcher';
import { AuthModal } from './components/AuthModal';
import { OverviewPage } from './pages/OverviewPage';

// Load secondary workspaces only when visited; the overview stays immediately available.
const MarketsPage = lazy(() => import('./pages/MarketsPage').then(module => ({ default: module.MarketsPage })));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage').then(module => ({ default: module.PortfolioPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then(module => ({ default: module.OrdersPage })));
const WatchlistPage = lazy(() => import('./pages/WatchlistPage').then(module => ({ default: module.WatchlistPage })));
const InsightsPage = lazy(() => import('./pages/InsightsPage').then(module => ({ default: module.InsightsPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(module => ({ default: module.AdminPage })));
import { initials, shortDate } from './lib/api';

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/markets', label: 'Markets', icon: TrendingUp },
  { to: '/portfolio', label: 'Portfolio', icon: BriefcaseBusiness },
  { to: '/orders', label: 'Orders', icon: ReceiptText },
  { to: '/watchlist', label: 'Watchlist', icon: Star },
];
const pageTitles: Record<string, string> = {
  '/': 'Overview', '/markets': 'Markets', '/portfolio': 'Portfolio', '/orders': 'Orders',
  '/watchlist': 'Watchlist', '/insights': 'Insights', '/admin': 'Admin console',
};

function Brand() {
  return <NavLink to="/" className="brand" aria-label="Northstar home">
    <span className="brand-mark"><Sparkles size={23} strokeWidth={2.3} /></span>
    <span className="brand-word">northstar<span>.</span></span>
  </NavLink>;
}

function Sidebar({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (value: boolean) => void }) {
  const { user, openAuth, signOut } = useApp();
  const navigate = useNavigate();
  const close = () => setMobileOpen(false);
  const logout = async () => { await signOut(); navigate('/'); close(); };
  const navItem = ({ to, label, icon: Icon }: (typeof navigation)[number]) =>
    <NavLink key={to} to={to} end={to === '/'} onClick={close} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link--active' : ''}`}>
      <Icon size={19} strokeWidth={1.9} /><span>{label}</span>
    </NavLink>;
  return <>
    {mobileOpen && <div className="sidebar-overlay" onClick={close} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
      <div className="sidebar-top"><Brand /><button className="sidebar-mobile-close icon-button" onClick={close} aria-label="Close navigation"><X size={19} /></button></div>
      <div className="sidebar-navigation">
        <div className="sidebar-group-label">WORKSPACE</div>
        <nav aria-label="Main navigation">{navigation.map(navItem)}</nav>
        <div className="sidebar-group-label sidebar-group-label--second">DISCOVER</div>
        <nav aria-label="Discover">
          <NavLink to="/insights" onClick={close} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link--active' : ''}`}><Lightbulb size={19} strokeWidth={1.9} /><span>Insights</span></NavLink>
          {user?.role === 'admin' && <NavLink to="/admin" onClick={close} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link--active' : ''}`}><ShieldCheck size={19} strokeWidth={1.9} /><span>Admin console</span></NavLink>}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-help-card">
          <span className="sidebar-help-icon"><Compass size={21} /></span>
          <strong>Find your footing.</strong>
          <p>Explore markets and build confidence with virtual funds.</p>
          <NavLink to="/insights" onClick={close}>Trading essentials <ArrowRight size={14} /></NavLink>
        </div>
        {user ? <div className="sidebar-account">
          <span className="sidebar-avatar">{initials(user.name)}</span>
          <span className="sidebar-account-copy"><strong>{user.name}</strong><small>{user.isDemo ? 'Shared demo account' : user.role === 'admin' ? 'Administrator' : 'Paper trading account'}</small></span>
          <button onClick={logout} className="sidebar-logout" title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>
          {user && <div className="sidebar-account-switch"><AccountSwitchButton /></div>}
        </div> : <button className="sidebar-signin" onClick={() => { openAuth('register'); close(); }}><Plus size={17} /> Create an account <ArrowRight size={16} /></button>}
        <div className="sidebar-legal">© {new Date().getFullYear()} Northstar · Trading simulator</div>
      </div>
    </aside>
  </>;
}

function Header({ onMenu }: { onMenu: () => void }) {
  const { user, market, openAuth, signOut, switchTarget, switchAccount, switchingAccount } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = search.trim() ? (market?.assets || []).filter(asset => `${asset.symbol} ${asset.name}`.toLowerCase().includes(search.toLowerCase())).slice(0, 6) : [];

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); inputRef.current?.focus(); }
      if (event.key === 'Escape') { setSearchFocused(false); setNotificationsOpen(false); setProfileOpen(false); inputRef.current?.blur(); }
    };
    const outside = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchFocused(false);
      if (!notificationRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('keydown', keyDown);
    document.addEventListener('mousedown', outside);
    return () => { document.removeEventListener('keydown', keyDown); document.removeEventListener('mousedown', outside); };
  }, []);

  const selectAsset = (symbol: string) => { navigate(`/markets?symbol=${symbol}`); setSearch(''); setSearchFocused(false); inputRef.current?.blur(); };
  const logout = async () => { setProfileOpen(false); await signOut(); navigate('/'); };
  return <header className="topbar">
    <div className="topbar-left">
      <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={onMenu}><Menu size={22} /></button>
      <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{pageTitles[location.pathname] || 'Overview'}</strong></div>
    </div>
    <div className="topbar-search" ref={searchRef}>
      <Search size={18} className="search-icon" />
      <input ref={inputRef} type="search" placeholder="Search companies or symbols..." aria-label="Search assets" value={search} onChange={event => { setSearch(event.target.value); setSearchFocused(true); }} onFocus={() => setSearchFocused(true)} onKeyDown={event => { if (event.key === 'Enter' && results[0]) selectAsset(results[0].symbol); }} />
      <kbd><Command size={12} /> K</kbd>
      {searchFocused && search && <div className="search-popover">
        <div className="popover-label">ASSETS</div>
        {results.length ? results.map(asset => <button key={asset.symbol} className="search-result" onClick={() => selectAsset(asset.symbol)}>
          <AssetLogo asset={asset} size="sm" /><span><strong>{asset.symbol}</strong><small>{asset.name}</small></span><ArrowRight size={15} />
        </button>) : <div className="search-empty">No matching assets found.</div>}
      </div>}
    </div>
    <div className="topbar-actions">
      <span className={`market-status ${market?.marketStatus.isOpen ? 'market-status--open' : ''}`} title="Indicative US regular-session hours, excluding holidays"><i />{market?.marketStatus.label || 'Checking market'}</span>
      <span className={`data-mode ${market?.mode === 'live' ? 'data-mode--live' : ''}`} title={market?.mode === 'demo' ? 'Prices are simulated for practice' : `Real market data from ${market?.provider}. Quotes may be delayed.`}>{market?.mode === 'demo' ? 'Demo prices' : market?.mode === 'mixed' ? 'Mixed prices' : `Live · ${market?.provider}`}</span>
      <div className="popover-anchor" ref={notificationRef}>
        <button className="topbar-icon icon-button" aria-label="Announcements" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen(!notificationsOpen); setProfileOpen(false); }}><Bell size={20} /><span className="notification-dot" /></button>
        {notificationsOpen && <div className="header-popover notices-popover"><div className="popover-title">Announcements <span>{market?.notices.length || 0}</span></div>
          {market?.notices.length ? market.notices.map(notice => <div className="notice-item" key={notice.id}><div className="notice-indicator"><Sparkles size={15} /></div><div><strong>{notice.title}</strong><p>{notice.body}</p><small>{shortDate(notice.createdAt)}</small></div></div>) : <p className="popover-empty">You're all caught up.</p>}
        </div>}
      </div>
      <AccountSwitchButton className="account-switch--header" />
      {user ? <div className="popover-anchor" ref={profileRef}>
        <button className="topbar-profile" onClick={() => { setProfileOpen(!profileOpen); setNotificationsOpen(false); }} aria-expanded={profileOpen} aria-label="Account menu"><span className="profile-avatar">{initials(user.name)}</span><ChevronDown size={15} /></button>
        {profileOpen && <div className="header-popover profile-popover"><div className="profile-popover-head"><strong>{user.name}</strong><small>{user.email}</small><AccountTypeLabel /></div><button onClick={() => { setProfileOpen(false); navigate('/portfolio'); }}><BriefcaseBusiness size={16} /> My portfolio</button>{user.role === 'admin' && <button onClick={() => { setProfileOpen(false); navigate('/admin'); }}><ShieldCheck size={16} /> Admin console</button>}{switchTarget && <button onClick={() => { setProfileOpen(false); void switchAccount(); }} disabled={switchingAccount}>{switchTarget.isDemo ? <Sparkles size={16} /> : <Repeat2 size={16} />}{switchingAccount ? 'Switching…' : switchTarget.isDemo ? 'Switch to demo' : `Switch to ${switchTarget.name.split(' ')[0]}`}</button>}<button onClick={logout}><LogOut size={16} /> Sign out</button></div>}
      </div> : <div className="topbar-auth"><button className="button button--ghost" onClick={() => openAuth('login')}>Sign in</button><button className="button button--primary topbar-getstarted" onClick={() => openAuth('register')}>Get started <ArrowRight size={16} /></button></div>}
    </div>
  </header>;
}

function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { market, marketError } = useApp();
  const location = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [location.pathname]);
  return <div className="app-shell">
    <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
    <div className="app-main">
      <Header onMenu={() => setMobileOpen(true)} />
      <main className="main-content">
        {marketError && !market && <div className="connection-banner"><CircleHelp size={18} /> Unable to reach the server. Check your connection and refresh the page.</div>}
        <DemoBanner />
        {market && !market.tradingEnabled && <div className="halt-banner"><ShieldCheck size={17} /> Paper trading is temporarily paused by an administrator. Market exploration is still available.</div>}
        <Suspense fallback={<div className="page"><LoadingBlock height={350} /></div>}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<OverviewPage />} />
        </Routes>
        </Suspense>
        <footer className="main-footer"><span>Northstar is a paper trading simulator. Not investment advice or a brokerage.</span><span><Sparkles size={14} /> Made for clearer decisions</span></footer>
      </main>
    </div>
    <AuthModal />
  </div>;
}

export default function App() { return <AppProvider><AppShell /></AppProvider>; }
