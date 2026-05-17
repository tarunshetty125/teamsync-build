import React from 'react';
import { motion } from 'framer-motion';
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
}

const toneStyles: Record<CardTone, {
  glow: string;
  hoverGlow: string;
  iconWrap: string;
  icon: string;
}> = {
  purple: {
    glow: 'bg-[radial-gradient(circle_at_16%_18%,rgba(132,109,206,0.26),transparent_44%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_18%_18%,rgba(145,119,230,0.34),transparent_46%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#5d4e86]/[0.62] border-[#806bbc]/65',
    icon: 'text-[#f1effa]',
  },
  green: {
    glow: 'bg-[radial-gradient(circle_at_86%_22%,rgba(56,109,86,0.28),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_84%_24%,rgba(72,132,105,0.36),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#3d5e55]/[0.65] border-[#4b9b83]/70',
    icon: 'text-[#eff8f4]',
  },
  gold: {
    glow: 'bg-[radial-gradient(circle_at_28%_28%,rgba(138,111,47,0.24),transparent_50%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_28%_28%,rgba(158,128,56,0.33),transparent_50%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#5c4b28]/[0.66] border-[#d7aa2f]/70',
    icon: 'text-[#ffc83c]',
  },
  rose: {
    glow: 'bg-[radial-gradient(circle_at_78%_22%,rgba(112,72,82,0.28),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_78%_22%,rgba(136,84,98,0.36),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#594048]/[0.67] border-[#e46a80]/65',
    icon: 'text-[#ff6d86]',
  },
  blue: {
    glow: 'bg-[radial-gradient(circle_at_12%_50%,rgba(50,99,126,0.25),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_12%_50%,rgba(63,125,159,0.35),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#34566c]/[0.66] border-[#4389b8]/65',
    icon: 'text-[#f1f7fb]',
  },
  cyan: {
    glow: 'bg-[radial-gradient(circle_at_84%_36%,rgba(47,104,118,0.26),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_84%_36%,rgba(60,128,145,0.36),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#355867]/[0.66] border-[#46abc9]/65',
    icon: 'text-[#eefaff]',
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

function ModeCard({ title, description, tone, layout, icon: Icon, centered = false }: ModeCardProps) {
  const toneStyle = toneStyles[tone];
  const isSquare = layout === 'square';

  return (
    <motion.article
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={clsx(
        'group relative overflow-hidden rounded-[28px] border border-white/[0.055] bg-[#1c1c1d] shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.02)]',
        layout === 'tall' && 'min-h-[180px] md:min-h-[203px]',
        layout === 'wide' && 'min-h-[102px] md:min-h-[90px]',
        layout === 'square' && 'min-h-[78px] md:min-h-[84px]',
      )}
    >
      <div className={clsx('pointer-events-none absolute inset-0 opacity-100 transition-all duration-200', toneStyle.glow, toneStyle.hoverGlow)} />
      <div className="pointer-events-none absolute inset-[1px] rounded-[27px] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_-40px_80px_rgba(0,0,0,0.12)]" />

      <div
        className={clsx(
          'relative z-10 flex h-full rounded-[27px] px-5 py-4 md:px-6 md:py-5',
          centered ? 'items-center gap-3' : 'flex-col justify-between',
          centered && isSquare && 'pl-5 md:pl-6',
          layout === 'wide' && !centered && 'items-start gap-4 sm:flex-row sm:items-center sm:gap-4',
        )}
      >
        <div
          className={clsx(
            'flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[14px] border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:h-[46px] md:w-[46px]',
            isSquare && 'h-[40px] w-[40px] rounded-[12px] md:h-[42px] md:w-[42px]',
            toneStyle.iconWrap,
          )}
        >
          <Icon className={clsx('h-[20px] w-[20px] stroke-[2]', isSquare && 'h-[18px] w-[18px]', toneStyle.icon)} />
        </div>

        <div
          className={clsx(
            'min-w-0',
            centered && 'flex flex-col justify-center',
            centered && isSquare && 'items-start',
            layout === 'wide' && !centered && 'sm:flex-1',
          )}
        >
          <h3
            className={clsx(
              'font-semibold tracking-[-0.04em] text-white',
              centered ? 'text-[16px]' : 'text-[18px] md:text-[19px]',
              isSquare && 'text-[15px] md:text-[16px]',
            )}
          >
            {title}
          </h3>
          {description ? (
            <p
              className={clsx(
                'mt-1 max-w-[15ch] text-[13px] leading-[1.28] tracking-[-0.02em] text-white/50 md:text-[14px]',
                layout === 'wide' && 'max-w-none leading-[1.2]',
                layout === 'tall' && 'max-w-[16ch]',
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
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
    window.electronAPI?.openExternal?.('mailto:tarunshetty125@gmail.com');
  };

  return (
    <footer className="border-t border-white/[0.07] px-6 py-4 md:px-8 md:py-5">
      <div className="grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-center">
        <button
          type="button"
          onClick={onOpenTeamSyncAPI}
          className="inline-flex items-center gap-1.5 text-[14px] tracking-[-0.02em] text-white/42 transition-colors duration-200 hover:text-white/72"
        >
          <span>I have a license</span>
          <ChevronRight className="h-4 w-4 stroke-[2.2]" />
        </button>

        <div className="text-center md:px-5">
          <p className="text-[14px] tracking-[-0.025em] text-white/40 md:text-[15px]">
            Currently you are restricted to General Mode.
          </p>
          <p className="mt-1 text-[15px] tracking-[-0.028em] text-[#ffc633] md:text-[16px]">
            Unlock Pro to access 6 advanced experts and unlimited custom modes.
          </p>
        </div>

        <button
          type="button"
          onClick={handleUnlockPro}
          className="inline-flex h-[58px] items-center justify-between rounded-full bg-white pl-6 pr-3 text-[16px] font-semibold tracking-[-0.035em] text-[#141414] shadow-[0_22px_50px_rgba(0,0,0,0.25)] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]"
        >
          <span className="min-w-[108px] text-left">Unlock Pro</span>
          <span className="ml-3 flex h-[44px] w-[44px] items-center justify-center rounded-full bg-[#ececec] text-[#161616]">
            <ArrowUpRight className="h-4.5 w-4.5 stroke-[2.3]" />
          </span>
        </button>
      </div>
    </footer>
  );
}

function PremiumFooter({ onClose }: { onClose: () => void }) {
  return (
    <footer className="border-t border-white/[0.07] px-6 py-4 md:px-8 md:py-5">
      <div className="flex flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
        <div>
          <p className="text-[14px] tracking-[-0.025em] text-white/70 md:text-[15px]">
            All six advanced experts are unlocked.
          </p>
          <p className="mt-1 text-[14px] tracking-[-0.02em] text-white/42">
            Mode profiles will plug into this surface next.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-[52px] items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-[15px] font-medium tracking-[-0.03em] text-white transition-colors duration-200 hover:bg-white/[0.09]"
        >
          Close
        </button>
      </div>
    </footer>
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

  return (
    <section
      className="relative flex h-full flex-col overflow-hidden bg-[#151515] text-white"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", sans-serif' }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0))]" />

      <button
        type="button"
        onClick={onClose}
        aria-label="Close modes"
        className="absolute right-7 top-7 z-20 flex h-[42px] w-[42px] items-center justify-center rounded-full border border-white/[0.035] bg-white/[0.05] text-white/45 backdrop-blur-sm transition-colors duration-200 hover:text-white/70"
      >
        <X className="h-5 w-5 stroke-[2]" />
      </button>

      <div className="flex-1 overflow-y-auto px-6 pb-4 pt-[60px] md:px-8">
        <div className="mx-auto flex max-w-[820px] flex-col">
          <header className="mx-auto max-w-[650px] text-center">
            <h1 className="text-[36px] font-semibold leading-[0.94] tracking-[-0.06em] text-white md:text-[42px]">
              <span className="block">Every conversation.</span>
              <span className="mt-1 block">A different expert.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-[560px] text-[14px] leading-[1.34] tracking-[-0.03em] text-white/38 md:text-[15px]">
              Six dedicated AI modes tuned for the exact room you&apos;re in. Designed for professionals.
            </p>
          </header>

          <div className="mx-auto mt-6 w-full max-w-[820px]">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-4">
              <div className="flex flex-col gap-3 lg:gap-4">
                <ModeCard {...cards[0]} />
                <ModeCard {...cards[4]} />
              </div>

              <div className="flex flex-col gap-3 lg:gap-4">
                <ModeCard {...cards[1]} />
                <div className="grid gap-3 sm:grid-cols-2 lg:gap-4">
                  <ModeCard {...cards[2]} />
                  <ModeCard {...cards[3]} />
                </div>
                <ModeCard {...cards[5]} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {isRestricted ? (
        <LockedFooter onOpenTeamSyncAPI={onOpenTeamSyncAPI} />
      ) : (
        <PremiumFooter onClose={onClose} />
      )}
    </section>
  );
};

export default ModesSettings;
