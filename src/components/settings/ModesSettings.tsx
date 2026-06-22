import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Code2,
  LineChart,
  MessageCircleMore,
  UserRound,
  Users,
  X,
} from 'lucide-react';

interface ModesSettingsProps {
  onClose: () => void;
  isPremium?: boolean;
  isLoaded?: boolean;
  isTrialActive?: boolean;
  onOpenTeamSyncAPI?: () => void;
}

type CardTone = 'purple' | 'green' | 'gold' | 'rose' | 'blue' | 'cyan';
type CardLayout = 'tall' | 'wide' | 'square';

interface ModeCardProps {
  title: string;
  description?: string;
  tone: CardTone;
  layout: CardLayout;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  centered?: boolean;
  className?: string;
}

const toneStyles: Record<CardTone, {
  glow: string;
  hoverGlow: string;
  iconWrap: string;
  icon: string;
  accent: string;
}> = {
  purple: {
    glow: 'bg-[radial-gradient(circle_at_16%_18%,rgba(132,109,206,0.26),transparent_44%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_18%_18%,rgba(145,119,230,0.34),transparent_46%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#5d4e86]/[0.62] border-[#806bbc]/65',
    icon: 'text-[#f1effa]',
    accent: '#a996ff',
  },
  green: {
    glow: 'bg-[radial-gradient(circle_at_86%_22%,rgba(56,109,86,0.28),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_84%_24%,rgba(72,132,105,0.36),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#3d5e55]/[0.65] border-[#4b9b83]/70',
    icon: 'text-[#eff8f4]',
    accent: '#63d6b8',
  },
  gold: {
    glow: 'bg-[radial-gradient(circle_at_28%_28%,rgba(138,111,47,0.24),transparent_50%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_28%_28%,rgba(158,128,56,0.33),transparent_50%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#5c4b28]/[0.66] border-[#d7aa2f]/70',
    icon: 'text-[#ffc83c]',
    accent: '#f0c94c',
  },
  rose: {
    glow: 'bg-[radial-gradient(circle_at_78%_22%,rgba(112,72,82,0.28),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_78%_22%,rgba(136,84,98,0.36),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#594048]/[0.67] border-[#e46a80]/65',
    icon: 'text-[#ff6d86]',
    accent: '#ff6f94',
  },
  blue: {
    glow: 'bg-[radial-gradient(circle_at_12%_50%,rgba(50,99,126,0.25),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_12%_50%,rgba(63,125,159,0.35),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#34566c]/[0.66] border-[#4389b8]/65',
    icon: 'text-[#f1f7fb]',
    accent: '#7cc6ff',
  },
  cyan: {
    glow: 'bg-[radial-gradient(circle_at_84%_36%,rgba(47,104,118,0.26),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_84%_36%,rgba(60,128,145,0.36),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#355867]/[0.66] border-[#46abc9]/65',
    icon: 'text-[#eefaff]',
    accent: '#5bd4e7',
  },
};

const cards: ModeCardProps[] = [
  {
    title: 'Interview',
    description: 'Live stealth teleprompter during calls.',
    tone: 'purple',
    layout: 'tall',
    icon: UserRound,
  },
  {
    title: 'Sales Copilot',
    description: 'Live objection handling.',
    tone: 'green',
    layout: 'wide',
    icon: LineChart,
  },
  {
    title: 'Recruit',
    tone: 'gold',
    layout: 'square',
    icon: Users,
    centered: true,
  },
  {
    title: 'Meet',
    tone: 'rose',
    layout: 'square',
    icon: MessageCircleMore,
    centered: true,
  },
  {
    title: 'Lecture',
    description: 'Deep topic synthesis.',
    tone: 'blue',
    layout: 'wide',
    icon: BookOpen,
  },
  {
    title: 'Technical',
    description: 'DSA & Architecture bounds.',
    tone: 'cyan',
    layout: 'wide',
    icon: Code2,
  },
];

const modesEntryEase: [number, number, number, number] = [0.23, 1, 0.32, 1];

const modesSurfaceVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      delayChildren: 0.04,
      staggerChildren: 0.035,
    },
  },
};

const modesItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.24,
      ease: modesEntryEase,
    },
  },
};

