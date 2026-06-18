import type { Variants } from 'framer-motion';

// ── Shared animation variants for all onboarding V3 step components ──
// These match the existing PremiumOnboardingV2 aesthetic exactly.

export const stepModalVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 80,
    scale: 0.97,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      duration: 0.72,
      bounce: 0.14,
      delayChildren: 0.14,
      staggerChildren: 0.06,
    },
  },
  advanceExit: {
    opacity: 0,
    y: 80,
    scale: 0.97,
    transition: {
      duration: 0.52,
      ease: [0.32, 0, 0.67, 0],
    },
  },
  exit: {
    opacity: 0,
    y: 80,
    scale: 0.97,
    transition: {
      duration: 0.38,
      ease: [0.32, 0, 0.67, 0],
    },
  },
};

export const stepItemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 18,
    scale: 0.992,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      duration: 0.72,
      bounce: 0.12,
    },
  },
};

export const stepGroupVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.1,
      staggerChildren: 0.065,
    },
  },
};

export const modalFrameStyle = {
  backfaceVisibility: 'hidden' as const,
};

/** Shared border fade for glass modal frames */
export function ModalFrameBorder({
  radiusClass = 'rounded-[15px]',
  borderClass = 'border-[#a1a3aa]/55',
}: {
  radiusClass?: string;
  borderClass?: string;
}) {
  const bottomFadeMask =
    'linear-gradient(to bottom, #000 0, #000 calc(100% - 30px), transparent calc(100% - 10px))';
  return (
    <div
      className={`pointer-events-none absolute inset-0 ${radiusClass} border ${borderClass}`}
      style={{
        WebkitMaskImage: bottomFadeMask,
        maskImage: bottomFadeMask,
      }}
    />
  );
}
