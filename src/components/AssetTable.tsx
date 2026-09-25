import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowRight, Search, Star } from 'lucide-react';
import type { Asset } from '../types';
import { price } from '../lib/api';
import { useApp } from '../state/AppContext';
import { AssetLogo, EmptyState, Trend } from './UI';

export function AssetTable({ assets, selectedSymbol, onSelect, showControls = false, compact = false }: {
  assets: Asset[];
  selectedSymbol?: string;
  onSelect: (symbol: string) => void;
  showControls?: boolean;
  compact?: boolean;
}) {
  const { market, watchlist, toggleWatchlist } = useApp();
  const [filter, setFilter] = useState<'all' | 'stock' | 'etf'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('featured');
  const rows = useMemo(() => {
    let result = assets.filter(asset => (filter === 'all' || asset.kind === filter) && `${asset.symbol} ${asset.name} ${asset.sector}`.toLowerCase().includes(search.toLowerCase()));
    if (sort === 'gainers') result = [...result].sort((a, b) => (market?.quotes[b.symbol]?.changePercent ?? 0) - (market?.quotes[a.symbol]?.changePercent ?? 0));
    if (sort === 'losers') result = [...result].sort((a, b) => (market?.quotes[a.symbol]?.changePercent ?? 0) - (market?.quotes[b.symbol]?.changePercent ?? 0));
    if (sort === 'az') result = [...result].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return result;
  }, [assets, filter, search, sort, market?.quotes]);
  const choose = (event: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>, symbol: string) => {
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
    if ('key' in event) event.preventDefault();
    onSelect(symbol);
  };

  return <div className="asset-table-container">
    {showControls && <div className="table-controls">
      <div className="filter-pills" role="group" aria-label="Filter assets">{(['all', 'stock', 'etf'] as const).map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All assets' : item === 'stock' ? 'Stocks' : 'ETFs'}</button>)}</div>
      <div className="table-controls-right"><label className="table-search"><Search size={16} /><input type="search" placeholder="Search assets..." aria-label="Search market table" value={search} onChange={event => setSearch(event.target.value)} /></label><select className="table-sort" value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort assets"><option value="featured">Featured</option><option value="gainers">Top gainers</option><option value="losers">Top decliners</option><option value="az">A to Z</option></select></div>
    </div>}
    {rows.length ? <div className="table-scroll"><table className={`asset-table ${compact ? 'asset-table--compact' : ''}`}><thead><tr><th>Asset</th><th>Last price</th><th>Today</th>{!compact && <th>Sector</th>}<th className="watch-column">Watch</th><th className="action-column"><span className="sr-only">Open asset</span></th></tr></thead><tbody>
      {rows.map(asset => {
        const quote = market?.quotes[asset.symbol];
        const saved = watchlist.includes(asset.symbol);
        return <tr key={asset.symbol} className={selectedSymbol === asset.symbol ? 'asset-row--selected' : ''} onClick={event => choose(event, asset.symbol)} onKeyDown={event => choose(event, asset.symbol)} tabIndex={0} aria-label={`View ${asset.name}`}>
          <td><div className="table-asset"><AssetLogo asset={asset} size="sm" /><div><strong>{asset.symbol}</strong><span>{asset.name}</span></div></div></td>
          <td className="table-price">{quote ? price(quote.price) : '—'}</td>
          <td>{quote ? <Trend value={quote.changePercent} subtle /> : '—'}</td>
          {!compact && <td><span className="sector-pill">{asset.sector}</span></td>}
          <td className="watch-column"><button className={`table-star ${saved ? 'table-star--saved' : ''}`} aria-label={`${saved ? 'Remove' : 'Add'} ${asset.symbol} ${saved ? 'from' : 'to'} watchlist`} title={saved ? 'Remove from watchlist' : 'Add to watchlist'} onClick={event => { event.stopPropagation(); toggleWatchlist(asset.symbol); }}><Star size={18} fill={saved ? 'currentColor' : 'none'} /></button></td>
          <td className="action-column"><button className="table-arrow" aria-label={`View ${asset.symbol}`} onClick={event => { event.stopPropagation(); onSelect(asset.symbol); }}><ArrowRight size={17} /></button></td>
        </tr>;
      })}
    </tbody></table></div> : <EmptyState icon={<Search size={25} />} title="No assets found" description="Try a different search or filter to find what you're looking for." />}
  </div>;
}