function SignalBars({ accent }: { accent: string }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="flex h-6 items-end justify-center gap-1.5 rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
      {[7, 13, 9, 18, 12].map((height, index) => (
        <motion.span
          key={`${height}-${index}`}
          className="w-1 rounded-full"
          style={{ height, background: accent }}
          animate={prefersReducedMotion ? undefined : { opacity: [0.36, 0.88, 0.36], scaleY: [0.82, 1, 0.82] }}
          transition={{ duration: 2.4, delay: index * 0.12, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

function ModeMicroDetail({
  title,
  tone,
}: {
  title: string;
  tone: CardTone;
}) {
  const accent = toneStyles[tone].accent;

  if (title === 'Interview') {
    return (
      <div className="h-[56px] w-[152px] rounded-[12px] border border-white/[0.09] bg-black/18 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="mb-2 flex items-center justify-between gap-2.5">
          <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/34">Answer cue</span>
          <span className="rounded-full border px-2 py-0.5 text-[7.5px] font-semibold uppercase tracking-[0.16em]" style={{ borderColor: `${accent}38`, color: accent }}>
            STAR
          </span>
        </div>
        <div className="space-y-2">
          <div className="h-1.5 w-[78%] rounded-full bg-white/14" />
          <div className="h-1.5 w-[52%] rounded-full" style={{ background: `${accent}58` }} />
        </div>
      </div>
    );
  }

  if (title === 'Sales Copilot') {
    return (
      <div className="w-[96px] space-y-1.5">
        <div className="rounded-full border border-white/[0.08] bg-black/16 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-center gap-1.5 text-[7.5px] uppercase tracking-[0.16em] text-white/32">
            <span>Signal</span>
            <span style={{ color: accent }}>ready</span>
          </div>
        </div>
        <SignalBars accent={accent} />
      </div>
    );
  }

  if (title === 'Technical') {
    return (
      <div className="rounded-[11px] border border-white/[0.08] bg-black/18 px-2.5 py-1.5 font-mono text-[8.5px] leading-relaxed text-white/46 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div style={{ color: accent }}>O(log n)</div>
        <div className="text-white/28">cache memo</div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-[11px] border border-white/[0.08] bg-black/18 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <div className="h-1.5 w-[78%] rounded-full bg-white/16" />
      <div className="h-1.5 w-[54%] rounded-full" style={{ background: `${accent}55` }} />
    </div>
  );
}

function ModeCard({ title, description, tone, layout, icon: Icon, centered = false, className }: ModeCardProps) {
  const toneStyle = toneStyles[tone];
  const isSquare = layout === 'square';
  const isWide = layout === 'wide';
  const isTall = layout === 'tall';
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.article
      whileHover={prefersReducedMotion ? undefined : { y: -2, scale: 1.01 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={clsx(
        'group relative overflow-hidden rounded-[24px] border-[2px] border-white/[0.14] bg-[#1c1c1d] shadow-[0_0_0_1px_rgba(255,255,255,0.055),0_18px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.10)]',
        isTall && 'min-h-[180px] md:min-h-[186px]',
        isWide && 'min-h-[84px] md:min-h-[86px]',
        isSquare && 'min-h-[72px]',
        className,
      )}
    >
      <div className={clsx('pointer-events-none absolute inset-0 opacity-100 transition-all duration-200', toneStyle.glow, toneStyle.hoverGlow)} />
      <div className="pointer-events-none absolute inset-[1px] rounded-[23px] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_-40px_80px_rgba(0,0,0,0.12)]" />
      <div
        className="pointer-events-none absolute inset-[5px] rounded-[18px] border-2 border-white/[0.10]"
        style={{
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.045), inset 0 0 0 1px ${toneStyle.accent}22`,
        }}
      />
      <motion.div
        className="pointer-events-none absolute -left-24 top-0 h-full w-24 rotate-12 bg-white/[0.10] blur-xl"
        animate={prefersReducedMotion ? undefined : { x: [-80, 430], opacity: [0, 0.36, 0] }}
        transition={{ duration: 4.8, repeat: Infinity, repeatDelay: 2.2, ease: 'easeInOut' }}
      />
      {isSquare && (
        <div
          className="pointer-events-none absolute bottom-6 right-7 z-[1] hidden h-[3px] w-14 rounded-full opacity-65 sm:block"
          style={{ background: `linear-gradient(90deg, transparent, ${toneStyle.accent}88, transparent)` }}
        />
      )}
      {isSquare && (
        <div
          className="pointer-events-none absolute right-7 top-7 z-[1] hidden h-1.5 w-1.5 rounded-full opacity-90 sm:block"
          style={{ background: toneStyle.accent, boxShadow: `0 0 18px ${toneStyle.accent}55` }}
        />
      )}
      {isSquare && (
        <div
          className="pointer-events-none absolute bottom-7 right-12 z-[1] hidden h-1.5 w-7 rounded-full opacity-35 sm:block"
          style={{ background: toneStyle.accent }}
        />
      )}

		      <div
	        className={clsx(
	          'relative z-10 h-full rounded-[23px]',
	          isTall && 'grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3.5 px-4 py-3.5 md:px-5 md:py-4',
	          isWide && 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 px-4 py-3 md:px-5',
	          isSquare && 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 px-3.5 py-2.5 md:px-4',
	        )}
	      >
	        <div
	          className={clsx(
	            'flex min-w-0',
	            isTall ? 'flex-col' : 'contents',
	          )}
	        >
          <div
            className={clsx(
              'flex shrink-0 items-center justify-center rounded-[14px] border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]',
              isSquare ? 'h-[34px] w-[34px] rounded-[10px]' : 'h-[38px] w-[38px] md:h-[40px] md:w-[40px]',
              toneStyle.iconWrap,
            )}
          >
            <Icon className={clsx('h-[18px] w-[18px] stroke-[2]', isSquare && 'h-[16px] w-[16px]', toneStyle.icon)} />
          </div>

		          <div className={clsx('min-w-0', isTall && 'mt-3.5')}>
		            <h3
		              className={clsx(
		                'font-semibold tracking-[-0.04em] text-white',
		                isSquare ? 'whitespace-nowrap' : 'truncate',
		                centered ? 'text-[14.5px]' : 'text-[16px] md:text-[17px]',
		                isSquare && 'text-[13.5px] md:text-[14.5px]',
              )}
            >
              {title}
            </h3>
            {description ? (
              <p
                className={clsx(
                  'mt-1 max-w-[15ch] text-[12px] leading-[1.28] tracking-[-0.02em] text-white/50 md:text-[13px]',
                  isWide && 'max-w-none leading-[1.2]',
                  isTall && 'max-w-[22ch]',
                )}
              >
                {description}
              </p>
            ) : null}
          </div>
        </div>

	        {!isSquare && (
	          <div
	            className={clsx(
	              'relative z-10 shrink-0',
	              isTall && 'w-[152px] self-end',
	              isWide && 'hidden w-[104px] sm:block',
	            )}
	          >
	            <ModeMicroDetail title={title} tone={tone} />
	          </div>
	        )}
	      </div>
    </motion.article>
  );
}

function LockedFooter({
  onOpenTeamSyncAPI,
}: {
  onOpenTeamSyncAPI?: () => void;
}) {
  const handleUnlockPro = () => {
    onOpenTeamSyncAPI?.();
  };

  return (
    <motion.footer variants={modesItemVariants} className="border-t border-white/[0.07] px-5 py-2.5 md:px-6 md:py-3">
      <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
        <button
          type="button"
          onClick={onOpenTeamSyncAPI}
          className="inline-flex items-center gap-1.5 text-[13px] tracking-[-0.02em] text-white/42 transition-colors duration-200 hover:text-white/72"
        >
          <span>I have a license</span>
          <ChevronRight className="h-4 w-4 stroke-[2.2]" />
        </button>

        <div className="text-center md:px-5">
          <p className="text-[13px] tracking-[-0.025em] text-white/40 md:text-[14px]">
            Currently you are restricted to General Mode.
          </p>
          <p className="mt-0.5 text-[14px] tracking-[-0.028em] text-[#ffc633] md:text-[15px]">
            Unlock Pro to access 6 advanced experts and unlimited custom modes.
          </p>
        </div>

        <button
          type="button"
          onClick={handleUnlockPro}
          className="inline-flex h-[44px] items-center justify-between rounded-full bg-white pl-5 pr-2.5 text-[14px] font-semibold tracking-[-0.035em] text-[#141414] shadow-[0_18px_42px_rgba(0,0,0,0.24)] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]"
        >
          <span className="min-w-[94px] text-left">Unlock Pro</span>
          <span className="ml-2.5 flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[#ececec] text-[#161616]">
            <ArrowUpRight className="h-[16px] w-[16px] stroke-[2.3]" />
          </span>
        </button>
      </div>
    </motion.footer>
  );
}

function PremiumFooter({ onClose }: { onClose: () => void }) {
  return (
    <motion.footer variants={modesItemVariants} className="border-t border-white/[0.07] px-5 py-3 md:px-6 md:py-4">
      <div className="flex flex-col items-center justify-between gap-3 text-center md:flex-row md:text-left">
        <div>
          <p className="text-[13px] tracking-[-0.025em] text-white/70 md:text-[14px]">
            All six advanced experts are unlocked.
          </p>
          <p className="mt-0.5 text-[13px] tracking-[-0.02em] text-white/42">
            Mode profiles will plug into this surface next.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-[44px] items-center rounded-full border border-white/10 bg-white/[0.06] px-5 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors duration-200 hover:bg-white/[0.09]"
        >
          Close
        </button>
      </div>
    </motion.footer>
  );
}

const ModesSettings: React.FC<ModesSettingsProps> = ({
  onClose,
  isPremium = false,
  isLoaded = true,
  isTrialActive = false,
  onOpenTeamSyncAPI,
}) => {
  const isRestricted = isLoaded ? !isPremium && !isTrialActive : true;
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.section
      initial={prefersReducedMotion ? false : 'hidden'}
      animate="show"
      variants={modesSurfaceVariants}
      className="relative flex h-full flex-col overflow-hidden bg-[#151515] text-white"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", sans-serif' }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0))]" />

      <button
        type="button"
        onClick={onClose}
        aria-label="Close modes"
        className="absolute right-5 top-5 z-20 flex h-[36px] w-[36px] items-center justify-center rounded-full border border-white/[0.035] bg-white/[0.05] text-white/45 backdrop-blur-sm transition-colors duration-200 hover:text-white/70"
      >
        <X className="h-[18px] w-[18px] stroke-[2]" />
      </button>

      <div className="flex-1 overflow-y-auto px-5 pb-3 pt-[38px] md:px-6">
        <div className="mx-auto flex max-w-[720px] flex-col">
          <motion.header variants={modesItemVariants} className="mx-auto max-w-[560px] text-center">
            <h1 className="text-[30px] font-semibold leading-[0.94] tracking-[-0.06em] text-white md:text-[34px]">
              <span className="block">Every conversation.</span>
              <span className="mt-1 block">A different expert.</span>
            </h1>
            <p className="mx-auto mt-3 max-w-[500px] text-[12.5px] leading-[1.34] tracking-[-0.03em] text-white/38 md:text-[13.5px]">
              Six dedicated AI modes tuned for the exact room you&apos;re in. Designed for professionals.
            </p>
          </motion.header>

          <motion.div variants={modesItemVariants} className="mx-auto mt-4 w-full max-w-[720px]">
            <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[92px_96px_82px]">
              <ModeCard {...cards[0]} className="lg:row-span-2 lg:h-full" />
              <ModeCard {...cards[1]} className="lg:h-full" />
              <div className="grid gap-2.5 sm:grid-cols-2 lg:h-full">
                <ModeCard {...cards[2]} className="lg:h-full" />
                <ModeCard {...cards[3]} className="lg:h-full" />
              </div>
              <ModeCard {...cards[4]} className="lg:h-full" />
              <ModeCard {...cards[5]} className="lg:h-full" />
            </div>
          </motion.div>
        </div>
      </div>

      {isRestricted ? (
        <LockedFooter onOpenTeamSyncAPI={onOpenTeamSyncAPI} />
      ) : (
        <PremiumFooter onClose={onClose} />
      )}
    </motion.section>
  );
};

export default ModesSettings;
