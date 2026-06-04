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
  granted: { label: 'Enabled', dot: 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.72)]', text: 'text-emerald-200/[0.86]' },
  not_requested: { label: 'Required', dot: 'bg-white/[0.34]', text: 'text-white/[0.42]' },
  denied: { label: 'Blocked', dot: 'bg-rose-300 shadow-[0_0_8px_rgba(253,164,175,0.72)]', text: 'text-rose-200/[0.86]' },
  restart_required: { label: 'Restart app', dot: 'bg-sky-300 shadow-[0_0_8px_rgba(125,211,252,0.72)]', text: 'text-sky-200/[0.86]' },
  unsupported: { label: 'Unavailable', dot: 'bg-white/[0.28]', text: 'text-white/[0.38]' },
};

function ActionButton({ action, busy }: { action: PermissionCardAction; busy?: boolean }) {
  const variant = action.variant ?? 'primary';
  const baseClass = 'inline-flex h-[30px] items-center justify-center rounded-full px-[12px] text-[11px] font-bold transition-all active:scale-[0.98]';
  const variantClass = variant === 'primary'
    ? 'border border-white/14 bg-white/[0.92] text-[#050505] shadow-[0_0_24px_rgba(255,255,255,0.10)] hover:bg-white'
    : 'border border-white/10 bg-white/[0.035] text-white/[0.54] hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white/[0.76]';

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
      className={`group relative overflow-hidden rounded-[14px] p-[14px] shadow-[0_14px_34px_rgba(0,0,0,0.24)] transition-all ${
        isPending
          ? 'border border-[#4b5160]/70 bg-[#141720]/[0.82]'
          : 'border border-white/[0.075] bg-[#101219]/[0.86] hover:border-white/[0.14]'
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_86%_92%,rgba(255,255,255,0.045),transparent_46%)] opacity-80" />
      {isPending ? (
        <motion.div
          className="pointer-events-none absolute inset-x-4 bottom-0 h-px origin-center rounded-full bg-gradient-to-r from-transparent via-white/24 to-transparent"
          initial={{ opacity: 0.18, scaleX: 0.55 }}
          animate={{ opacity: [0.18, 0.55, 0.18], scaleX: [0.55, 1, 0.55] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.04] text-white/[0.58] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <Icon className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-white/[0.86]">{title}</h3>
            <p className="mt-1 max-w-[26ch] text-[11px] font-medium leading-relaxed text-white/[0.48]">{description}</p>
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
        <p className="relative mt-2.5 border-t border-white/[0.075] pt-2.5 text-[11px] font-medium leading-relaxed text-white/[0.46]">{detail}</p>
      )}
    </motion.div>
  );
}
