import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, ArrowUpRight, BarChart3, BriefcaseBusiness, Compass, DollarSign, Layers3, Plus, Sparkles, TrendingUp, Wallet } from 'lucide-react';
import { AssetTable } from '../components/AssetTable';
import { TradingWorkspace } from '../components/TradingWorkspace';
import { AssetLogo, PageHeading, SectionHeading, Trend } from '../components/UI';
import { money, price, signedMoney } from '../lib/api';
import { useApp } from '../state/AppContext';
import type { Asset } from '../types';

function MarketStat({ symbol, name, onClick }: { symbol: string; name: string; onClick: () => void }) {
  const { market } = useApp();
  const asset = market?.assets.find(item => item.symbol === symbol);
  const quote = market?.quotes[symbol];
  return <button className="stat-card stat-card--market" onClick={onClick}>
    <div className="stat-card-top"><span className="stat-icon stat-icon--blue"><BarChart3 size={19} /></span>{quote && <Trend value={quote.changePercent} subtle />}</div>
    <span className="stat-label">{name}</span><strong className="stat-value">{quote ? price(quote.price) : '—'}</strong>
    <div className="stat-footer"><span>{symbol}</span><span>{asset?.kind === 'etf' ? 'Exchange-traded fund' : 'Market snapshot'}</span></div>
  </button>;
}

function AccountStats() {
  const { account } = useApp();
  const positionCount = account?.positions.length ?? 0;
  const costBasis = account?.positions.reduce((sum, item) => sum + item.costBasisCents, 0) || 0;
  const returnPercent = costBasis ? ((account?.totalReturnCents || 0) / costBasis) * 100 : 0;
  return <div className="stats-grid">
    <div className="stat-card"><div className="stat-card-top"><span className="stat-icon stat-icon--blue"><Wallet size={19} /></span><span className="stat-quiet">USD</span></div><span className="stat-label">Total balance</span><strong className="stat-value">{account ? money(account.equityCents) : '—'}</strong><div className="stat-footer">{account ? <Trend value={account.dayChangePercent} label={`${signedMoney(account.dayChangeCents)} today`} subtle /> : <span>Loading...</span>}</div></div>
    <div className="stat-card"><div className="stat-card-top"><span className="stat-icon stat-icon--violet"><BriefcaseBusiness size={19} /></span><span className="stat-quiet">PORTFOLIO</span></div><span className="stat-label">Invested value</span><strong className="stat-value">{account ? money(account.portfolioValueCents) : '—'}</strong><div className="stat-footer"><span>{positionCount} {positionCount === 1 ? 'holding' : 'holdings'}</span><span>Current market value</span></div></div>
    <div className="stat-card"><div className="stat-card-top"><span className="stat-icon stat-icon--amber"><DollarSign size={19} /></span><span className="stat-quiet">AVAILABLE</span></div><span className="stat-label">Buying power</span><strong className="stat-value">{account ? money(account.availableCashCents) : '—'}</strong><div className="stat-footer"><span>Virtual cash</span><span>Ready to trade</span></div></div>
    <div className="stat-card"><div className="stat-card-top"><span className="stat-icon stat-icon--mint"><TrendingUp size={19} /></span><span className="stat-quiet">ALL TIME</span></div><span className="stat-label">Position return</span><strong className={`stat-value ${returnPercent < 0 ? 'negative-text' : ''}`}>{account ? signedMoney(account.totalReturnCents) : '—'}</strong><div className="stat-footer">{account ? <Trend value={returnPercent} subtle /> : <span>Loading...</span>}<span>Unrealized P/L</span></div></div>
  </div>;
}

function GuestStats({ onSelect }: { onSelect: (symbol: string) => void }) {
  const { market } = useApp();
  return <div className="stats-grid">
    <MarketStat symbol="SPY" name="S&P 500 ETF" onClick={() => onSelect('SPY')} />
    <MarketStat symbol="QQQ" name="Nasdaq 100 ETF" onClick={() => onSelect('QQQ')} />
    <MarketStat symbol="DIA" name="Dow Jones ETF" onClick={() => onSelect('DIA')} />
    <div className="stat-card stat-card--accent"><div className="stat-card-top"><span className="stat-icon stat-icon--mint"><Layers3 size={19} /></span><ArrowUpRight size={19} /></div><span className="stat-label">Markets to explore</span><strong className="stat-value">{market?.assets.length || '—'} assets</strong><div className="stat-footer"><span>Stocks & ETFs</span><span>All in one place</span></div></div>
  </div>;
}

