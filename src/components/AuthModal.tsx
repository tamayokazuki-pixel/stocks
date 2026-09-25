import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Sparkles } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { errorMessage } from '../lib/api';
import { Modal } from './UI';

export function AuthModal() {
  const { authMode, openAuth, closeAuth, signIn, signUp, demoSignIn, demoEnabled } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!authMode) return null;

  const changeMode = (mode: 'login' | 'register') => { setError(''); openAuth(mode); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setPending(true);
    try {
      if (authMode === 'login') await signIn(email, password);
      else await signUp(name, email, password);
    } catch (err) { setError(errorMessage(err)); }
    finally { setPending(false); }
  };
  const tryDemo = async () => {
    setError(''); setPending(true);
    try { await demoSignIn(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setPending(false); }
  };

  return <Modal onClose={closeAuth} className="auth-modal">
    <div className="auth-emblem"><Sparkles size={24} strokeWidth={1.9} /></div>
    <div className="auth-heading">
      <div className="auth-kicker">WELCOME TO NORTHSTAR</div>
      <h2>{authMode === 'login' ? 'Welcome back.' : 'Start with clarity.'}</h2>
      <p>{authMode === 'login' ? 'Sign in to pick up right where you left off.' : 'Create your free paper trading account in a few seconds.'}</p>
    </div>
    <div className="auth-tabs" role="tablist" aria-label="Account access">
      <button role="tab" aria-selected={authMode === 'login'} className={authMode === 'login' ? 'active' : ''} onClick={() => changeMode('login')}>Sign in</button>
      <button role="tab" aria-selected={authMode === 'register'} className={authMode === 'register' ? 'active' : ''} onClick={() => changeMode('register')}>Create account</button>
    </div>
    <form onSubmit={submit} className="auth-form">
      {authMode === 'register' && <label className="field-label">Full name
        <input required autoComplete="name" minLength={2} maxLength={60} placeholder="e.g. Alex Morgan" value={name} onChange={event => setName(event.target.value)} />
      </label>}
      <label className="field-label">Email address
        <input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} />
      </label>
      <label className="field-label">Password
        <span className="password-field"><input required type={showPassword ? 'text' : 'password'} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={authMode === 'register' ? 8 : undefined} placeholder={authMode === 'register' ? 'At least 8 characters' : 'Enter your password'} value={password} onChange={event => setPassword(event.target.value)} />
          <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </span>
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="button button--primary auth-submit" disabled={pending} type="submit">
        {pending ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create your account'}<ArrowRight size={17} />
      </button>
    </form>
    {demoEnabled && <><div className="auth-divider"><span>or explore first</span></div>
      <button className="demo-login" onClick={tryDemo} disabled={pending}>
        <span className="demo-login-icon"><Sparkles size={19} /></span>
        <span><strong>Explore the demo account</strong><small>No setup needed · started with $100k virtual funds</small></span>
        <ArrowRight size={17} />
      </button></>}
    <p className="auth-disclaimer"><LockKeyhole size={13} /> Paper trading only. No real funds or securities are exchanged.</p>
  </Modal>;
}
