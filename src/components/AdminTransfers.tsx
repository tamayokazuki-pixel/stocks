import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, dateTime, errorMessage, money } from '../lib/api';
import { useApp } from '../state/AppContext';
import { Modal } from './UI';
import { emptyBank, methodLabel, transferDisclosure, TransferDetailsFields, TransferDetailsView } from './TransferDetails';
import type { TransferDetails, TransferMethod, TransferRequest, TransferStatus } from '../types';

export function AdminTransfers() {
  const { user } = useApp();
  const client = useQueryClient();
  const [status, setStatus] = useState<TransferStatus>('pending');
  const [before, setBefore] = useState<number | null>(null);
  const [addMethod, setAddMethod] = useState(false);
  const [review, setReview] = useState<TransferRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const config = useQuery<{ enabled: boolean }>({ queryKey: ['transfers', user?.id, 'config'], queryFn: () => api('/transfers/config') });
  const enabled = !!config.data?.enabled;
  const methods = useQuery<{ methods: TransferMethod[] }>({ queryKey: ['admin', 'transfers', user?.id, 'methods'], queryFn: () => api('/admin/transfers/methods'), enabled });
  const requests = useQuery<{ requests: TransferRequest[]; nextBefore: number | null }>({
    queryKey: ['admin', 'transfers', user?.id, 'requests', status, before],
    queryFn: () => api(`/admin/transfers/requests?status=${status}${before ? `&before=${before}` : ''}`), enabled, refetchInterval: 30000,
  });
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['admin', 'transfers'] }), client.invalidateQueries({ queryKey: ['transfers'] }), client.invalidateQueries({ queryKey: ['admin', 'audit'] })]);
  };
  const claim = async (request: TransferRequest) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ request: TransferRequest }>(`/admin/transfers/requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'processing' }) });
      await refresh(); setReview(result.request);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const toggle = async (method: TransferMethod) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/admin/transfers/methods/${method.id}`, { method: 'PATCH', body: JSON.stringify({ active: !method.active }) });
      await refresh(); toast.success('Receiving method updated');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <section className="panel manual-transfers">
    <div className="transfer-heading"><div><span className="cash-eyebrow">OPERATOR WORKSPACE</span><h2>Manual bank & wallet transfers</h2><p>{transferDisclosure}</p></div></div>
    {config.isPending ? <p>Loading configuration…</p> : config.isError ? <p role="alert">{errorMessage(config.error)} <button onClick={() => config.refetch()}>Retry</button></p> : !enabled ? <div className="transfer-notice"><strong>Setup required</strong><p>Set MANUAL_TRANSFERS_ENABLED=true and a persistent TRANSFER_DETAILS_KEY on the server, then restart. See README for key generation and production requirements. Do not collect real funds on a demo deployment.</p></div> : <>
      <div className="transfer-heading"><h3>Receiving accounts</h3><button className="button button--primary button--small" onClick={() => setAddMethod(true)}>Add bank / wallet</button></div>
      <p className="transfer-help">These are your operator-owned deposit destinations, visible to signed-in users. To change details, disable the old account and add a new one. Existing requests retain their original details.</p>
      {methods.isPending ? <p>Loading accounts…</p> : methods.isError ? <p role="alert">{errorMessage(methods.error)} <button onClick={() => methods.refetch()}>Retry</button></p> : !methods.data?.methods.length ? <p>No receiving accounts yet.</p> : <div className="transfer-list">{methods.data.methods.map(method => <article key={method.id} className="transfer-record"><div className="transfer-record-heading"><strong>{methodLabel(method.details)}</strong><span className="transfer-status">{method.active ? 'Active' : 'Disabled'}</span></div><details><summary>View receiving details</summary><TransferDetailsView details={method.details} /></details><button className="button button--outline button--small" disabled={busy} onClick={() => toggle(method)}>{method.active ? 'Disable' : 'Enable'} method</button></article>)}</div>}
      <div className="transfer-heading"><h3>Review queue</h3><label className="field-label">Request status<select value={status} onChange={event => { setStatus(event.target.value as TransferStatus); setBefore(null); }}><option value="pending">Pending</option><option value="processing">Processing (claimed)</option><option value="completed">Completed externally</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label></div>
      <p className="transfer-notice">Claim a pending request before doing any external work; only the claiming administrator can finish it. Before paying a withdrawal, independently verify identity, account ownership, the external ledger balance, prior payouts, and any reservations. Never use the paper balance. Before confirming a deposit, verify actual receipt and check the reference against previous deposits. This queue is not a custody ledger or payment processor.</p>
      {requests.isPending ? <p>Loading requests…</p> : requests.isError ? <p role="alert">{errorMessage(requests.error)} <button onClick={() => requests.refetch()}>Retry</button></p> : !requests.data?.requests.length ? <p>No {status} requests.</p> : <div className="transfer-list">{requests.data.requests.map(request => <article className="transfer-record" key={request.id}>
        <div className="transfer-record-heading"><strong>#{request.id} · {request.type === 'deposit' ? 'Top-up' : 'Withdrawal'} · {money(request.amountCents)}</strong><span className={`transfer-status transfer-status--${request.status}`}>{request.status === 'completed' ? 'Completed externally' : request.status}</span></div>
        <p>{request.userName} · {request.userEmail} · {dateTime(request.createdAt)}</p>
        <p>{methodLabel(request.details)}</p>
        <details><summary>View request details</summary><TransferDetailsView details={request.details} />{request.reference && <p>Submitted reference: {request.reference}</p>}{request.reviewNote && <p>Review note: {request.reviewNote}</p>}{request.reviewedAt && <p>Updated {dateTime(request.reviewedAt)}</p>}</details>
        {request.status === 'pending' && <button className="button button--outline button--small" disabled={busy || request.userId === user?.id} onClick={() => claim(request)}>{request.userId === user?.id ? 'Requires another admin' : 'Claim & review request'}</button>}
        {request.status === 'processing' && (request.reviewedBy === user?.id ? <button className="button button--outline button--small" onClick={() => setReview(request)}>Continue review</button> : <p>Claimed by another administrator. Do not initiate a payment.</p>)}
      </article>)}</div>}
      <div className="transfer-actions">{before && <button className="button button--outline button--small" onClick={() => setBefore(null)}>Back to latest</button>}{requests.data?.nextBefore && <button className="button button--outline button--small" onClick={() => setBefore(requests.data!.nextBefore)}>Older requests</button>}</div>
      {addMethod && <AddMethodModal onClose={() => setAddMethod(false)} onComplete={refresh} />}
      {review && <ReviewModal request={review} onClose={() => setReview(null)} onComplete={refresh} />}
    </>}
  </section>;
}

function AddMethodModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => Promise<void> }) {
  const [details, setDetails] = useState<TransferDetails>({ ...emptyBank });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true); setError('');
    try {
      await api('/admin/transfers/methods', { method: 'POST', body: JSON.stringify({ details }) });
      await onComplete(); toast.success('Receiving account added'); onClose();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <Modal onClose={() => { if (!busy) onClose(); }} className="transfer-modal"><h2>Add receiving account</h2><p>Only add an operator-owned account authorized to receive deposits. Users will see the full details. No account ownership is verified by this app.</p><form onSubmit={submit}><fieldset disabled={busy}><TransferDetailsFields value={details} onChange={value => { setDetails(value); setConfirmed(false); }} /><label className="transfer-checkbox"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I have independently verified ownership and every receiving detail.</label></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--primary" disabled={busy || !confirmed}>{busy ? 'Saving…' : 'Publish receiving account'}</button></form></Modal>;
}

function ReviewModal({ request, onClose, onComplete }: { request: TransferRequest; onClose: () => void; onComplete: () => Promise<void> }) {
  const [status, setStatus] = useState<'completed' | 'rejected'>('rejected');
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (status === 'completed' && !verified)) return;
    setBusy(true); setError('');
    try {
      await api(`/admin/transfers/requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ status, note, externallyVerified: verified }) });
      await onComplete(); toast.success('Review recorded. No money moved by Northstar.'); onClose();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <Modal onClose={() => { if (!busy) onClose(); }} className="transfer-modal"><h2>Review request #{request.id}</h2><p>Account #{request.userId} · {request.type} · {money(request.amountCents)}</p><TransferDetailsView details={request.details} />{request.reference && <p>Submitted reference: {request.reference}</p>}<p className="transfer-notice">This action only updates a record. It does not execute a payout, refund, bank transfer, or trade. Decisions are final in this app. Review all external records before proceeding.</p><form onSubmit={submit}><fieldset disabled={busy}>
    <label className="field-label">Decision<select value={status} onChange={event => { setStatus(event.target.value as 'completed' | 'rejected'); setVerified(false); }}><option value="rejected">Reject request</option><option value="completed">Record externally completed transfer</option></select></label>
    <label className="field-label">{status === 'completed' ? 'External settlement reference / transaction hash' : 'Rejection reason (visible to the user)'}<textarea required minLength={3} maxLength={300} value={note} onChange={event => setNote(event.target.value)} /></label>
    {status === 'completed' && <label className="transfer-checkbox"><input required type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} /> I independently verified identity, ownership, actual settlement, external balances/reservations, and duplicate-payment checks. I have reconciled the external ledger and am not using virtual funds.</label>}
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button--primary" disabled={busy || (status === 'completed' && !verified)}>{busy ? 'Recording…' : status === 'completed' ? 'Record external completion' : 'Reject request'}</button></form></Modal>;
}