function WatchlistPreview({ onSelect }: { onSelect: (symbol: string) => void }) {
  const { market, user, watchlist, openAuth } = useApp();
  const navigate = useNavigate();
  const assets = (user ? watchlist : ['AAPL', 'NVDA', 'TSLA', 'MSFT']).map(symbol => market?.assets.find(asset => asset.symbol === symbol)).filter((asset): asset is Asset => !!asset).slice(0, 5);
  return <div className="panel watch-preview"><div className="rail-heading"><div><h3>{user ? 'Your watchlist' : 'Popular to watch'}</h3><p>{user ? 'The assets on your radar' : 'A good place to start exploring'}</p></div><button className="icon-button" title="Open watchlist" onClick={() => user ? navigate('/watchlist') : openAuth('register')}><ArrowUpRight size={18} /></button></div>
    {assets.length ? <div className="watch-preview-list">{assets.map(asset => {
      const quote = market?.quotes[asset.symbol];
      return <button key={asset.symbol} className="watch-preview-row" onClick={() => onSelect(asset.symbol)}><AssetLogo asset={asset} size="sm" /><span className="watch-preview-name"><strong>{asset.symbol}</strong><small>{asset.name}</small></span><span className="watch-preview-price"><strong>{quote ? price(quote.price) : '—'}</strong>{quote && <small className={quote.changePercent >= 0 ? 'positive-text' : 'negative-text'}>{quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%</small>}</span></button>;
    })}</div> : <div className="watch-preview-empty"><StarIllustration /><p>Your watchlist is empty.</p><button className="text-link" onClick={() => navigate('/markets')}>Explore markets <ArrowRight size={15} /></button></div>}
    <button className="rail-footer-link" onClick={() => user ? navigate('/watchlist') : openAuth('register')}>{user ? 'View your watchlist' : 'Create your own watchlist'} <ArrowRight size={15} /></button>
  </div>;
}

function StarIllustration() { return <Sparkles size={25} />; }

export function OverviewPage() {
  const { user, market, account, openAuth, demoEnabled, demoSignIn } = useApp();
  const navigate = useNavigate();
  const [selected, setSelected] = useState('AAPL');
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()).toUpperCase();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const select = (symbol: string) => { setSelected(symbol); document.getElementById('trading-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const tryDemo = async () => { try { await demoSignIn(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not open demo account.'); } };
  return <div className="page overview-page">
    <PageHeading eyebrow={dateLabel} title={user ? `${greeting}, ${user.name.split(' ')[0]}.` : 'The market, made clearer.'} description={user ? 'A complete view of your portfolio and what is moving today.' : 'Follow the companies you care about. Practice every move with confidence.'} action={user ? <button className="button button--primary" onClick={() => navigate('/markets')}><Plus size={17} /> Explore markets</button> : demoEnabled ? <button className="button button--primary" onClick={tryDemo}><Sparkles size={17} /> Explore demo account</button> : <button className="button button--primary" onClick={() => openAuth('register')}><Plus size={17} /> Open an account</button>} />
    {user ? <AccountStats /> : <GuestStats onSelect={select} />}
    <div id="trading-workspace" className="workspace-section"><SectionHeading title="Trading workspace" subtitle="Follow the price. Make your next move with clarity." action="All markets" onAction={() => navigate('/markets')} /><TradingWorkspace symbol={selected} /></div>
    <div className="overview-lower">
      <section className="panel overview-market-panel"><div className="panel-section-heading"><div><h3>Explore the market</h3><p>Companies and funds worth a closer look</p></div><button className="text-link" onClick={() => navigate('/markets')}>View all <ArrowRight size={16} /></button></div><AssetTable assets={(market?.assets || []).slice(0, 6)} selectedSymbol={selected} onSelect={select} compact /></section>
      <div className="overview-rail"><WatchlistPreview onSelect={select} /><div className="panel bulletin-panel"><div className="bulletin-icon"><Compass size={20} /></div><span className="bulletin-kicker">MARKET BULLETIN</span><h3>{market?.notices[0]?.title || 'Stay in the know'}</h3><p>{market?.notices[0]?.body || 'Important platform updates will appear here.'}</p><button className="text-link" onClick={() => navigate('/insights')}>Explore insights <ArrowRight size={16} /></button></div></div>
    </div>
    {!user && <div className="bottom-cta"><div className="bottom-cta-icon"><Sparkles size={24} /></div><div><h3>Curious what your portfolio could look like?</h3><p>Start with virtual funds, a clean slate, and room to learn.</p></div><button className="button button--light" onClick={() => openAuth('register')}>Create free account <ArrowRight size={16} /></button></div>}
    {user && account && account.reservedCashCents > 0 && <div className="reserved-note">{money(account.reservedCashCents)} of your cash is reserved for pending buy orders.</div>}
  </div>;
}
