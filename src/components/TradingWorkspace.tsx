import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, ArrowUpRight, Clock3, Info, Minus, Plus, ShieldCheck, Star } from 'lucide-react';
import type { Asset, History, Quote } from '../types';
import { api, errorMessage, money, price, signedMoney, signedPercent } from '../lib/api';
import { useApp } from '../state/AppContext';
import { AssetLogo, Modal, Trend } from './UI';

const ranges = ['1D', '1W', '1M', '3M', '1Y'] as const;
type Range = typeof ranges[number];

function ChartPanel({ asset, quote }: { asset: Asset; quote: Quote }) {
  const { watchlist, toggleWatchlist, market } = useApp();
  const [range, setRange] = useState<Range>('1D');
  const { data: history, isLoading } = useQuery<History>({
    queryKey: ['history', asset.symbol, range],
    queryFn: () => api(`/market/${asset.symbol}/history?range=${range}`),
    staleTime: 20_000,
  });
  const points = history?.points || [];
  const positive = quote.changePercent >= 0;
  const chartColor = positive ? '#11a984' : '#ed6a6a';
  const min = points.length ? Math.min(...points.map(point => point.value)) : quote.price * .98;
  const max = points.length ? Math.max(...points.map(point => point.value)) : quote.price * 1.02;
  const padding = Math.max((max - min) * .18, quote.price * .003);
  const formatAxis = (value: number) => range === '1D'
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(value)
    : range === '1Y'
      ? new Intl.DateTimeFormat('en-US', { month: 'short' }).format(value)
      : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(value);

  return <section className="panel chart-panel" aria-label={`${asset.name} price chart`}>
    <div className="chart-topline">
      <div className="chart-identity"><AssetLogo asset={asset} size="lg" /><div><div className="chart-name-row"><h3>{asset.name}</h3><span className="exchange-tag">{asset.exchange}</span></div><span className="chart-symbol">{asset.symbol} <span>·</span> {asset.kind === 'etf' ? 'Exchange-traded fund' : asset.sector}</span></div></div>
      <button className={`favorite-button ${watchlist.includes(asset.symbol) ? 'favorite-button--active' : ''}`} title={watchlist.includes(asset.symbol) ? 'Remove from watchlist' : 'Add to watchlist'} aria-label={watchlist.includes(asset.symbol) ? 'Remove from watchlist' : 'Add to watchlist'} onClick={() => toggleWatchlist(asset.symbol)}><Star size={19} fill={watchlist.includes(asset.symbol) ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="chart-value-row">
      <div><div className="chart-big-price">{price(quote.price)}</div><div className="chart-change"><Trend value={quote.changePercent} label={`${signedMoney(Math.round(quote.change * 100))} (${signedPercent(quote.changePercent)})`} /><span className="chart-change-label">today</span></div></div>
      <div className="range-tabs" role="group" aria-label="Chart time range">{ranges.map(item => <button type="button" key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}</div>
    </div>
    <div className="price-chart">
      {isLoading && !points.length ? <div className="chart-loading"><span className="loading-spinner" /> Loading chart</div> : points.length ? <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 2, bottom: 0, left: -14 }}>
          <defs><linearGradient id={`chartFill-${asset.symbol}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartColor} stopOpacity={0.19} /><stop offset="97%" stopColor={chartColor} stopOpacity={0.005} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#edf0f4" strokeDasharray="4 5" />
          <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={formatAxis} minTickGap={38} tickLine={false} axisLine={false} tick={{ fill: '#929dad', fontSize: 11, fontFamily: 'DM Sans' }} dy={11} />
          <YAxis orientation="right" domain={[min - padding, max + padding]} tickFormatter={value => `$${Number(value).toFixed(value > 100 ? 0 : 2)}`} tickLine={false} axisLine={false} width={60} tick={{ fill: '#929dad', fontSize: 11, fontFamily: 'DM Sans' }} tickCount={5} />
          <Tooltip cursor={{ stroke: '#aab7c8', strokeDasharray: '4 4' }} content={({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><span>{formatAxis(Number(label))}</span><strong>{price(Number(payload[0].value))}</strong></div> : null} />
          <Area type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2.6} fill={`url(#chartFill-${asset.symbol})`} dot={false} activeDot={{ r: 5, fill: chartColor, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer> : <div className="chart-loading">Chart unavailable</div>}
    </div>
    <div className="chart-source"><span className="source-dot" />{history?.source === 'live' ? 'Real market price history' : 'Illustrative demo chart'}<span className="chart-source-separator">·</span><Clock3 size={13} />{quote.source === 'live' ? `Live ${market?.provider ?? 'market'} quote · may be delayed` : 'Simulated prices'}</div>
    <div className="chart-metrics">
      <div><span>Open</span><strong>{price(quote.open)}</strong></div>
      <div><span>Day high</span><strong>{price(quote.high)}</strong></div>
      <div><span>Day low</span><strong>{price(quote.low)}</strong></div>
      <div><span>Prev. close</span><strong>{price(quote.previousClose)}</strong></div>
    </div>
  </section>;
}

function OrderTicket({ asset, quote }: { asset: Asset; quote: Quote }) {
  const { user, account, orders, market, openAuth, refreshPrivate } = useApp();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [quantity, setQuantity] = useState('1');
  const [limitPrice, setLimitPrice] = useState(quote.price.toFixed(2));
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState('');
  useEffect(() => { setLimitPrice(quote.price.toFixed(2)); setReview(false); setTicketError(''); }, [asset.symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  const shares = Number(quantity);
  const numericLimit = Number(limitPrice);
  const limitCrosses = type === 'limit' && (side === 'buy' ? quote.price <= numericLimit : quote.price >= numericLimit);
  // An immediately executable limit order fills at the current quote; otherwise funds are reserved at the limit.
  const estimatedPrice = type === 'market' || limitCrosses ? quote.price : numericLimit;
  const estimatedCents = Number.isFinite(shares * estimatedPrice) ? Math.round(shares * estimatedPrice * 100) : 0;
  const holding = account?.positions.find(position => position.symbol === asset.symbol);
  const reservedSell = orders.filter(order => order.symbol === asset.symbol && order.side === 'sell' && order.status === 'pending').reduce((sum, order) => sum + order.quantity, 0);
  const availableShares = Math.max(0, (holding?.quantity || 0) - reservedSell);
  const validQuantity = Number.isSafeInteger(shares) && shares >= 1 && shares <= 10000;
  const validLimit = type === 'market' || (Number.isFinite(numericLimit) && numericLimit >= 0.01 && numericLimit <= 100000);
  const insufficient = !!user && validQuantity && validLimit && (side === 'buy' ? estimatedCents > (account?.availableCashCents ?? 0) : shares > availableShares);
  const disabled = !market?.tradingEnabled || !validQuantity || !validLimit || insufficient || submitting;
  const canReview = !user || !disabled;

  const confirm = async () => {
    setSubmitting(true); setTicketError('');
    try {
      const result = await api<{ order: { status: string } }>('/orders', { method: 'POST', body: JSON.stringify({ symbol: asset.symbol, side, type, quantity: shares, limitPrice: type === 'limit' ? numericLimit : undefined }) });
      setReview(false);
      refreshPrivate();
      toast.success(result.order.status === 'filled' ? `${side === 'buy' ? 'Bought' : 'Sold'} ${shares} ${asset.symbol} ${shares === 1 ? 'share' : 'shares'}` : `${side === 'buy' ? 'Buy' : 'Sell'} limit order placed for ${asset.symbol}`,
        { description: result.order.status === 'pending' ? 'You can track or cancel it from Orders.' : 'Filled in your paper trading account.' });
    } catch (error) { setTicketError(errorMessage(error)); setReview(false); toast.error(errorMessage(error)); }
    finally { setSubmitting(false); }
  };

  return <section className="panel ticket-panel" aria-label="Paper trading order ticket">
    <div className="ticket-header"><div><h3>Place an order</h3><p>Trade {asset.symbol} in your paper account</p></div><span className="ticket-paper-badge"><span /> PAPER</span></div>
    <div className="side-switch" role="group" aria-label="Order side"><button type="button" className={side === 'buy' ? 'active buy-active' : ''} onClick={() => { setSide('buy'); setTicketError(''); }}>Buy</button><button type="button" className={side === 'sell' ? 'active sell-active' : ''} onClick={() => { setSide('sell'); setTicketError(''); }}>Sell</button></div>
    <div className="ticket-fields">
      <div className="ticket-field-heading"><label htmlFor="order-type">Order type</label><span className="ticket-hint" title="Market orders fill at the displayed price. Limit orders only fill at your price or better."><Info size={14} /> What's this?</span></div>
      <div className="select-wrap"><select id="order-type" value={type} onChange={event => setType(event.target.value as 'market' | 'limit')}><option value="market">Market order</option><option value="limit">Limit order</option></select><span className="select-caret">⌄</span></div>
      <div className="ticket-field-heading"><label htmlFor="order-quantity">Quantity</label><span className="ticket-hint">Whole shares</span></div>
      <div className="quantity-control"><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(String(Math.max(1, (Number(quantity) || 1) - 1)))}><Minus size={16} /></button><input id="order-quantity" type="number" min="1" max="10000" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} /><button type="button" aria-label="Increase quantity" onClick={() => setQuantity(String(Math.min(10000, (Number(quantity) || 0) + 1)))}><Plus size={16} /></button></div>
      {type === 'limit' && <><div className="ticket-field-heading"><label htmlFor="limit-price">Limit price</label><span className="ticket-hint">USD per share</span></div><div className="limit-input"><span>$</span><input id="limit-price" type="number" min="0.01" max="100000" step="0.01" value={limitPrice} onChange={event => setLimitPrice(event.target.value)} /></div></>}
    </div>
    <div className="ticket-summary"><div><span>{type === 'market' ? 'Market price' : 'Current price'}</span><strong>{price(quote.price)} <span>/ share</span></strong></div><div><span>Estimated {side === 'buy' ? 'cost' : 'proceeds'}</span><strong>{validQuantity && validLimit ? money(estimatedCents) : '—'}</strong></div><div className="ticket-available"><span>{side === 'buy' ? 'Buying power' : 'Available to sell'}</span><strong>{user ? side === 'buy' ? money(account?.availableCashCents ?? 0) : `${availableShares} ${availableShares === 1 ? 'share' : 'shares'}` : 'Sign in to view'}</strong></div></div>
    {ticketError && <div className="ticket-error" role="alert">{ticketError}</div>}
    {insufficient && <div className="ticket-inline-note">{side === 'buy' ? 'Not enough buying power for this order.' : 'Not enough available shares to sell.'}</div>}
    {!market?.tradingEnabled && <div className="ticket-inline-note">Trading is currently paused.</div>}
    <button className={`button ticket-submit ${side === 'sell' && user ? 'ticket-submit--sell' : 'button--primary'}`} disabled={!canReview} onClick={() => user ? setReview(true) : openAuth('login')}>
      {user ? `Review ${side} order` : 'Sign in to trade'}<ArrowRight size={17} />
    </button>
    <div className="ticket-footnote"><ShieldCheck size={15} /> Simulated orders. No real money is used.</div>
    {review && <Modal onClose={() => setReview(false)} className="review-modal">
      <div className="review-icon"><ArrowUpRight size={24} /></div>
      <div className="review-kicker">REVIEW YOUR ORDER</div><h2>{side === 'buy' ? 'Buy' : 'Sell'} {asset.symbol}</h2><p className="review-subtitle">Take a moment to check the details before placing your paper order.</p>
      <div className="review-asset"><AssetLogo asset={asset} size="md" /><div><strong>{asset.name}</strong><span>{asset.symbol} · {asset.exchange}</span></div></div>
      <div className="review-details"><div><span>Action</span><strong>{side === 'buy' ? 'Buy' : 'Sell'} {shares} {shares === 1 ? 'share' : 'shares'}</strong></div><div><span>Order type</span><strong>{type === 'market' ? 'Market' : 'Limit'}</strong></div>{type === 'limit' && <div><span>Limit price</span><strong>{price(numericLimit)}</strong></div>}<div><span>Estimated {side === 'buy' ? 'cost' : 'proceeds'}</span><strong>{money(estimatedCents)}</strong></div></div>
      <div className="review-note"><Info size={16} /> {type === 'market' ? 'Market orders fill at the latest displayed indicative price, which may change.' : 'Your order may remain pending until the price reaches your limit.'} This is not a real trade.</div>
      <button className="button button--primary review-confirm" onClick={confirm} disabled={submitting}>{submitting ? 'Placing order...' : `Confirm ${side} order`}<ArrowRight size={17} /></button>
      <button className="review-back" onClick={() => setReview(false)}>Go back</button>
    </Modal>}
  </section>;
}

export function TradingWorkspace({ symbol }: { symbol: string }) {
  const { market, marketLoading } = useApp();
  const asset = market?.assets.find(item => item.symbol === symbol) || market?.assets[0];
  const quote = asset ? market?.quotes[asset.symbol] : undefined;
  if ((!asset || !quote) && marketLoading) return <div className="workspace-grid"><div className="panel chart-panel skeleton-panel" /><div className="panel ticket-panel skeleton-panel" /></div>;
  if (!asset || !quote) return <div className="panel unavailable-panel">This market is not available right now.</div>;
  return <div className="workspace-grid"><ChartPanel asset={asset} quote={quote} /><OrderTicket asset={asset} quote={quote} /></div>;
}
