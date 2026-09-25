import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bookmark, Star, TrendingUp } from 'lucide-react';
import { AuthGate } from '../components/AuthGate';
import { AssetTable } from '../components/AssetTable';
import { EmptyState, LoadingBlock, PageHeading } from '../components/UI';
import { useApp } from '../state/AppContext';

export function WatchlistPage() {
  const { user, market, watchlist, watchlistLoading } = useApp();
  const navigate = useNavigate();
  if (!user) return <div className="page"><PageHeading eyebrow="YOUR WATCHLIST" title="Keep your favorites close." description="Follow the companies and funds that matter most to you." /><AuthGate title="Your watchlist, your way." description="Sign in to save assets, check their prices, and find your next opportunity faster." /></div>;
  const assets = (market?.assets || []).filter(asset => watchlist.includes(asset.symbol));
  const gainers = assets.filter(asset => (market?.quotes[asset.symbol]?.changePercent ?? 0) >= 0).length;
  return <div className="page watchlist-page">
    <PageHeading eyebrow="YOUR WATCHLIST" title="Keep your favorites close." description="A focused view of the assets you're following." action={<button className="button button--primary" onClick={() => navigate('/markets')}>Explore assets <ArrowRight size={17} /></button>} />
    <div className="watchlist-summary"><div className="watchlist-summary-icon"><Star size={26} fill="currentColor" /></div><div><span>YOUR PERSONAL SHORTLIST</span><h2>{assets.length} {assets.length === 1 ? 'asset' : 'assets'} on your radar</h2><p>{assets.length ? `${gainers} moving up today · Your watchlist is updated as prices change.` : 'Build a list of the companies and funds you want to follow.'}</p></div><div className="watchlist-summary-decoration"><Bookmark size={95} strokeWidth={.7} /></div></div>
    <section className="panel watchlist-table-panel"><div className="panel-section-heading"><div><h3>Saved assets</h3><p>Click any asset to open its trading workspace</p></div><span className="table-caption">{market?.mode === 'demo' ? 'Simulated prices' : 'Indicative quotes'}</span></div>
      {watchlistLoading ? <LoadingBlock height={230} /> : assets.length ? <AssetTable assets={assets} onSelect={symbol => navigate(`/markets?symbol=${symbol}`)} showControls /> : <EmptyState icon={<TrendingUp size={28} />} title="Nothing on your watchlist yet" description="Tap the star next to any asset to save it here. Start exploring and make this space your own." action="Discover assets" onAction={() => navigate('/markets')} />}
    </section>
    <div className="watchlist-tip"><Star size={17} /> Tip: Use the star beside a stock anywhere in Northstar to add or remove it from this list.</div>
  </div>;
}
