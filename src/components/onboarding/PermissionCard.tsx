import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
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
  detail: string;
  status: PermissionState;
  isBusy?: boolean;
  primaryAction: PermissionCardAction;
  secondaryAction?: PermissionCardAction;
}

const STATUS_STYLES: Record<PermissionState, { label: string; chip: string; dot: string }> = {
  granted: {
    label: 'Enabled',
    chip: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
    dot: 'bg-emerald-300',
  },
  not_requested: {
    label: 'Needs setup',
    chip: 'border-amber-300/30 bg-amber-300/10 text-amber-50',
    dot: 'bg-amber-300',
  },
  denied: {
    label: 'Blocked',
    chip: 'border-rose-400/30 bg-rose-400/10 text-rose-50',
    dot: 'bg-rose-300',
  },
  restart_required: {
    label: 'Restart required',
    chip: 'border-sky-400/30 bg-sky-400/10 text-sky-50',
    dot: 'bg-sky-300',
  },
  unsupported: {
    label: 'Unavailable',
    chip: 'border-white/15 bg-white/5 text-white/70',
    dot: 'bg-white/40',
  },
};

function ActionButton({ action, busy }: { action: PermissionCardAction; busy?: boolean }) {
  const variant = action.variant ?? 'primary';
  const baseClass =
    'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium tracking-[-0.01em] transition-all duration-200';

  const variantClass =
    variant === 'primary'
      ? 'bg-white text-[#08111c] shadow-[0_12px_30px_rgba(255,255,255,0.18)] hover:bg-white/90'
      : 'border border-white/12 bg-white/6 text-white/80 hover:bg-white/10';

  return (
    <button
      type="button"
      onClick={() => void action.onClick()}
      disabled={action.disabled || busy}
      className={`${baseClass} ${variantClass} disabled:cursor-not-allowed disabled:opacity-55`}
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      <span>{action.label}</span>
      {!busy && variant === 'secondary' ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}
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
  const statusStyle = STATUS_STYLES[status];

  return (
    <motion.div
      layout
      className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(19,24,31,0.96),rgba(11,16,24,0.92))] p-5 shadow-[0_26px_80px_rgba(0,0,0,0.34)]"
    >
      <div className="absolute inset-x-5 top-0 h-px bg-white/12" />
      <div className="absolute -right-10 top-0 h-32 w-32 rounded-full bg-white/6 blur-3xl" />

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-white/8 text-white">
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[17px] font-medium tracking-[-0.02em] text-white">{title}</h3>
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusStyle.chip}`}>
                <span className={`h-2 w-2 rounded-full ${statusStyle.dot}`} />
                {statusStyle.label}
              </span>
            </div>
            <p className="mt-2 max-w-[48ch] text-sm leading-6 text-white/68">{description}</p>
            <p className="mt-2 max-w-[56ch] text-sm leading-6 text-white/45">{detail}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
          {secondaryAction ? <ActionButton action={secondaryAction} /> : null}
          <ActionButton action={primaryAction} busy={isBusy} />
        </div>
      </div>
    </motion.div>
  );
}
