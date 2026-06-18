import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Lightbulb, CornerUpRight, Zap, SkipForward } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { PersonaId } from '../onboardingV2Types';
import {
  stepModalVariants,
  stepItemVariants,
  modalFrameStyle,
  ModalFrameBorder,
} from './animations';

// ── Persona-aware demo content ──

interface DemoScenario {
  transcript: string;
  actions: Array<{
    id: string;
    label: string;
    shortcut: string;
    icon: typeof MessageSquare;
    response: string;
  }>;
}

const DEMO_SCENARIOS: Record<string, DemoScenario> = {
  interview_preparation: {
    transcript: '"Explain a scaling issue you encountered and how you fixed it."',
    actions: [
      {
        id: 'answer',
        label: 'What To Answer',
        shortcut: '⌘1',
        icon: MessageSquare,
        response:
          'Start with the technical context — what system, what scale. Walk through your debugging methodology: hypothesis → evidence → fix → validation. Mention the 3x throughput improvement and the monitoring you added afterward.',
      },
      {
        id: 'clarify',
        label: 'Clarify',
        shortcut: '⌘2',
        icon: Lightbulb,
        response:
          'Could you specify: was this a horizontal scaling issue (more instances) or vertical (optimizing existing resources)? The framing changes how you\'d structure the answer.',
      },
      {
        id: 'followup',
        label: 'Follow Up',
        shortcut: '⌘4',
        icon: CornerUpRight,
        response:
          'What monitoring or alerting did you set up afterward to prevent recurrence? How did you validate the fix under production load?',
      },
    ],
  },
  meetings_calls: {
    transcript: '"Can everyone align on the timeline for the Q3 launch? We need to finalize the scope."',
    actions: [
      {
        id: 'answer',
        label: 'Summarize',
        shortcut: '⌘1',
        icon: MessageSquare,
        response:
          'Key decision: Q3 launch timeline is July 15. Scope includes auth v2, dashboard redesign, and API rate limiting. Mobile SDK deferred to Q4. Action items: Sarah owns auth, Mike owns dashboard, review checkpoint June 28.',
      },
      {
        id: 'clarify',
        label: 'Clarify',
        shortcut: '⌘2',
        icon: Lightbulb,
        response:
          'The speaker mentioned "finalize scope" — are they asking for input on what to include, or confirming an already-decided scope? The team\'s response will tell you.',
      },
      {
        id: 'followup',
        label: 'Follow Up',
        shortcut: '⌘4',
        icon: CornerUpRight,
        response:
          'What are the dependencies between auth v2 and the dashboard redesign? Should they be sequenced or can they run in parallel?',
      },
    ],
  },
  developer: {
    transcript: '"Design a URL shortener that handles 10M daily active users."',
    actions: [
      {
        id: 'answer',
        label: 'What To Answer',
        shortcut: '⌘1',
        icon: MessageSquare,
        response:
          'Start with requirements: read-heavy (100:1 ratio), ~1B reads/day. Use Base62 encoding for short codes. Architecture: API gateway → write service → Redis cache → Cassandra. Cache hit ratio ~95% reduces DB load. Add rate limiting per API key and async analytics pipeline.',
      },
      {
        id: 'clarify',
        label: 'Code Hint',
        shortcut: '⌘6',
        icon: Lightbulb,
        response:
          'For the hashing: use MD5(longUrl + timestamp).substring(0, 7) converted to Base62. Collision rate at 62^7 ≈ 3.5T possible codes is negligible. Add collision detection with retry.',
      },
      {
        id: 'followup',
        label: 'Follow Up',
        shortcut: '⌘4',
        icon: CornerUpRight,
        response:
          'How would you handle link expiration? Consider a TTL in Redis and a background cleanup job for Cassandra. Also discuss: custom aliases, analytics dashboard, and abuse prevention.',
      },
    ],
  },
  explore_quietly: {
    transcript: '"Draft a response to this client asking about our pricing for the enterprise plan."',
    actions: [
      {
        id: 'answer',
        label: 'Draft Response',
        shortcut: '⌘1',
        icon: MessageSquare,
        response:
          'Hi [Client], thanks for your interest in our Enterprise plan. It includes unlimited seats, dedicated support, SSO/SAML, and custom integrations. Pricing starts at $49/seat/month with volume discounts. I\'d love to schedule a call to discuss your specific needs — how does Thursday at 2pm work?',
      },
      {
        id: 'clarify',
        label: 'Clarify',
        shortcut: '⌘2',
        icon: Lightbulb,
        response:
          'Before responding, check: what\'s their team size? Have they mentioned specific features they need? This affects which tier and pricing to quote.',
      },
      {
        id: 'followup',
        label: 'Brainstorm',
        shortcut: '⌘7',
        icon: CornerUpRight,
        response:
          'Consider offering a 14-day pilot program — it reduces commitment anxiety and typically converts at 72%. Include a success metrics framework so they can measure ROI.',
      },
    ],
  },
};

