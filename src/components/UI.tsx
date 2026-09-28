import { createPortal } from 'react-dom';
import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, X } from 'lucide-react';
import type { Asset } from '../types';
import { signedPercent } from '../lib/api';

export function AssetLogo({ asset, size = 'md' }: { asset: Pick<Asset, 'symbol' | 'color'>; size?: 'sm' | 'md' | 'lg' }) {
  return <div className={`asset-logo asset-logo--${size}`} style={{ '--asset-color': asset.color } as React.CSSProperties} aria-hidden="true">
    {asset.symbol === 'MSFT' ? <span className="microsoft-mark"><i /><i /><i /><i /></span> :
      asset.symbol === 'AAPL' ? <span className="asset-monogram asset-monogram--apple">●</span> :
      <span className="asset-monogram">{asset.symbol === 'GOOGL' ? 'G' : asset.symbol === 'AMZN' ? 'a' : asset.symbol === 'META' ? '∞' : asset.symbol.slice(0, 1)}</span>}
  </div>;
}

export function Trend({ value, label, subtle = false }: { value: number; label?: string; subtle?: boolean }) {
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return <span className={`trend ${positive ? 'trend--up' : 'trend--down'} ${subtle ? 'trend--subtle' : ''}`}>
    <Icon size={subtle ? 14 : 15} strokeWidth={2.4} />{label ?? signedPercent(value)}
  </span>;
}

export function SectionHeading({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return <div className="section-heading">
    <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    {action && <button type="button" className="text-link" onClick={onAction}>{action}<ArrowRight size={16} /></button>}
  </div>;
}

export function Modal({ children, onClose, className = '' }: { children: ReactNode; onClose: () => void; className?: string }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const initialFocus = dialogRef.current?.querySelector<HTMLElement>('input, textarea, select')
      || dialogRef.current?.querySelector<HTMLElement>('button');
    initialFocus?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = before; window.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, []);
  // Escape transformed page containers so fixed dialogs stay within the viewport.
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className={`modal-card ${className}`} role="dialog" aria-modal="true">
      <button className="modal-close icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>
      {children}
    </div>
  </div>, document.body);
}

export function LoadingBlock({ height = 240 }: { height?: number }) {
  return <div className="loading-block" style={{ height }}><span className="loading-spinner" /><span>Loading your workspace...</span></div>;
}

export function EmptyState({ icon, title, description, action, onAction }: { icon: ReactNode; title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state">
    <div className="empty-state-icon">{icon}</div>
    <h3>{title}</h3><p>{description}</p>
    {action && <button className="button button--primary" onClick={onAction}>{action}<ArrowRight size={16} /></button>}
  </div>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading">
    <div><div className="eyebrow"><span className="eyebrow-dot" />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
    {action && <div className="page-heading-action">{action}</div>}
  </div>;
}
