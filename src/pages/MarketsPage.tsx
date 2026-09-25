import { useSearchParams } from 'react-router-dom';
import { ArrowUpRight, BarChart3, Clock3, TrendingUp } from 'lucide-react';
import { AssetTable } from '../components/AssetTable';
import { TradingWorkspace } from '../components/TradingWorkspace';
import { AssetLogo, PageHeading, SectionHeading } from '../components/UI';
import { signedPercent } from '../lib/api';
import { useApp } from '../state/AppContext';

export function MarketsPage() {
  const { market } = useApp();
  const [params, setParams] = useSearchParams();
  const selected = params.get('symbol')?.toUpperCase() || 'AAPL';
  const assets = market?.assets || [];
  const sorted = [...assets].sort((a, b) => (market?.quotes[b.symbol]?.changePercent ?? 0) - (market?.quotes[a.symbol]?.changePercent ?? 0));
  const topGainer = sorted[0];
  const advancing = assets.filter(asset => (market?.quotes[asset.symbol]?.changePercent ?? 0) >= 0).length;
  const select = (symbol: string) => { setParams({ symbol }); document.getElementById('market-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <div className="page markets-page">
    <PageHeading eyebrow="EXPLORE THE MARKETS" title="Find your next opportunity." description="A simple, focused place to discover stocks, follow prices, and place a practice trade." action={<div className="heading-info-pill"><Clock3 size={16} /> {market?.mode === 'demo' ? 'Simulated market feed' : `Live market data · ${market?.provider}`}</div>} />
    <div className="market-summary-row">
      <div className="market-summary-card"><div className="market-summary-icon green"><TrendingUp size={19} /></div><div><span>Top mover</span><strong>{topGainer?.symbol || '—'} <span className="positive-text">{topGainer ? signedPercent(market?.quotes[topGainer.symbol]?.changePercent ?? 0) : ''}</span></strong></div>{topGainer && <AssetLogo asset={topGainer} size="sm" />}</div>
      <div className="market-summary-card"><div className="market-summary-icon blue"><BarChart3 size={19} /></div><div><span>Market breadth</span><strong>{advancing} of {assets.length} <small>moving up</small></strong></div><ArrowUpRight size={18} className="market-summary-arrow" /></div>
      <div className="market-summary-card"><div className="market-summary-icon violet"><Clock3 size={19} /></div><div><span>Session status</span><strong>{market?.marketStatus.isOpen ? 'US market open' : 'US market closed'}</strong></div><span className={`session-mini-dot ${market?.marketStatus.isOpen ? 'open' : ''}`} /></div>
    </div>
    <div id="market-workspace" className="workspace-section"><SectionHeading title="Price & trade" subtitle="Select a company below to explore its chart and order ticket." /><TradingWorkspace symbol={selected} /></div>
    <section className="panel market-explorer-panel"><div className="panel-section-heading"><div><h3>All assets</h3><p>{assets.length} stocks and ETFs available to explore</p></div><span className="table-caption">Prices in USD <span>·</span> {market?.mode === 'demo' ? 'Simulated' : 'Indicative'}</span></div><AssetTable assets={assets} selectedSymbol={selected} onSelect={select} showControls /></section>
    <div className="market-education-note"><span className="note-circle">i</span><p><strong>A note on prices:</strong> {market?.mode === 'demo' ? 'This workspace uses simulated prices for practice. Connect a market data provider for real quotes.' : `Prices come from ${market?.provider} and can be delayed. Orders are always simulated and do not reach an exchange.`} Charts marked illustrative are not historical market data.</p></div>
  </div>;
}