// ── Typing animation hook ──

function useTypingEffect(text: string, speed: number, enabled: boolean) {
  const [displayed, setDisplayed] = useState('');
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setDisplayed('');
      setIsDone(false);
      return;
    }
    let index = 0;
    setDisplayed('');
    setIsDone(false);
    const timer = setInterval(() => {
      index++;
      if (index <= text.length) {
        setDisplayed(text.slice(0, index));
      } else {
        clearInterval(timer);
        setIsDone(true);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed, enabled]);

  return { displayed, isDone };
}

// ── Component ──

export type InteractiveDemoStepProps = {
  persona: PersonaId | null;
  isAdvancing: boolean;
  onContinue: () => void;
  onSkip: () => void;
};

export function InteractiveDemoStep({
  persona,
  isAdvancing,
  onContinue,
  onSkip,
}: InteractiveDemoStepProps) {
  const scenario = DEMO_SCENARIOS[persona || 'explore_quietly'] || DEMO_SCENARIOS.explore_quietly;
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showStealthIndicator, setShowStealthIndicator] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Show the overlay with delay (Natively-style)
  useEffect(() => {
    const timer = setTimeout(() => setShowOverlay(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const activeResponse = selectedAction
    ? scenario.actions.find((a) => a.id === selectedAction)?.response || ''
    : '';

  const { displayed: typedResponse, isDone: typingDone } = useTypingEffect(
    activeResponse,
    28,
    !!selectedAction,
  );

  // Show stealth indicator while typing
  useEffect(() => {
    if (selectedAction && !typingDone) {
      setShowStealthIndicator(true);
    } else {
      const timer = setTimeout(() => setShowStealthIndicator(false), 600);
      return () => clearTimeout(timer);
    }
  }, [selectedAction, typingDone]);

  // Mark as interacted when typing is done
  useEffect(() => {
    if (typingDone && selectedAction) {
      setHasInteracted(true);
    }
  }, [typingDone, selectedAction]);

  const handleActionClick = useCallback(
    (actionId: string) => {
      if (isAdvancing) return;
      setSelectedAction(actionId);
    },
    [isAdvancing],
  );

  return (
    <motion.section
      key="onboarding-v3-demo"
      variants={stepModalVariants}
      initial="hidden"
      animate={isAdvancing ? 'advanceExit' : 'visible'}
      exit="exit"
      data-testid="onboarding-v3-demo"
      className={`relative w-[calc(100vw-32px)] max-w-[600px] transform-gpu overflow-hidden rounded-[15px] bg-[#0b0d12]/[0.70] shadow-[0_26px_90px_rgba(0,0,0,0.50),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-[34px] will-change-transform ${
        isAdvancing ? 'pointer-events-none' : ''
      }`}
      style={modalFrameStyle}
    >
      <ModalFrameBorder />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_93%,rgba(109,55,28,0.13),transparent_43%),radial-gradient(circle_at_70%_94%,rgba(91,45,18,0.11),transparent_46%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#08090d] opacity-70" />

      <div className="px-[28px] pb-[24px] pt-[36px]">
        {/* Header */}
        <motion.div variants={stepItemVariants} className="mb-[6px] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/36">
            <Zap className="h-3.5 w-3.5" strokeWidth={2} />
            Try it out
          </div>
          <button
            type="button"
            onClick={onSkip}
            disabled={isAdvancing}
            className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/40 transition-colors hover:border-white/[0.16] hover:text-white/60"
          >
            <SkipForward className="h-3 w-3" />
            Skip
          </button>
        </motion.div>

        <motion.h2
          variants={stepItemVariants}
          className="text-[28px] font-semibold leading-[1.10] text-white/88 drop-shadow-[0_0_10px_rgba(255,255,255,0.15)]"
        >
          See TeamSync in action
        </motion.h2>
        <motion.p
          variants={stepItemVariants}
          className="mt-[8px] text-[13px] font-semibold text-white/48"
        >
          Click a quick action to see how TeamSync responds.
        </motion.p>

        {/* Video + Overlay Simulation */}
        <motion.div
          variants={stepItemVariants}
          className="relative mt-[20px] overflow-hidden rounded-[12px] border border-white/[0.08]"
        >
          {/* Video background */}
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#1a1a2e]">
            <video
              ref={videoRef}
              src="hero.webm"
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            {/* Dark overlay on video */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

            {/* Simulated TeamSync overlay appearing */}
            <AnimatePresence>
              {showOverlay && (
                <motion.div
                  initial={{ y: 40, opacity: 0, scale: 0.95 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{
                    type: 'spring',
                    duration: 0.8,
                    bounce: 0.16,
                  }}
                  className="absolute bottom-3 left-3 right-3 overflow-hidden rounded-[10px] border border-white/[0.12] bg-[#0d1117]/[0.92] p-3 backdrop-blur-[20px] shadow-[0_8px_40px_rgba(0,0,0,0.50)]"
                >
                  {/* Transcript bubble */}
                  <div className="mb-2.5 rounded-[8px] border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                    <p className="text-[11px] font-medium leading-[1.5] text-white/60">
                      {scenario.transcript}
                    </p>
                  </div>

                  {/* AI Response area */}
                  <AnimatePresence mode="wait">
                    {selectedAction && (
                      <motion.div
                        key={selectedAction}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        className="mb-2.5 rounded-[8px] border border-[#3b82f6]/20 bg-[#3b82f6]/[0.06] px-3 py-2"
                      >
                        <p className="text-[11px] font-medium leading-[1.6] text-white/80">
                          {typedResponse}
                          {!typingDone && (
                            <motion.span
                              animate={{ opacity: [1, 0] }}
                              transition={{ repeat: Infinity, duration: 0.6 }}
                              className="inline-block h-[13px] w-[2px] translate-y-[2px] bg-[#3b82f6]"
                            />
                          )}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Quick action buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    {scenario.actions.map((action) => {
                      const Icon = action.icon;
                      const isActive = selectedAction === action.id;
                      return (
                        <motion.button
                          key={action.id}
                          type="button"
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => handleActionClick(action.id)}
                          disabled={isAdvancing}
                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all duration-200 ${
                            isActive
                              ? 'border-[#3b82f6]/50 bg-[#3b82f6]/20 text-white/90 shadow-[0_0_12px_rgba(59,130,246,0.20)]'
                              : 'border-white/[0.10] bg-white/[0.06] text-white/60 hover:border-white/[0.20] hover:bg-white/[0.10]'
                          }`}
                        >
                          <Icon className="h-3 w-3" strokeWidth={1.8} />
                          {action.label}
                          <span className="ml-0.5 text-[9px] text-white/30">{action.shortcut}</span>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* Stealth typing indicator */}
                  <AnimatePresence>
                    {showStealthIndicator && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="mt-2 flex items-center gap-1.5"
                      >
                        <div className="flex gap-[3px]">
                          {[0, 1, 2].map((i) => (
                            <motion.div
                              key={i}
                              animate={{ opacity: [0.3, 1, 0.3] }}
                              transition={{
                                repeat: Infinity,
                                duration: 1,
                                delay: i * 0.2,
                                ease: 'easeInOut',
                              }}
                              className="h-[4px] w-[4px] rounded-full bg-[#3b82f6]"
                            />
                          ))}
                        </div>
                        <span className="text-[9px] font-medium text-white/30">
                          Stealth typing active
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Continue button — only after interaction */}
        <motion.div
          variants={stepItemVariants}
          className="mt-[20px]"
        >
          <AnimatePresence>
            {hasInteracted ? (
              <motion.button
                key="continue"
                type="button"
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: 'spring', duration: 0.6, bounce: 0.16 }}
                whileHover={{ y: -1, scale: 1.006 }}
                whileTap={{ scale: 0.986 }}
                onClick={onContinue}
                disabled={isAdvancing}
                className="group relative inline-flex h-[42px] w-full items-center justify-center gap-2 overflow-hidden rounded-full border border-white/[0.16] bg-white/[0.94] px-5 text-[13px] font-semibold text-[#050506] shadow-[0_12px_32px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors duration-300 hover:bg-white"
              >
                <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-white/70" />
                Continue
              </motion.button>
            ) : (
              <motion.p
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center text-[12px] font-medium text-white/30"
              >
                {showOverlay
                  ? 'Click a quick action above to try it ↑'
                  : 'Loading demo…'}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.section>
  );
}
