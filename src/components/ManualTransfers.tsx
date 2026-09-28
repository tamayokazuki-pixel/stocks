import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { api, dateTime, errorMessage, money } from '../lib/api';
import { useApp } from '../state/AppContext';
import { Modal } from './UI';
import { emptyBank, methodLabel, transferDisclosure, TransferDetailsFields, TransferDetailsView } from './TransferDetails';
import type { TransferDetails, TransferMethod, TransferRequest } from '../types';

export function ManualTransfers() {
  const { user } = useApp();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'deposit' | 'withdrawal' | null>(null);
  const [cancelRequest, setCancelRequest] = useState<TransferRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const config = useQuery<{ enabled: boolean }>({ queryKey: ['transfers', user?.id, 'config'], queryFn: () => api('/transfers/config'), enabled: !!user });
  const enabled = !!config.data?.enabled;
  const methods = useQuery<{ methods: TransferMethod[] }>({ queryKey: ['transfers', user?.id, 'methods'], queryFn: () => api('/transfers/methods'), enabled });
  const history = useQuery<{ requests: TransferRequest[] }>({ queryKey: ['transfers', user?.id, 'requests'], queryFn: () => api('/transfers/requests'), enabled, refetchInterval: 30000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['transfers'] });
  const cancel = async () => {
    if (!cancelRequest || busy) return;
    setBusy(true);
    try {
      await api(`/transfers/requests/${cancelRequest.id}/cancel`, { method: 'POST' });
      setCancelRequest(null); await refresh(); toast.success('Request cancelled. No money moved.');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <section className="panel manual-transfers" aria-labelledby="manual-transfers-title">
    <div className="transfer-heading"><div><span className="cash-eyebrow">EXTERNAL TRANSFERS · MANUAL REVIEW</span><h2 id="manual-transfers-title">Bank & wallet transfers</h2><p>{transferDisclosure}</p></div></div>
    {config.isPending ? <p>Loading transfer availability…</p> : config.isError ? <p role="alert">{errorMessage(config.error)} <button className="button button--outline" onClick={() => config.refetch()}>Retry</button></p> : !enabled ? <p className="transfer-notice">Manual transfers are not enabled. The operator must configure secure receiving details first, and you must use a private account (not the shared demo). Do not send funds to a demo account.</p> : <>
      <div className="transfer-actions">
        <button className="button button--primary" disabled={!methods.data?.methods.length} onClick={() => setAction('deposit')}><ArrowDownToLine size={16} /> Submit top-up request</button>
        <button className="button button--outline" onClick={() => setAction('withdrawal')}><ArrowUpFromLine size={16} /> Request withdrawal</button>
      </div>
      {methods.isPending ? <p>Loading receiving methods…</p> : methods.isError ? <p role="alert">Receiving details could not be loaded. <button onClick={() => methods.refetch()}>Retry</button></p> : !methods.data?.methods.length && <p className="transfer-help">No receiving bank or wallet has been configured. Top-ups are unavailable.</p>}
      <h3>Transfer requests</h3><p className="transfer-help">Most recent 100 · “Completed” means an administrator recorded external settlement, not an in-app payment.</p>
      {history.isPending ? <p>Loading requests…</p> : history.isError ? <p role="alert">{errorMessage(history.error)} <button onClick={() => history.refetch()}>Retry</button></p> : !history.data?.requests.length ? <p className="transfer-help">No transfer requests yet.</p> : <div className="transfer-list">{history.data.requests.map(request => <article className="transfer-record" key={request.id}>
        <div className="transfer-record-heading"><strong>#{request.id} · {request.type === 'deposit' ? 'Top-up' : 'Withdrawal'} · {money(request.amountCents)}</strong><span className={`transfer-status transfer-status--${request.status}`}>{request.status === 'completed' ? 'Completed externally' : request.status}</span></div>
        <p>{methodLabel(request.details)} · {dateTime(request.createdAt)}</p>
        <details><summary>View transfer details</summary><TransferDetailsView details={request.details} />{request.reference && <p>Submitted reference: {request.reference}</p>}{request.reviewNote && <p>Admin note / settlement reference: {request.reviewNote}</p>}{request.reviewedAt && <p>Updated {dateTime(request.reviewedAt)}</p>}</details>
        {request.status === 'pending' && <button className="button button--outline button--small" onClick={() => setCancelRequest(request)}>Cancel request</button>}
      </article>)}</div>}
      {action && <TransferRequestModal action={action} methods={methods.data?.methods || []} onClose={() => setAction(null)} onComplete={refresh} />}
      {cancelRequest && <Modal onClose={() => { if (!busy) setCancelRequest(null); }} className="transfer-modal"><h2>Cancel request #{cancelRequest.id}?</h2><p>This cancels the request record only. It cannot reverse a transfer, recall a bank payment, or stop a payout already started outside the app. Contact the operator if money has moved.</p><button className="button button--primary" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel request record'}</button></Modal>}
    </>}
  </section>;
}

function TransferRequestModal({ action, methods, onClose, onComplete }: {
  action: 'deposit' | 'withdrawal'; methods: TransferMethod[]; onClose: () => void; onComplete: () => Promise<unknown>;
}) {
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState(String(methods[0]?.id || ''));
  const [destination, setDestination] = useState<TransferDetails>({ ...emptyBank });
  const [reference, setReference] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Preserve the exact submitted payload for retries after a network failure.
  const [submission, setSubmission] = useState<object | null>(null);
  const selected = methods.find(method => String(method.id) === methodId);
  const details = action === 'deposit' ? selected?.details : destination;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(amount)) { setError('Enter an amount with up to two decimal places.'); return; }
    const body = submission || { type: action, amountCents: Math.round(Number(amount) * 100), methodId: Number(methodId), details: destination, reference, acknowledged, requestKey: crypto.randomUUID() };
    setSubmission(body); setBusy(true); setError('');
    try {
      await api('/transfers/requests', { method: 'POST', body: JSON.stringify(body) });
      toast.success('Request submitted for manual review', { description: 'No money moved and your paper balance is unchanged.' });
      await onComplete(); onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      // HTTP validation failures can be edited; unknown network outcomes must retry identically.
      if (caught instanceof Error && 'status' in caught && Number(caught.status) < 500) setSubmission(null);
    } finally { setBusy(false); }
  };
  return <Modal onClose={() => { if (!busy) onClose(); }} className="transfer-modal">
    <h2>{action === 'deposit' ? 'Submit a top-up request' : 'Request an external withdrawal'}</h2>
    <p className="transfer-notice">{transferDisclosure}</p>
    <form onSubmit={submit}>
      <fieldset disabled={busy || !!submission}>
        {action === 'deposit' ? <>
          <label className="field-label">Operator receiving account<select required value={methodId} onChange={event => setMethodId(event.target.value)}>{methods.map(method => <option key={method.id} value={method.id}>{methodLabel(method.details)}</option>)}</select></label>
          {selected && <TransferDetailsView details={selected.details} />}
          <p className="transfer-help">Confirm these details and the transfer instructions with the operator through a trusted channel before sending funds. Only report a transfer you actually made. Never send another token or use another network.</p>
          <label className="field-label">Bank transfer reference / transaction hash<input required minLength={3} maxLength={160} autoComplete="off" value={reference} onChange={event => setReference(event.target.value)} /></label>
        </> : <><p className="transfer-help">Enter an account or public wallet you own. This is a request only; the operator must verify your identity, external available balance, and destination before paying you. Your virtual trading balance is not eligible.</p><TransferDetailsFields value={destination} onChange={setDestination} /></>}
        <label className="field-label">{details?.kind === 'wallet' ? 'USDC amount (recorded at nominal 1 USDC = 1 USD)' : 'Amount in USD'}<input required type="number" inputMode="decimal" min="1" max="100000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></label>
        <p className="transfer-help">$1–$100,000 per request. No conversion, exchange-rate guarantee, or network/bank fee calculation is provided.</p>
        <label className="transfer-checkbox"><input required type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I have checked the details, own the withdrawal destination (if applicable), and understand that review does not execute a payment or change paper funds.</label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!!submission && !busy && <p className="transfer-help">The submission outcome could not be confirmed. Retry the same request below; do not create another request for the same transfer.</p>}
      <button className="button button--primary" disabled={busy || (!submission && !acknowledged)}>{busy ? 'Submitting…' : submission ? 'Retry same request' : 'Submit for manual review'}</button>
    </form>
  </Modal>;
}
