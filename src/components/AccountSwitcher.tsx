import { ArrowRight, Repeat2, Sparkles } from 'lucide-react';
import { useApp } from '../state/AppContext';

const firstName = (name: string) => name.split(' ').filter(Boolean)[0] || name;

/** Compact control that swaps the session between the signed-in account and the shared demo. */
export function AccountSwitchButton({ className = '' }: { className?: string }) {
  const { user, switchTarget, switchAccount, switchingAccount } = useApp();
  if (!user || !switchTarget) return null;
  const toDemo = switchTarget.isDemo;
  return <button type="button" className={`account-switch ${toDemo ? 'account-switch--demo' : ''} ${className}`.trim()}
    onClick={switchAccount} disabled={switchingAccount}
    title={toDemo ? 'Open the shared demo account' : `Return to your own account (${switchTarget.name})`}>
    {toDemo ? <Sparkles size={15} /> : <Repeat2 size={15} />}
    <span>{switchingAccount ? 'Switching…' : toDemo ? 'Switch to demo' : `Switch to ${firstName(switchTarget.name)}`}</span>
  </button>;
}

/** Persistent reminder that the shared demo portfolio is not private to the visitor. */
export function DemoBanner() {
  const { user, switchTarget, switchAccount, switchingAccount, openAuth } = useApp();
  if (!user?.isDemo) return null;
  return <div className="demo-banner">
    <span className="demo-banner-icon"><Sparkles size={17} /></span>
    <span className="demo-banner-copy">
      <strong>Shared demo account</strong>
      <small>Everyone exploring Northstar sees this same portfolio. Paper trades here are not private to you.</small>
    </span>
    {switchTarget
      ? <button className="button button--primary button--small" onClick={switchAccount} disabled={switchingAccount}>
        {switchingAccount ? 'Switching…' : `Back to ${firstName(switchTarget.name)}`}<ArrowRight size={15} />
      </button>
      : <button className="button button--primary button--small" onClick={() => openAuth('register')}>
        Create your own account <ArrowRight size={15} />
      </button>}
  </div>;
}

/** Label that distinguishes the shared demo from a private paper-trading account. */
export function AccountTypeLabel() {
  const { user } = useApp();
  if (!user) return null;
  return <span className={`account-type-label ${user.isDemo ? 'account-type-label--demo' : ''}`}>
    {user.isDemo ? <Sparkles size={12} /> : null}{user.isDemo ? 'Shared demo' : user.role === 'admin' ? 'Administrator' : 'Your account'}
  </span>;
}
