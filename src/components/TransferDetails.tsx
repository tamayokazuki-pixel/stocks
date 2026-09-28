import type { TransferDetails } from '../types';

export const emptyBank: TransferDetails = { kind: 'bank', bankName: '', accountHolder: '', accountNumber: '', routingNumber: '', accountType: 'checking' };
export const emptyWallet: TransferDetails = { kind: 'wallet', network: 'Ethereum', address: '' };

export function methodLabel(details: TransferDetails) {
  return details.kind === 'bank'
    ? `${details.bankName} · ${details.accountType} ••••${details.accountNumber.slice(-4)}`
    : `USDC · ${details.network} · ${details.address.slice(0, 6)}…${details.address.slice(-4)}`;
}

export function TransferDetailsFields({ value, onChange }: { value: TransferDetails; onChange: (details: TransferDetails) => void }) {
  return <div className="transfer-fields">
    <label className="field-label">Transfer method<select value={value.kind} onChange={event => onChange(event.target.value === 'bank' ? { ...emptyBank } : { ...emptyWallet })}><option value="bank">US bank account · USD</option><option value="wallet">Crypto wallet · USDC</option></select></label>
    {value.kind === 'bank' ? <>
      <label className="field-label">Account holder<input required minLength={2} maxLength={100} autoComplete="off" value={value.accountHolder} onChange={event => onChange({ ...value, accountHolder: event.target.value })} /></label>
      <label className="field-label">Bank name<input required minLength={2} maxLength={100} value={value.bankName} onChange={event => onChange({ ...value, bankName: event.target.value })} /></label>
      <label className="field-label">Account number<input required inputMode="numeric" pattern="[0-9]{4,17}" minLength={4} maxLength={17} autoComplete="off" value={value.accountNumber} onChange={event => onChange({ ...value, accountNumber: event.target.value })} /></label>
      <label className="field-label">ABA routing number<input required inputMode="numeric" pattern="[0-9]{9}" minLength={9} maxLength={9} autoComplete="off" value={value.routingNumber} onChange={event => onChange({ ...value, routingNumber: event.target.value })} /></label>
      <label className="field-label">Account type<select value={value.accountType} onChange={event => onChange({ ...value, accountType: event.target.value as 'checking' | 'savings' })}><option value="checking">Checking</option><option value="savings">Savings</option></select></label>
    </> : <>
      <label className="field-label">USDC network<select value={value.network} onChange={event => onChange({ ...value, network: event.target.value as 'Ethereum' | 'Polygon' })}><option>Ethereum</option><option>Polygon</option></select></label>
      <label className="field-label">Public wallet address<input required minLength={42} maxLength={42} pattern="0x[0-9a-fA-F]{40}" autoComplete="off" spellCheck={false} placeholder="0x…" value={value.address} onChange={event => onChange({ ...value, address: event.target.value })} /></label>
      <p className="transfer-help">USDC only on the selected network. Address format checks do not verify ownership, network compatibility, or token support. Never enter a seed phrase or private key.</p>
    </>}
  </div>;
}

export function TransferDetailsView({ details }: { details: TransferDetails }) {
  const rows = details.kind === 'bank'
    ? [['Bank', details.bankName], ['Account holder', details.accountHolder], ['Account number', details.accountNumber], ['ABA routing number', details.routingNumber], ['Account type', details.accountType], ['Currency / country', 'USD / United States']]
    : [['Asset', 'USDC'], ['Network', details.network], ['Public wallet address', details.address]];
  return <dl className="transfer-details">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export const transferDisclosure = 'Manual requests only: this app does not send money, verify payments, or hold a real-money balance. Paper trading funds cannot be withdrawn as real money. All settlement and balance checks happen outside Northstar.';
