import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
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
  not_requested: { label: 'Required', dot: 'bg-white/50', text: 'text-white/45' },
  denied: { label: 'Blocked', dot: 'bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.7)]', text: 'text-rose-400' },
  restart_required: { label: 'Restart app', dot: 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]', text: 'text-sky-400' },
  unsupported: { label: 'Unavailable', dot: 'bg-white/20', text: 'text-white/30' },
};

function ActionButton({ action, busy }: { action: PermissionCardAction; busy?: boolean }) {
  const variant = action.variant ?? 'primary';
  const baseClass = 'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all active:scale-[0.96]';
  const variantClass = variant === 'primary'
    ? 'border border-white/20 bg-white/[0.12] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-md hover:bg-white/20'
    : 'text-white/35 hover:text-white/65';

  return (
    <button
      type="button"
      onClick={() => void action.onClick()}
      disabled={action.disabled || busy}
      className={`${baseClass} ${variantClass} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {busy ? <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" /> : null}
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

  return (
    <motion.div
      layout
      className="group relative overflow-hidden rounded-[18px] border border-white/12 border-t-white/20 p-4 shadow-[0_4px_16px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-[40px] backdrop-saturate-[160%] transition-all hover:border-white/20"
      style={{ background: 'rgba(255,255,255,0.04)' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/[0.03] to-transparent" />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-white/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
            <Icon className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="text-[13px] font-medium text-white/90">{title}</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-white/40 max-w-[26ch]">{description}</p>
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
        <p className="relative mt-2.5 border-t border-white/8 pt-2.5 text-[11px] leading-relaxed text-sky-400/75">{detail}</p>
      )}
    </motion.div>
  );
}
