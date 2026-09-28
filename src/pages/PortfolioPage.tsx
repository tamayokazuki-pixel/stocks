import { ManualTransfers } from '../components/ManualTransfers';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, BriefcaseBusiness, CircleDollarSign, Info, Layers3, TrendingUp, Wallet } from 'lucide-react';
import { AuthGate } from '../components/AuthGate';
import { AssetLogo, EmptyState, LoadingBlock, Modal, PageHeading, Trend } from '../components/UI';
import { api, errorMessage, money, price, signedMoney, signedPercent } from '../lib/api';
import { useApp } from '../state/AppContext';
import type { CashTransaction } from '../types';

const allocationColors = ['#95e4c1', '#8da7ff', '#f1b97b', '#d3a8f0', '#89d3e8', '#f3a9af', '#bdd58d'];

export function PortfolioPage() {
  const { user, account, accountLoading, market } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cashAction, setCashAction] = useState<'top_up' | 'withdrawal' | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [cashError, setCashError] = useState('');
  const cashTransactionsQuery = useQuery<{ transactions: CashTransaction[] }>({
    queryKey: ['cash-transactions'], queryFn: () => api('/account/cash-transactions'), enabled: !!user,
  });
  if (!user) return <div className="page"><PageHeading eyebrow="YOUR PORTFOLIO" title="Everything you own, in one view." description="Track positions, buying power, and the progress of your paper portfolio." /><AuthGate title="Your portfolio is waiting." description="Sign in to see your holdings, follow your performance, and make your next move." /></div>;
  if (!account && accountLoading) return <div className="page"><PageHeading eyebrow="YOUR PORTFOLIO" title="Your portfolio." description="Your investments, all together." /><LoadingBlock height={420} /></div>;
  if (!account) return null;
  const positions = [...account.positions].sort((a, b) => b.marketValueCents - a.marketValueCents);
  const costBasis = positions.reduce((sum, item) => sum + item.costBasisCents, 0);
  const returnPercent = costBasis ? account.totalReturnCents / costBasis * 100 : 0;
  return <div className="page portfolio-page">
    <PageHeading eyebrow={user.isDemo ? 'SHARED DEMO ACCOUNT' : 'YOUR PORTFOLIO'} title={user.isDemo ? 'The demo portfolio, all together.' : 'Your investments, all together.'} description={user.isDemo ? 'This is the shared sample portfolio everyone sees when they explore Northstar. Switch to your own account for a private balance.' : 'A clear picture of what you hold and how your paper portfolio is doing.'} action={<button className="button button--primary" onClick={() => navigate('/markets')}>Explore markets <ArrowRight size={17} /></button>} />
    <div className="portfolio-hero">
      <div className="portfolio-hero-left"><div className="portfolio-kicker"><span className="portfolio-kicker-dot" /> TOTAL ACCOUNT VALUE <span>·</span> PAPER USD</div><div className="portfolio-total">{money(account.equityCents)}</div><div className={`portfolio-day ${account.dayChangeCents >= 0 ? 'up' : 'down'}`}><TrendingUp size={17} /> {signedMoney(account.dayChangeCents)} ({signedPercent(account.dayChangePercent)}) <span>today</span></div><div className="portfolio-hero-divider" /><div className="portfolio-hero-metrics"><div><span>Invested value</span><strong>{money(account.portfolioValueCents)}</strong></div><div><span>Available to trade</span><strong>{money(account.availableCashCents)}</strong></div></div></div>
      <div className="portfolio-allocation"><div className="allocation-chart">{positions.length ? <><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={positions} dataKey="marketValueCents" cx="50%" cy="50%" innerRadius={65} outerRadius={89} stroke="none" paddingAngle={3} isAnimationActive={false}>{positions.map((position, index) => <Cell key={position.symbol} fill={allocationColors[index % allocationColors.length]} />)}</Pie><Tooltip formatter={value => money(Number(value))} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,.16)', fontFamily: 'DM Sans' }} /></PieChart></ResponsiveContainer><div className="allocation-center"><strong>{positions.length}</strong><span>{positions.length === 1 ? 'holding' : 'holdings'}</span></div></> : <div className="allocation-empty"><Layers3 size={32} /><span>No holdings yet</span></div>}</div><div className="allocation-legend"><span className="allocation-title">YOUR ALLOCATION</span>{positions.slice(0, 4).map((position, index) => <div key={position.symbol}><i style={{ background: allocationColors[index % allocationColors.length] }} /><span>{position.symbol}</span><strong>{account.portfolioValueCents ? (position.marketValueCents / account.portfolioValueCents * 100).toFixed(1) : 0}%</strong></div>)}</div></div>
    </div>
    <div className="portfolio-stats"><div className="portfolio-small-stat panel"><span className="small-stat-icon mint"><TrendingUp size={19} /></span><div><span>Position return</span><strong className={account.totalReturnCents >= 0 ? 'positive-text' : 'negative-text'}>{signedMoney(account.totalReturnCents)}</strong><small>{signedPercent(returnPercent)} vs. average purchase cost</small></div></div><div className="portfolio-small-stat panel"><span className="small-stat-icon blue"><CircleDollarSign size={19} /></span><div><span>Today's change</span><strong className={account.dayChangeCents >= 0 ? 'positive-text' : 'negative-text'}>{signedMoney(account.dayChangeCents)}</strong><small>Based on previous closing prices</small></div></div><div className="portfolio-small-stat panel"><span className="small-stat-icon violet"><Wallet size={19} /></span><div><span>Cash balance</span><strong>{money(account.cashCents)}</strong><small>{account.reservedCashCents ? `${money(account.reservedCashCents)} reserved for orders` : 'No cash reserved'}</small></div></div></div>
    <ManualTransfers key={user.id} />
    <section className="cash-management panel" aria-labelledby="cash-management-title">
      <div className="cash-management-copy">
        <span className="small-stat-icon violet"><Wallet size={19} /></span>
        <div><span className="cash-eyebrow">SIMULATED ACCOUNT CASH</span><h2 id="cash-management-title">Manage your paper funds</h2>
          <p>Top up your virtual buying power or withdraw available cash. No bank or payment details are used.</p>
          <div className="cash-available">Available to withdraw <strong>{money(account.availableCashCents)}</strong>{account.reservedCashCents > 0 && <small>{money(account.reservedCashCents)} is reserved for pending orders</small>}</div>
        </div>
      </div>
      <div className="cash-management-actions">
        <button className="button button--primary" onClick={() => { setCashAction('top_up'); setCashAmount(''); setCashError(''); }}><ArrowDownToLine size={17} /> Top up</button>
        <button className="button button--outline" disabled={account.availableCashCents < 100} onClick={() => { setCashAction('withdrawal'); setCashAmount(''); setCashError(''); }}><ArrowUpFromLine size={17} /> Withdraw</button>
      </div>
    </section>
    <section className="cash-activity panel" aria-labelledby="cash-activity-title">
      <div className="panel-section-heading"><div><h3 id="cash-activity-title">Cash activity</h3><p>Your latest simulated top-ups and withdrawals</p></div><span className="table-caption">Most recent 50</span></div>
      {cashTransactionsQuery.isLoading ? <div className="cash-activity-empty">Loading cash activity…</div> : cashTransactionsQuery.data?.transactions.length ?
        <div className="cash-transaction-list">{cashTransactionsQuery.data.transactions.map(item => <div className="cash-transaction-row" key={item.id}>
          <span className={`cash-transaction-icon ${item.type === 'top_up' ? 'cash-transaction-icon--in' : 'cash-transaction-icon--out'}`}>{item.type === 'top_up' ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}</span>
          <span className="cash-transaction-label"><strong>{item.type === 'top_up' ? 'Virtual cash top up' : 'Virtual cash withdrawal'}</strong><small>{new Date(item.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
          <strong className={`cash-transaction-amount ${item.type === 'top_up' ? 'positive-text' : ''}`}>{item.type === 'top_up' ? '+' : '−'}{money(item.amountCents)}</strong>
          <span className="cash-transaction-balance"><small>Balance after</small><strong>{money(item.balanceAfterCents)}</strong></span>
        </div>)}</div> : <div className="cash-activity-empty">No cash activity yet. Your first top up or withdrawal will appear here.</div>}
    </section>
    {cashAction && <CashTransactionModal action={cashAction} amount={cashAmount} setAmount={setCashAmount} error={cashError} setError={setCashError} submitting={cashSubmitting} setSubmitting={setCashSubmitting} account={account} onClose={() => setCashAction(null)} onComplete={async () => {
      setCashSubmitting(true); setCashError('');
      const amountCents = Math.round(Number(cashAmount) * 100);
      try {
        await api<{ transaction: CashTransaction }>('/account/cash-transactions', { method: 'POST', body: JSON.stringify({ type: cashAction, amountCents }) });
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['account'] }), queryClient.invalidateQueries({ queryKey: ['cash-transactions'] })]);
        toast.success(cashAction === 'top_up' ? 'Virtual funds added' : 'Virtual withdrawal complete', { description: `${money(amountCents)} ${cashAction === 'top_up' ? 'added to' : 'removed from'} your paper account.` });
        setCashAction(null);
      } catch (error) { setCashError(errorMessage(error)); }
      finally { setCashSubmitting(false); }
    }} />}
    <section className="panel holdings-panel"><div className="panel-section-heading"><div><h3>Your holdings</h3><p>Every position, with the details that matter</p></div><span className="table-caption">{positions.length} {positions.length === 1 ? 'asset' : 'assets'} held</span></div>
      {positions.length ? <div className="table-scroll"><table className="holdings-table"><thead><tr><th>Asset</th><th>Shares</th><th>Avg. cost</th><th>Market price</th><th>Market value</th><th>Return</th><th className="action-column"><span className="sr-only">Trade</span></th></tr></thead><tbody>{positions.map(position => {
        const asset = market?.assets.find(item => item.symbol === position.symbol) || { symbol: position.symbol, color: position.color };
        const returnPct = position.costBasisCents ? position.totalReturnCents / position.costBasisCents * 100 : 0;
        return <tr key={position.symbol}><td><div className="table-asset"><AssetLogo asset={asset} size="sm" /><div><strong>{position.symbol}</strong><span>{position.name}</span></div></div></td><td>{position.quantity}</td><td>{money(position.averageCostCents)}</td><td>{price(position.price)}</td><td className="table-price">{money(position.marketValueCents)}</td><td><div className="return-cell"><strong className={position.totalReturnCents >= 0 ? 'positive-text' : 'negative-text'}>{signedMoney(position.totalReturnCents)}</strong><Trend value={returnPct} subtle /></div></td><td className="action-column"><button className="table-arrow" onClick={() => navigate(`/markets?symbol=${position.symbol}`)} aria-label={`Trade ${position.symbol}`}><ArrowRight size={17} /></button></td></tr>;
      })}</tbody></table></div> : <EmptyState icon={<BriefcaseBusiness size={28} />} title="A blank canvas for your first investment" description="Your positions will appear here after you place a paper buy order." action="Browse markets" onAction={() => navigate('/markets')} />}
    </section>
    <p className="portfolio-footnote">Values are based on {market?.mode === 'demo' ? 'simulated prices' : `live ${market?.provider} quotes (possibly delayed)`}. Returns exclude fees and are not a prediction of future results.</p>
  </div>;
}


