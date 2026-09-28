import { AdminTransfers } from '../components/AdminTransfers';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, ArrowRight, Bell, Check, DollarSign, Edit3, LockKeyhole, Plus, ShieldCheck, SlidersHorizontal, Users, X } from 'lucide-react';
import { AssetLogo, LoadingBlock, Modal, PageHeading } from '../components/UI';
import { api, dateTime, errorMessage, money, shortDate } from '../lib/api';
import { useApp } from '../state/AppContext';
import type { AdminOverview, Asset, AuditEntry, User } from '../types';

type AdminTab = 'assets' | 'users' | 'updates' | 'activity' | 'transfers';
type Confirmation = { title: string; description: string; action: () => Promise<boolean>; dangerous?: boolean };
const tabs: { id: AdminTab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'assets', label: 'Assets', icon: SlidersHorizontal },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'updates', label: 'Announcements', icon: Bell },
  { id: 'activity', label: 'Activity log', icon: Activity },
  { id: 'transfers', label: 'Bank & wallet', icon: DollarSign },
];

function Toggle({ checked, onClick, label, disabled }: { checked: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}`} role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={onClick}><span /></button>;
}

export function AdminPage() {
  const { user, authLoading, openAuth, signOut, market } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<AdminTab>('assets');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [adjustUser, setAdjustUser] = useState<User | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<'add' | 'remove'>('add');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [newAsset, setNewAsset] = useState({ symbol: '', name: '', sector: 'Technology', exchange: 'NASDAQ', kind: 'stock', basePrice: '', color: '#5265a8' });
  const [newNotice, setNewNotice] = useState({ title: '', body: '' });
  const overviewQuery = useQuery<AdminOverview>({ queryKey: ['admin', 'overview'], queryFn: () => api('/admin/overview'), enabled: isAdmin });
  const assetsQuery = useQuery<{ assets: Asset[] }>({ queryKey: ['admin', 'assets'], queryFn: () => api('/admin/assets'), enabled: isAdmin });
  const usersQuery = useQuery<{ users: User[] }>({ queryKey: ['admin', 'users'], queryFn: () => api('/admin/users'), enabled: isAdmin });
  const auditQuery = useQuery<{ entries: AuditEntry[] }>({ queryKey: ['admin', 'audit'], queryFn: () => api('/admin/audit'), enabled: isAdmin && tab === 'activity' });
  const overview = overviewQuery.data;
  const assets = assetsQuery.data?.assets || [];
  const users = usersQuery.data?.users || [];

  const mutate = async (path: string, method: string, body: object, success: string): Promise<boolean> => {
    setBusy(path);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      toast.success(success);
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      queryClient.invalidateQueries({ queryKey: ['market'] });
      queryClient.invalidateQueries({ queryKey: ['account'] });
      return true;
    } catch (error) { toast.error(errorMessage(error)); return false; }
    finally { setBusy(''); }
  };

  if (authLoading) return <div className="page"><LoadingBlock height={400} /></div>;
  if (!isAdmin) return <div className="page"><PageHeading eyebrow="ADMIN WORKSPACE" title="Control center." description="This workspace is reserved for Northstar administrators." /><div className="admin-denied panel"><div className="admin-denied-icon"><LockKeyhole size={30} /></div><h2>Administrator access only</h2><p>Sign in with an administrator account to manage listings, users, announcements, and trading controls.</p>{user ? <button className="button button--primary" onClick={async () => { await signOut(); openAuth('login'); navigate('/admin'); }}>Switch account <ArrowRight size={16} /></button> : <button className="button button--primary" onClick={() => openAuth('login')}>Sign in <ArrowRight size={16} /></button>}</div></div>;

  const submitAsset = async (event: FormEvent) => {
    event.preventDefault();
    const done = await mutate('/admin/assets', 'POST', { ...newAsset, basePrice: Number(newAsset.basePrice) }, `${newAsset.symbol.toUpperCase()} added to the market`);
    if (done) { setAddOpen(false); setNewAsset({ symbol: '', name: '', sector: 'Technology', exchange: 'NASDAQ', kind: 'stock', basePrice: '', color: '#5265a8' }); }
  };
  const submitNotice = async (event: FormEvent) => {
    event.preventDefault();
    const done = await mutate('/admin/announcements', 'POST', newNotice, 'Announcement published');
    if (done) setNewNotice({ title: '', body: '' });
  };
  const adjustFunds = async (event: FormEvent) => {
    event.preventDefault();
    if (!adjustUser) return;
    const cents = Math.round(Number(adjustAmount) * 100) * (adjustDirection === 'add' ? 1 : -1);
    const done = await mutate(`/admin/users/${adjustUser.id}`, 'PATCH', { action: 'adjustCash', amountCents: cents }, `Paper funds ${adjustDirection === 'add' ? 'added to' : 'removed from'} ${adjustUser.name}'s account`);
    if (done) { setAdjustUser(null); setAdjustAmount(''); }
  };
  const updatePrice = async (event: FormEvent) => {
    event.preventDefault();
    if (!editAsset) return;
    const done = await mutate(`/admin/assets/${editAsset.symbol}`, 'PATCH', { basePrice: Number(editPrice) }, `${editAsset.symbol} demo reference price updated`);
    if (done) setEditAsset(null);
  };
  const toggleTrading = () => setConfirm({ title: overview?.tradingEnabled ? 'Pause all paper trading?' : 'Resume paper trading?', description: overview?.tradingEnabled ? 'New orders will be blocked and pending limit orders will stop matching until trading resumes. Users can still view the market.' : 'Users will be able to place paper orders again, and pending limit orders can begin filling on the next price update.', dangerous: overview?.tradingEnabled, action: () => mutate('/admin/settings', 'PATCH', { tradingEnabled: !overview?.tradingEnabled }, overview?.tradingEnabled ? 'Paper trading paused' : 'Paper trading resumed') });

  return <div className="page admin-page">
    <PageHeading eyebrow="ADMIN WORKSPACE" title="Control center." description="Manage your trading workspace, from the assets people see to the updates they receive." action={<span className="admin-access-pill"><ShieldCheck size={16} /> Admin access</span>} />
    <div className="admin-stats"><div className="panel admin-stat"><span className="admin-stat-icon blue"><Users size={21} /></span><span>Registered traders</span><strong>{overview?.users.total ?? '—'}</strong><small>{overview?.users.active ?? 0} active accounts</small></div><div className="panel admin-stat"><span className="admin-stat-icon mint"><Activity size={21} /></span><span>Total orders</span><strong>{overview?.orders.total ?? '—'}</strong><small>{overview?.orders.pending ?? 0} pending now</small></div><div className="panel admin-stat"><span className="admin-stat-icon violet"><SlidersHorizontal size={21} /></span><span>Listed assets</span><strong>{overview?.assets.active ?? '—'}</strong><small>of {overview?.assets.total ?? 0} total assets</small></div><div className="panel admin-stat"><span className="admin-stat-icon amber"><DollarSign size={21} /></span><span>Paper trade volume</span><strong>{overview ? money(overview.orders.volumeCents) : '—'}</strong><small>All filled orders</small></div></div>
    <div className={`admin-control ${overview?.tradingEnabled ? '' : 'admin-control--paused'}`}><div className="admin-control-icon"><ShieldCheck size={22} /></div><div><span>SYSTEM CONTROL</span><h3>Paper trading is {overview?.tradingEnabled ? 'active' : 'paused'}</h3><p>{overview?.tradingEnabled ? 'Traders can place orders and pending limits can fill.' : 'New orders and limit-order matching are temporarily disabled.'}</p></div><button className={`button ${overview?.tradingEnabled ? 'button--outline' : 'button--primary'}`} onClick={toggleTrading}>{overview?.tradingEnabled ? 'Pause trading' : 'Resume trading'}</button></div>
    <div className="admin-tabs" role="tablist" aria-label="Admin sections">{tabs.map(item => { const Icon = item.icon; return <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><Icon size={17} /> {item.label}</button>; })}</div>
    {tab === 'transfers' && <AdminTransfers key={user.id} />}
    {tab === 'assets' && <section className="panel admin-section"><div className="panel-section-heading"><div><h3>Asset directory</h3><p>Manage what appears in the trading workspace</p></div><button className="button button--primary button--small" onClick={() => setAddOpen(true)}><Plus size={16} /> Add asset</button></div><div className="table-scroll"><table className="admin-table"><thead><tr><th>Asset</th><th>Exchange</th><th>Demo reference</th><th>Visible</th><th>Featured</th><th className="action-column">Edit</th></tr></thead><tbody>{assets.map(asset => <tr key={asset.symbol}><td><div className="table-asset"><AssetLogo asset={asset} size="sm" /><div><strong>{asset.symbol} <span className={asset.active ? 'listing-dot' : 'listing-dot listing-dot--off'} /></strong><span>{asset.name}</span></div></div></td><td>{asset.exchange}</td><td className="table-price">{money(asset.basePriceCents)}</td><td><Toggle checked={asset.active} label={`${asset.active ? 'Hide' : 'Show'} ${asset.symbol}`} disabled={!!busy} onClick={() => mutate(`/admin/assets/${asset.symbol}`, 'PATCH', { active: !asset.active }, `${asset.symbol} ${asset.active ? 'hidden' : 'listed'}`)} /></td><td><Toggle checked={asset.featured} label={`${asset.featured ? 'Unfeature' : 'Feature'} ${asset.symbol}`} disabled={!!busy} onClick={() => mutate(`/admin/assets/${asset.symbol}`, 'PATCH', { featured: !asset.featured }, `${asset.symbol} ${asset.featured ? 'unfeatured' : 'featured'}`)} /></td><td className="action-column"><button className="admin-icon-button" aria-label={`Edit ${asset.symbol} reference price`} title="Edit demo reference price" onClick={() => { setEditAsset(asset); setEditPrice((asset.basePriceCents / 100).toFixed(2)); }}><Edit3 size={17} /></button></td></tr>)}</tbody></table></div><div className="admin-table-footer"><ShieldCheck size={15} /> Hiding an asset cancels its pending orders. Existing holdings remain in users' portfolios. Demo reference prices do not override live provider quotes.</div></section>}
    {tab === 'users' && <section className="panel admin-section"><div className="panel-section-heading"><div><h3>Traders & accounts</h3><p>Manage access and virtual cash balances</p></div><span className="table-caption">{users.length} accounts</span></div><div className="table-scroll"><table className="admin-table"><thead><tr><th>Trader</th><th>Joined</th><th>Cash balance</th><th>Status</th><th className="admin-user-actions">Actions</th></tr></thead><tbody>{users.map(person => <tr key={person.id}><td><div className="admin-user-cell"><span className="admin-user-avatar">{person.name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span><span><strong>{person.name} {person.role === 'admin' && <span className="admin-role-label">ADMIN</span>}</strong><small>{person.email}</small></span></div></td><td>{shortDate(person.createdAt)}</td><td className="table-price">{money(person.cashCents)}</td><td><span className={`user-status user-status--${person.status}`}><i />{person.status}</span></td><td className="admin-user-actions">{person.role !== 'admin' && <><button className="admin-action-link" onClick={() => { setAdjustUser(person); setAdjustAmount(''); setAdjustDirection('add'); }}>Adjust funds</button><button className={`admin-action-link ${person.status === 'active' ? 'danger-text' : ''}`} onClick={() => setConfirm({ title: person.status === 'active' ? `Suspend ${person.name}?` : `Reactivate ${person.name}?`, description: person.status === 'active' ? 'They will be signed out immediately, and their pending orders will be cancelled. Their holdings and virtual cash are kept.' : 'This trader will be able to sign in and place paper orders again.', dangerous: person.status === 'active', action: () => mutate(`/admin/users/${person.id}`, 'PATCH', { action: person.status === 'active' ? 'suspend' : 'activate' }, `${person.name}'s account ${person.status === 'active' ? 'suspended' : 'reactivated'}`) })}>{person.status === 'active' ? 'Suspend' : 'Activate'}</button></>}</td></tr>)}</tbody></table></div><div className="admin-table-footer"><LockKeyhole size={15} /> Admin accounts cannot be suspended or funded from this screen. Every change is recorded in the activity log.</div></section>}
    {tab === 'updates' && <div className="admin-updates-grid"><section className="panel admin-section"><div className="panel-section-heading"><div><h3>Publish an announcement</h3><p>Share important updates with everyone</p></div><Bell size={18} className="section-icon" /></div><form className="admin-form" onSubmit={submitNotice}><label className="field-label">Title<input required minLength={3} maxLength={100} placeholder="e.g. New stocks are now available" value={newNotice.title} onChange={event => setNewNotice({ ...newNotice, title: event.target.value })} /></label><label className="field-label">Message<textarea required minLength={10} maxLength={600} rows={5} placeholder="Write a clear update for your traders..." value={newNotice.body} onChange={event => setNewNotice({ ...newNotice, body: event.target.value })} /></label><p>Active announcements appear in the notification menu and Insights page.</p><button className="button button--primary" disabled={!!busy} type="submit"><Plus size={16} /> Publish update</button></form></section><section className="panel admin-section"><div className="panel-section-heading"><div><h3>Published updates</h3><p>Control what traders can see</p></div><span className="table-caption">{overview?.notices.length || 0} total</span></div><div className="admin-notice-list">{overview?.notices.map(notice => <div className="admin-notice" key={notice.id}><div className="admin-notice-head"><span className={`user-status user-status--${notice.active ? 'active' : 'suspended'}`}><i />{notice.active ? 'Published' : 'Hidden'}</span><small>{shortDate(notice.createdAt)}</small></div><h4>{notice.title}</h4><p>{notice.body}</p><button className="admin-action-link" disabled={!!busy} onClick={() => mutate(`/admin/announcements/${notice.id}`, 'PATCH', { active: !notice.active }, notice.active ? 'Announcement hidden' : 'Announcement published')}>{notice.active ? 'Hide announcement' : 'Publish again'} <ArrowRight size={14} /></button></div>)}</div></section></div>}
    {tab === 'activity' && <section className="panel admin-section"><div className="panel-section-heading"><div><h3>Activity log</h3><p>A record of administrative changes</p></div><span className="table-caption">Last 50 events</span></div>{auditQuery.isLoading ? <LoadingBlock height={260} /> : auditQuery.data?.entries.length ? <div className="audit-list">{auditQuery.data.entries.map(entry => <div className="audit-item" key={entry.id}><span className="audit-icon"><Activity size={16} /></span><div><div><strong>{entry.action.replaceAll('_', ' ')}</strong><span>{dateTime(entry.createdAt)}</span></div><p>{entry.detail}</p><small>By {entry.actorName || 'System'}{entry.targetName ? ` · ${entry.targetName}` : ''}</small></div></div>)}</div> : <div className="admin-empty-log">No administrative changes have been made yet.</div>}</section>}
    <div className="admin-bottom-note"><ShieldCheck size={16} /> This console controls the paper trading environment only. It is not connected to a brokerage or an exchange. {market?.mode === 'demo' ? 'Market prices are currently simulated.' : 'Provider quotes may be delayed.'}</div>
    {confirm && <Modal onClose={() => setConfirm(null)} className="confirm-modal"><div className={`confirm-icon ${confirm.dangerous ? 'confirm-icon--amber' : ''}`}><ShieldCheck size={24} /></div><h2>{confirm.title}</h2><p>{confirm.description}</p><div className="confirm-actions"><button className="button button--outline" onClick={() => setConfirm(null)}>Go back</button><button className={`button ${confirm.dangerous ? 'button--danger' : 'button--primary'}`} disabled={!!busy} onClick={async () => { if (await confirm.action()) setConfirm(null); }}>{busy ? 'Updating...' : 'Confirm change'}</button></div></Modal>}
    {addOpen && <Modal onClose={() => setAddOpen(false)} className="admin-form-modal"><div className="modal-form-icon"><Plus size={22} /></div><h2>Add a new asset</h2><p className="modal-form-intro">Add a symbol to the market directory. The reference price is used for simulated quotes.</p><form onSubmit={submitAsset} className="admin-form"><div className="form-row"><label className="field-label">Ticker symbol<input required maxLength={8} placeholder="e.g. NFLX" value={newAsset.symbol} onChange={event => setNewAsset({ ...newAsset, symbol: event.target.value.toUpperCase() })} /></label><label className="field-label">Type<select value={newAsset.kind} onChange={event => setNewAsset({ ...newAsset, kind: event.target.value })}><option value="stock">Stock</option><option value="etf">ETF</option></select></label></div><label className="field-label">Company or fund name<input required minLength={2} maxLength={80} placeholder="e.g. Netflix, Inc." value={newAsset.name} onChange={event => setNewAsset({ ...newAsset, name: event.target.value })} /></label><div className="form-row"><label className="field-label">Sector<input required minLength={2} maxLength={40} value={newAsset.sector} onChange={event => setNewAsset({ ...newAsset, sector: event.target.value })} /></label><label className="field-label">Exchange<input required minLength={2} maxLength={40} value={newAsset.exchange} onChange={event => setNewAsset({ ...newAsset, exchange: event.target.value })} /></label></div><div className="form-row"><label className="field-label">Demo reference price (USD)<input required type="number" min="0.01" max="100000" step="0.01" placeholder="0.00" value={newAsset.basePrice} onChange={event => setNewAsset({ ...newAsset, basePrice: event.target.value })} /></label><label className="field-label">Logo color<input type="color" value={newAsset.color} onChange={event => setNewAsset({ ...newAsset, color: event.target.value })} /></label></div><button className="button button--primary admin-form-submit" type="submit" disabled={!!busy}>{busy ? 'Adding...' : 'Add to directory'} <ArrowRight size={16} /></button></form></Modal>}
    {editAsset && <Modal onClose={() => setEditAsset(null)} className="admin-form-modal"><div className="modal-form-icon"><Edit3 size={22} /></div><h2>Edit {editAsset.symbol} reference price</h2><p className="modal-form-intro">This changes the simulated quote baseline. If a provider quote is available, it takes precedence.</p><form className="admin-form" onSubmit={updatePrice}><label className="field-label">Demo reference price (USD)<input required type="number" min="0.01" max="100000" step="0.01" value={editPrice} onChange={event => setEditPrice(event.target.value)} /></label><button className="button button--primary admin-form-submit" disabled={!!busy} type="submit">Save price <Check size={16} /></button></form></Modal>}
    {adjustUser && <Modal onClose={() => setAdjustUser(null)} className="admin-form-modal"><div className="modal-form-icon"><DollarSign size={22} /></div><h2>Adjust virtual funds</h2><p className="modal-form-intro">Change {adjustUser.name}'s paper cash balance. Current cash: <strong>{money(adjustUser.cashCents)}</strong>.</p><form className="admin-form" onSubmit={adjustFunds}><div className="adjust-direction"><button type="button" className={adjustDirection === 'add' ? 'active' : ''} onClick={() => setAdjustDirection('add')}><Plus size={16} /> Add funds</button><button type="button" className={adjustDirection === 'remove' ? 'active' : ''} onClick={() => setAdjustDirection('remove')}><X size={16} /> Remove funds</button></div><label className="field-label">Amount in USD<input required type="number" min="0.01" max="1000000" step="0.01" placeholder="0.00" value={adjustAmount} onChange={event => setAdjustAmount(event.target.value)} /></label><p>Adjustments are recorded in the activity log. Cash reserved for pending orders cannot be removed.</p><button className="button button--primary admin-form-submit" disabled={!!busy} type="submit">Confirm adjustment <ArrowRight size={16} /></button></form></Modal>}
  </div>;
}
