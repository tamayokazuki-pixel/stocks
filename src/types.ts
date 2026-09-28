export type Asset = {
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
  kind: 'stock' | 'etf';
  color: string;
  basePriceCents: number;
  baseChangePercent: number;
  active: boolean;
  featured: boolean;
};

export type Quote = {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number | null;
  currency?: string;
  source: 'live' | 'demo';
  asOf: number;
};

export type Notice = { id: number; title: string; body: string; createdAt: number; active?: boolean };
export type MarketData = {
  assets: Asset[];
  quotes: Record<string, Quote>;
  mode: 'live' | 'mixed' | 'demo';
  provider: string;
  updatedAt: number;
  marketStatus: { isOpen: boolean; label: string };
  tradingEnabled: boolean;
  notices: Notice[];
};
export type History = { symbol: string; range: string; source: 'live' | 'demo'; points: { time: number; value: number }[] };

export type User = {
  id: number;
  name: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  cashCents: number;
  createdAt: number;
};
export type Position = {
  symbol: string;
  name: string;
  sector: string;
  color: string;
  quantity: number;
  averageCostCents: number;
  price: number;
  changePercent: number;
  marketValueCents: number;
  costBasisCents: number;
  totalReturnCents: number;
  dayChangeCents: number;
};
export type Account = {
  cashCents: number;
  availableCashCents: number;
  reservedCashCents: number;
  portfolioValueCents: number;
  equityCents: number;
  dayChangeCents: number;
  dayChangePercent: number;
  totalReturnCents: number;
  positions: Position[];
};
export type Order = {
  id: number;
  symbol: string;
  name: string;
  color: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  limitPriceCents: number | null;
  filledPriceCents: number | null;
  status: 'pending' | 'filled' | 'cancelled';
  createdAt: number;
  filledAt: number | null;
};
export type AdminOverview = {
  users: { total: number; active: number };
  orders: { total: number; pending: number; filled: number; volumeCents: number };
  assets: { total: number; active: number };
  tradingEnabled: boolean;
  notices: Notice[];
};
export type AuditEntry = { id: number; action: string; detail: string; actorName: string; targetName: string | null; createdAt: number };


export type CashTransaction = {
  id: number;
  type: 'top_up' | 'withdrawal';
  amountCents: number;
  balanceAfterCents: number;
  createdAt: number;
};

export type TransferDetails =
  | { kind: 'bank'; accountHolder: string; bankName: string; accountNumber: string; routingNumber: string; accountType: 'checking' | 'savings'; currency?: 'USD'; country?: 'US' }
  | { kind: 'wallet'; address: string; network: 'Ethereum' | 'Polygon'; asset?: 'USDC' };
export interface TransferMethod { id: number; details: TransferDetails; active: boolean; createdAt: number }
export type TransferStatus = 'pending' | 'processing' | 'completed' | 'rejected' | 'cancelled';
export interface TransferRequest {
  id: number; userId: number; userName?: string; userEmail?: string; type: 'deposit' | 'withdrawal';
  amountCents: number; methodId: number | null; details: TransferDetails; reference: string;
  status: TransferStatus; reviewNote: string | null; reviewedBy: number | null; reviewedAt: number | null; createdAt: number;
}
