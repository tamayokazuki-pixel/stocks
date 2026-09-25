import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Clock3, Compass, Lightbulb, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { PageHeading, SectionHeading } from '../components/UI';
import { shortDate, signedPercent } from '../lib/api';
import { useApp } from '../state/AppContext';

const guides = [
  { title: 'Market order or limit order?', category: 'GETTING STARTED', minutes: '3 min read', icon: TrendingUp, body: 'A market order attempts to fill immediately at the current displayed price. A limit order waits for your chosen price or better. In Northstar, both are paper orders: limit orders reserve funds or shares until they fill or you cancel them.' },
  { title: 'The case for diversification', category: 'BUILDING A PORTFOLIO', minutes: '4 min read', icon: Compass, body: 'Diversification means spreading exposure across different companies, industries, or funds instead of relying on one outcome. It does not eliminate risk, but it can reduce the impact of a single position on your overall portfolio.' },
  { title: 'Understanding unrealized returns', category: 'READING YOUR NUMBERS', minutes: '3 min read', icon: Lightbulb, body: 'An unrealized return is the difference between a holding’s current value and what you paid for it. It changes as prices move and only becomes realized when you sell. Past performance never guarantees future results.' },
];

export function InsightsPage() {
  const { market } = useApp();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(null);
  const sorted = [...(market?.assets || [])].sort((a, b) => (market?.quotes[b.symbol]?.changePercent ?? 0) - (market?.quotes[a.symbol]?.changePercent ?? 0));
  const winner = sorted[0];
  const laggard = sorted[sorted.length - 1];
  const rising = sorted.filter(asset => (market?.quotes[asset.symbol]?.changePercent ?? 0) >= 0).length;
  const pulse = rising >= sorted.length * .6 ? 'More green than red' : rising <= sorted.length * .4 ? 'A cautious session' : 'A mixed picture';
  return <div className="page insights-page">
    <PageHeading eyebrow="MARKET INSIGHTS" title="A little context goes a long way." description="Understand what is moving, stay on top of updates, and learn at your own pace." />
    <div className="insights-hero"><div className="insights-hero-content"><div className="insights-hero-kicker"><Sparkles size={16} /> THE NORTHSTAR PERSPECTIVE</div><h2>Better decisions start<br />with better questions.</h2><p>Explore the market with curiosity. Practice with purpose. Grow your confidence one trade at a time.</p><button onClick={() => navigate('/markets')}>Explore the market <ArrowRight size={17} /></button></div><div className="insights-art"><div className="insights-ring insights-ring--one" /><div className="insights-ring insights-ring--two" /><div className="insights-art-center"><Compass size={59} strokeWidth={1.1} /></div><span className="insights-star insights-star--one">✦</span><span className="insights-star insights-star--two">✦</span><span className="insights-star insights-star--three">✦</span></div></div>
    <div className="insights-section"><SectionHeading title="Market pulse" subtitle="A quick snapshot based on assets tracked in Northstar." /><div className="pulse-grid">
      <div className="panel pulse-card"><span className="pulse-icon pulse-icon--blue"><TrendingUp size={19} /></span><span className="pulse-label">MARKET BREADTH</span><h3>{pulse}</h3><p>{rising} of {sorted.length} tracked assets are up today.</p><div className="breadth-bar"><span style={{ width: `${sorted.length ? rising / sorted.length * 100 : 0}%` }} /></div><small>{rising} advancing <span>·</span> {sorted.length - rising} declining</small></div>
      <div className="panel pulse-card"><span className="pulse-icon pulse-icon--mint"><ArrowUpRight size={20} /></span><span className="pulse-label">TOP GAINER</span><h3>{winner?.symbol || '—'}</h3><p>{winner?.name || 'Waiting for market data'}</p><strong className="positive-text">{winner ? signedPercent(market?.quotes[winner.symbol]?.changePercent ?? 0) : '—'}</strong><button onClick={() => winner && navigate(`/markets?symbol=${winner.symbol}`)}>View asset <ArrowRight size={14} /></button></div>
      <div className="panel pulse-card"><span className="pulse-icon pulse-icon--coral"><ArrowDownRight size={20} /></span><span className="pulse-label">TOP DECLINER</span><h3>{laggard?.symbol || '—'}</h3><p>{laggard?.name || 'Waiting for market data'}</p><strong className="negative-text">{laggard ? signedPercent(market?.quotes[laggard.symbol]?.changePercent ?? 0) : '—'}</strong><button onClick={() => laggard && navigate(`/markets?symbol=${laggard.symbol}`)}>View asset <ArrowRight size={14} /></button></div>
    </div><p className="pulse-disclaimer"><Clock3 size={14} /> {market?.mode === 'demo' ? 'Market pulse is based on simulated data, not actual market conditions.' : 'Provider quotes may be delayed. Market pulse reflects tracked assets only, not the whole market.'}</p></div>
    <div className="insights-two-column"><section className="panel learning-panel"><div className="panel-section-heading"><div><h3>Trading essentials</h3><p>Short reads for a stronger foundation</p></div><BookOpen size={19} className="section-icon" /></div><div className="guide-list">{guides.map((guide, index) => {
      const Icon = guide.icon;
      return <div className={`guide-item ${expanded === index ? 'guide-item--expanded' : ''}`} key={guide.title}><button onClick={() => setExpanded(expanded === index ? null : index)} aria-expanded={expanded === index}><span className="guide-icon"><Icon size={20} /></span><span className="guide-copy"><small>{guide.category} <span>·</span> {guide.minutes}</small><strong>{guide.title}</strong></span><ChevronDown size={18} /></button>{expanded === index && <div className="guide-body">{guide.body}</div>}</div>;
    })}</div></section><section className="panel updates-panel"><div className="panel-section-heading"><div><h3>Platform updates</h3><p>News from the Northstar team</p></div><span className="updates-bell"><ShieldCheck size={18} /></span></div><div className="updates-list">{market?.notices.length ? market.notices.map(notice => <div className="update-item" key={notice.id}><div className="update-timeline-dot" /><span>{shortDate(notice.createdAt)}</span><h4>{notice.title}</h4><p>{notice.body}</p></div>) : <p className="updates-empty">No updates right now. Check back soon.</p>}</div><div className="updates-footer"><ShieldCheck size={16} /> Updates are managed by Northstar administrators.</div></section></div>
    <div className="education-disclaimer"><Lightbulb size={17} /><p>Educational content only. Northstar does not provide investment advice or execute live trades.</p></div>
  </div>;
}
