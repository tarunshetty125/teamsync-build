import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { PermissionState } from '../../lib/permissions/types';

interface PermissionCardAction {
  label: string;
  onClick: () => void | Promise<void>;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

interface PermissionCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  detail?: string;
  status: PermissionState;
  isBusy?: boolean;
  primaryAction: PermissionCardAction;
  secondaryAction?: PermissionCardAction;
}

const STATUS_STYLES: Record<PermissionState, { label: string; dot: string; text: string }> = {
  granted: { label: 'Enabled', dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]', text: 'text-emerald-400' },
  not_requested: { label: 'Required', dot: 'bg-text-tertiary', text: 'text-text-tertiary' },
  denied: { label: 'Blocked', dot: 'bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.7)]', text: 'text-rose-400' },
  restart_required: { label: 'Restart app', dot: 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]', text: 'text-sky-400' },
  unsupported: { label: 'Unavailable', dot: 'bg-text-tertiary', text: 'text-text-tertiary' },
};

function ActionButton({ action, busy }: { action: PermissionCardAction; busy?: boolean }) {
  const variant = action.variant ?? 'primary';
  const baseClass = 'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-[11px] font-medium transition-all active:scale-[0.98]';
  const variantClass = variant === 'primary'
    ? 'bg-text-primary text-bg-primary shadow-sm hover:opacity-90'
    : 'text-text-secondary hover:text-text-primary';

  return (
    <button
      type="button"
      onClick={() => void action.onClick()}
      disabled={action.disabled || busy}
      className={`${baseClass} ${variantClass} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {busy ? <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
      {action.label}
    </button>
  );
}

export function PermissionCard({
  icon: Icon,
  title,
  description,
  detail,
  status,
  isBusy = false,
  primaryAction,
  secondaryAction,
}: PermissionCardProps) {
  const style = STATUS_STYLES[status];
  const isPending = status === 'not_requested';

  return (
    <motion.div
      layout
      animate={isPending ? { y: [0, -1, 0] } : { y: 0 }}
      transition={isPending ? { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      className={`group relative overflow-hidden rounded-xl p-4 shadow-[0_12px_28px_rgba(0,0,0,0.10)] transition-all ${
        isPending
          ? 'border border-transparent bg-bg-elevated'
          : 'border border-border-subtle bg-bg-elevated hover:border-border-muted'
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      {isPending ? (
        <motion.div
          className="pointer-events-none absolute inset-x-4 bottom-0 h-px origin-center rounded-full bg-gradient-to-r from-transparent via-accent-primary/50 to-transparent"
          initial={{ opacity: 0.18, scaleX: 0.55 }}
          animate={{ opacity: [0.18, 0.55, 0.18], scaleX: [0.55, 1, 0.55] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-input text-text-secondary">
            <Icon className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="text-[13px] font-medium text-text-primary">{title}</h3>
            <p className="mt-0.5 max-w-[26ch] text-[11px] leading-relaxed text-text-secondary">{description}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5 pl-3">
          <div className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest ${style.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {style.label}
          </div>
          <div className="flex items-center gap-1">
            {secondaryAction && <ActionButton action={secondaryAction} busy={isBusy} />}
            {status !== 'granted' && <ActionButton action={primaryAction} busy={isBusy} />}
          </div>
        </div>
      </div>

      {(status === 'denied' || status === 'restart_required') && detail && (
        <p className="relative mt-2.5 border-t border-border-subtle pt-2.5 text-[11px] leading-relaxed text-text-secondary">{detail}</p>
      )}
    </motion.div>
  );
}
