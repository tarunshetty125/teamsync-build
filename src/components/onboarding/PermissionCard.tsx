import { motion } from 'framer-motion';
import { Check, Clock3, RotateCcw, X, Minus, type LucideIcon } from 'lucide-react';
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
  accent?: PermissionCardAccent;
}

interface PermissionCardAccent {
  border: string;
  glow: string;
  iconGlow: string;
  statusGlow: string;
}

const STATUS_STYLES: Record<PermissionState, { label: string; icon: LucideIcon; text: string; badge: string }> = {
  granted: {
    label: 'Enabled',
    icon: Check,
    text: 'text-emerald-100',
    badge: 'border-emerald-200/[0.16] bg-emerald-300/[0.10] shadow-[0_0_18px_rgba(110,231,183,0.18)]',
  },
  not_requested: {
    label: 'Required',
    icon: Clock3,
    text: 'text-white/[0.48]',
    badge: 'border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
  },
  denied: {
    label: 'Blocked',
    icon: X,
    text: 'text-rose-100/[0.86]',
    badge: 'border-rose-200/[0.16] bg-rose-300/[0.10] shadow-[0_0_18px_rgba(253,164,175,0.16)]',
  },
  restart_required: {
    label: 'Restart app',
    icon: RotateCcw,
    text: 'text-sky-100/[0.86]',
    badge: 'border-sky-200/[0.16] bg-sky-300/[0.10] shadow-[0_0_18px_rgba(125,211,252,0.16)]',
  },
  unsupported: {
    label: 'Unavailable',
    icon: Minus,
    text: 'text-white/[0.38]',
    badge: 'border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
  },
};

const DEFAULT_ACCENT: PermissionCardAccent = {
  border: 'linear-gradient(145deg, rgba(255,255,255,0.15), rgba(255,255,255,0.045) 48%, rgba(255,255,255,0.09))',
  glow: 'radial-gradient(circle at 92% 84%, rgba(126,108,213,0.12), transparent 50%)',
  iconGlow: 'rgba(126,108,213,0.18)',
  statusGlow: 'rgba(255,255,255,0.08)',
};

function ActionButton({ action, busy }: { action: PermissionCardAction; busy?: boolean }) {
  const variant = action.variant ?? 'primary';
  const baseClass = 'inline-flex h-[24px] items-center justify-center rounded-full px-[9px] text-[9px] font-bold transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]';
  const variantClass = variant === 'primary'
    ? 'border border-white/[0.14] bg-white/[0.92] text-[#050505] shadow-[0_0_24px_rgba(255,255,255,0.10)] hover:-translate-y-0.5 hover:bg-white'
    : 'border border-white/10 bg-white/[0.035] text-white/[0.54] hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white/[0.76]';

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
  accent = DEFAULT_ACCENT,
}: PermissionCardProps) {
  const style = STATUS_STYLES[status];
  const StatusIcon = style.icon;
  const isPending = status === 'not_requested';
  const showStatusText = status !== 'granted';

  return (
    <motion.div
      layout
      animate={isPending ? { y: [0, -1, 0] } : { y: 0 }}
      transition={isPending ? { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      whileHover={{ y: -2, scale: 1.006 }}
      whileTap={{ scale: 0.992 }}
      className="group relative overflow-hidden rounded-[15px] p-px shadow-[0_12px_28px_rgba(0,0,0,0.28)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ background: accent.border }}
    >
      {isPending ? (
        <motion.div
          className="pointer-events-none absolute inset-x-4 bottom-px h-px origin-center rounded-full bg-gradient-to-r from-transparent via-white/24 to-transparent"
          initial={{ opacity: 0.18, scaleX: 0.55 }}
          animate={{ opacity: [0.18, 0.55, 0.18], scaleX: [0.55, 1, 0.55] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}

      <div className="relative overflow-hidden rounded-[14px] bg-[linear-gradient(180deg,rgba(18,20,27,0.96),rgba(8,9,12,0.98))] px-[12px] py-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-20px_48px_rgba(0,0,0,0.22)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.16] to-transparent" />
        <div className="pointer-events-none absolute inset-0 opacity-95 transition-opacity duration-500 group-hover:opacity-100" style={{ background: accent.glow }} />
        <div className="pointer-events-none absolute -right-8 bottom-[-54px] h-[92px] w-[150px] rounded-full blur-[34px] opacity-60 transition-opacity duration-500 group-hover:opacity-90" style={{ background: accent.iconGlow }} />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-[11px]">
            <div className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[12px] border border-white/[0.10] bg-white/[0.045] text-white/[0.66] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(255,255,255,0.04)]">
              <div className="pointer-events-none absolute inset-[-10px] rounded-full blur-[14px] opacity-70" style={{ background: accent.iconGlow }} />
              <Icon className="relative h-[15px] w-[15px]" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-[12px] font-bold text-white/[0.9]">{title}</h3>
              <p className="mt-[2px] max-w-[24ch] text-[9px] font-medium leading-[1.34] text-white/[0.48]">{description}</p>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1 pl-2">
            <div
              aria-label={style.label}
              title={style.label}
              className={`flex min-h-[24px] items-center justify-center gap-1 rounded-full border px-[7px] py-[4px] text-[8px] font-bold uppercase tracking-[0.14em] ${style.badge} ${style.text}`}
              style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 18px ${accent.statusGlow}` }}
            >
              <StatusIcon className="h-[11px] w-[11px]" strokeWidth={2.2} />
              {showStatusText ? <span>{style.label}</span> : null}
            </div>
            <div className="flex items-center gap-1">
              {secondaryAction && <ActionButton action={secondaryAction} busy={isBusy} />}
              {status !== 'granted' && <ActionButton action={primaryAction} busy={isBusy} />}
            </div>
          </div>
        </div>

        {(status === 'denied' || status === 'restart_required') && detail && (
          <p className="relative mt-1.5 border-t border-white/[0.075] pt-1.5 text-[9px] font-medium leading-relaxed text-white/[0.46]">{detail}</p>
        )}
      </div>
    </motion.div>
  );
}
