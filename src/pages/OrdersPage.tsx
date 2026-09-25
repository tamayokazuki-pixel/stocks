import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, CheckCircle2, Clock3, ReceiptText, XCircle } from 'lucide-react';
import { AuthGate } from '../components/AuthGate';
import { AssetLogo, EmptyState, LoadingBlock, Modal, PageHeading } from '../components/UI';
import { api, dateTime, errorMessage, money } from '../lib/api';
import { useApp } from '../state/AppContext';
import type { Order } from '../types';

const filters = ['all', 'pending', 'filled', 'cancelled'] as const;

export function OrdersPage() {
  const { user, orders, ordersLoading, refreshPrivate } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof filters)[number]>('all');
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return <div className="page"><PageHeading eyebrow="ORDER ACTIVITY" title="Every move, in one place." description="Review fills, follow pending orders, and stay on top of your trading activity." /><AuthGate title="Your orders are private." description="Sign in to review your paper trades and manage any pending orders." /></div>;
  const shown = orders.filter(order => filter === 'all' || order.status === filter);
  const count = (status: string) => orders.filter(order => order.status === status).length;
  const cancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    try { await api(`/orders/${cancelTarget.id}`, { method: 'DELETE' }); toast.success(`Order #${cancelTarget.id} cancelled`); refreshPrivate(); setCancelTarget(null); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <div className="page orders-page">
    <PageHeading eyebrow="ORDER ACTIVITY" title="Every move, in one place." description="A complete record of your paper trades and open orders." action={<button className="button button--primary" onClick={() => navigate('/markets')}>Place an order <ArrowRight size={17} /></button>} />
    <div className="order-stat-grid"><div className="panel order-stat"><span className="order-stat-icon purple"><ReceiptText size={20} /></span><div><span>Total orders</span><strong>{orders.length}</strong></div></div><div className="panel order-stat"><span className="order-stat-icon amber"><Clock3 size={20} /></span><div><span>Pending</span><strong>{count('pending')}</strong></div></div><div className="panel order-stat"><span className="order-stat-icon mint"><CheckCircle2 size={20} /></span><div><span>Filled</span><strong>{count('filled')}</strong></div></div><div className="panel order-stat"><span className="order-stat-icon gray"><XCircle size={20} /></span><div><span>Cancelled</span><strong>{count('cancelled')}</strong></div></div></div>
    <section className="panel orders-panel"><div className="panel-section-heading"><div><h3>Order history</h3><p>Track every order from placement to completion</p></div><span className="table-caption">Showing up to 200 recent orders</span></div>
      <div className="order-filters" role="group" aria-label="Filter orders">{filters.map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)} <span>{item === 'all' ? orders.length : count(item)}</span></button>)}</div>
      {ordersLoading ? <LoadingBlock height={260} /> : shown.length ? <div className="table-scroll"><table className="orders-table"><thead><tr><th>Asset</th><th>Order</th><th>Quantity</th><th>Price</th><th>Placed</th><th>Status</th><th className="action-column"><span className="sr-only">Action</span></th></tr></thead><tbody>{shown.map(order => <tr key={order.id}><td><div className="table-asset"><AssetLogo asset={order} size="sm" /><div><strong>{order.symbol}</strong><span>{order.name}</span></div></div></td><td><span className={`order-side order-side--${order.side}`}>{order.side}</span><span className="order-type">{order.type}</span></td><td>{order.quantity} {order.quantity === 1 ? 'share' : 'shares'}</td><td className="table-price">{order.filledPriceCents ? money(order.filledPriceCents) : order.limitPriceCents ? money(order.limitPriceCents) : '—'}<small>{order.status === 'pending' ? 'Limit' : 'Filled at'}</small></td><td className="order-date">{dateTime(order.createdAt)}</td><td><span className={`order-status order-status--${order.status}`}><i />{order.status}</span></td><td className="action-column">{order.status === 'pending' ? <button className="cancel-order" onClick={() => setCancelTarget(order)}>Cancel</button> : <button className="table-arrow" aria-label={`View ${order.symbol}`} onClick={() => navigate(`/markets?symbol=${order.symbol}`)}><ArrowRight size={17} /></button>}</td></tr>)}</tbody></table></div> : <EmptyState icon={<ReceiptText size={28} />} title={filter === 'all' ? 'No orders just yet' : `No ${filter} orders`} description={filter === 'all' ? 'When you place a paper trade, you can follow it here.' : 'Try another filter to see your order history.'} action={filter === 'all' ? 'Explore markets' : undefined} onAction={() => navigate('/markets')} />}
    </section>
    <div className="orders-note"><Clock3 size={17} /><span>Limit orders reserve your buying power or shares until filled or cancelled. Orders fill automatically when the simulated or indicative price meets your limit.</span></div>
    {cancelTarget && <Modal onClose={() => setCancelTarget(null)} className="confirm-modal"><div className="confirm-icon confirm-icon--amber"><XCircle size={24} /></div><h2>Cancel this order?</h2><p>Your {cancelTarget.side} order for {cancelTarget.quantity} {cancelTarget.symbol} {cancelTarget.quantity === 1 ? 'share' : 'shares'} will be cancelled and any reserved funds or shares released.</p><div className="confirm-actions"><button className="button button--outline" onClick={() => setCancelTarget(null)}>Keep order</button><button className="button button--danger" disabled={busy} onClick={cancel}>{busy ? 'Cancelling...' : 'Cancel order'}</button></div></Modal>}
  </div>;
}
