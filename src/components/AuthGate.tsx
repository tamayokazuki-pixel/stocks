import { toast } from 'sonner';
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react';
import { useApp } from '../state/AppContext';

export function AuthGate({ title, description }: { title: string; description: string }) {
  const { openAuth, demoEnabled, demoSignIn } = useApp();
  const tryDemo = async () => { try { await demoSignIn(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not open the demo.'); } };
  return <div className="gate-panel panel">
    <div className="gate-art"><div className="gate-orbit gate-orbit--one" /><div className="gate-orbit gate-orbit--two" /><div className="gate-art-center"><LockKeyhole size={29} /></div><span className="gate-art-spark gate-art-spark--one">✦</span><span className="gate-art-spark gate-art-spark--two">✦</span></div>
    <span className="gate-kicker">YOUR OWN TRADING SPACE</span>
    <h2>{title}</h2><p>{description}</p>
    <div className="gate-actions"><button className="button button--primary" onClick={() => openAuth('register')}>Create a free account <ArrowRight size={17} /></button>{demoEnabled && <button className="button button--outline" onClick={tryDemo}><Sparkles size={17} /> Explore demo</button>}</div>
    <small>Practice with virtual money. No brokerage account required.</small>
  </div>;
}
