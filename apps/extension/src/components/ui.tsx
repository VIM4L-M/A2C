import type { FillStatus } from '@a2c/shared';
import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, Info, Loader2, Lock, ShieldAlert, XCircle, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: LucideIcon; loading?: boolean }) {
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-accent-ink hover:opacity-90 border border-transparent',
    secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
    ghost: 'bg-transparent text-muted hover:text-ink hover:bg-surface-2 border border-transparent',
    danger: 'bg-surface text-danger border border-line hover:bg-danger-soft',
  };
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]',
        styles[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-xl border border-line bg-surface p-3.5', className)}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-neutral-soft text-neutral',
  accent: 'bg-accent-soft text-accent',
};

export function Badge({ tone = 'neutral', children, icon: Icon, className }: { tone?: Tone; children: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', TONES[tone], className)}>
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      {children}
    </span>
  );
}

const STATUS: Record<FillStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  ready: { label: 'Ready to fill', tone: 'ok', icon: CheckCircle2 },
  review: { label: 'Review required', tone: 'warn', icon: AlertTriangle },
  missing: { label: 'Missing information', tone: 'accent', icon: HelpCircle },
  blocked: { label: 'Blocked', tone: 'danger', icon: ShieldAlert },
  unsupported: { label: 'Manual only', tone: 'neutral', icon: Lock },
  skipped: { label: 'Skipped', tone: 'neutral', icon: CircleDashed },
  completed: { label: 'Completed', tone: 'ok', icon: CheckCircle2 },
  failed: { label: 'Failed', tone: 'danger', icon: XCircle },
};

export function StatusPill({ status }: { status: FillStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

export function Notice({ tone = 'neutral', title, children, icon, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: LucideIcon; action?: ReactNode }) {
  const Icon = icon ?? (tone === 'danger' ? XCircle : tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info);
  return (
    <div className={cx('flex gap-2.5 rounded-lg p-3 text-[12.5px]', TONES[tone])} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-ink">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className={cx(title ? 'mt-0.5' : '', 'text-ink/80')}>{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

const inputBase =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-60';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, 'h-8', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputBase, 'min-h-20 resize-y', props.className)} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputBase, 'h-8 pr-6', props.className)} />;
}

export function FieldLabel({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink">
      {children}
      {hint ? <span className="ml-1 font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; id?: string }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-[12.5px]', disabled && 'cursor-not-allowed opacity-50')}>
      <input id={id} type="checkbox" className="size-4 accent-[var(--cf-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
      <div className={cx('text-lg font-semibold leading-none tabular-nums', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger', tone === 'accent' && 'text-accent')}>{value}</div>
      <div className="mt-1 text-[11px] text-muted">{label}</div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <Icon className="size-6 text-muted" aria-hidden />
      <div className="text-[13px] font-medium">{title}</div>
      {children ? <div className="max-w-64 text-xs text-muted">{children}</div> : null}
    </div>
  );
}