function CashTransactionModal({ action, amount, setAmount, error, setError, submitting, setSubmitting, account, onClose, onComplete }: {
  action: 'top_up' | 'withdrawal'; amount: string; setAmount: (value: string) => void; error: string; setError: (value: string) => void;
  submitting: boolean; setSubmitting: (value: boolean) => void; account: NonNullable<ReturnType<typeof useApp>['account']>;
  onClose: () => void; onComplete: () => Promise<void>;
}) {
  const cents = Math.round(Number(amount) * 100);
  const validAmount = /^\d{1,6}(?:\.\d{1,2})?$/.test(amount) && Number.isSafeInteger(cents) && cents >= 100 && cents <= 10_000_000;
  const exceedsAvailable = action === 'withdrawal' && cents > account.availableCashCents;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validAmount || exceedsAvailable || submitting) return;
    setSubmitting(true);
    try { await onComplete(); } finally { setSubmitting(false); }
  };
  return <Modal onClose={onClose} className="cash-modal">
    <div className={`cash-modal-icon ${action === 'top_up' ? 'cash-modal-icon--in' : 'cash-modal-icon--out'}`}>{action === 'top_up' ? <ArrowDownToLine size={23} /> : <ArrowUpFromLine size={23} />}</div>
    <div className="review-kicker">VIRTUAL FUNDS ONLY</div><h2>{action === 'top_up' ? 'Top up your account' : 'Withdraw paper cash'}</h2>
    <p className="cash-modal-description">{action === 'top_up' ? 'Add simulated funds to your paper trading balance.' : 'Move available simulated cash out of your paper trading balance.'} This does not move real money.</p>
    <div className="cash-modal-balance"><span>{action === 'top_up' ? 'Current cash balance' : 'Available to withdraw'}</span><strong>{money(action === 'top_up' ? account.cashCents : account.availableCashCents)}</strong></div>
    <form onSubmit={submit}>
      <label className="cash-amount-label" htmlFor="cash-amount">Amount <span>USD</span></label>
      <div className="cash-amount-input"><span>$</span><input id="cash-amount" autoFocus inputMode="decimal" type="number" min="1" max="100000" step="0.01" value={amount} onChange={event => { setAmount(event.target.value); setError(''); }} placeholder="0.00" /></div>
      <small className="cash-amount-hint">Enter $1.00–$100,000.00. {action === 'withdrawal' && 'Pending orders reduce the amount available to withdraw.'}</small>
      {exceedsAvailable && <p className="cash-modal-error" role="alert">That amount is greater than your available cash.</p>}
      {error && <p className="cash-modal-error" role="alert">{error}</p>}
      <div className="cash-modal-disclosure"><Info size={15} /> Northstar is a paper-trading simulator. Top-ups and withdrawals are virtual balance adjustments only; no payment provider or bank account is connected.</div>
      <button className="button button--primary cash-modal-submit" type="submit" disabled={!validAmount || exceedsAvailable || submitting}>{submitting ? 'Processing…' : action === 'top_up' ? 'Add virtual funds' : 'Confirm withdrawal'}<ArrowRight size={17} /></button>
    </form>
  </Modal>;
}
