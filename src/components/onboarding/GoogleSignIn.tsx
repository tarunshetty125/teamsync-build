import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion';
import appIcon from '../icon.png';

interface GoogleSignInProps {
  onSignInComplete: (userData: {
    token: string;
    name: string;
    email: string;
    picture?: string;
    calendarConnected: boolean;
    isNewUser: boolean;
  }) => void;
}

const BACKEND_URL = 'http://localhost:3456';

// ─────────────────────────────────────────────────────────────
// Particle System — Ambient floating orbs
// ─────────────────────────────────────────────────────────────
const Particles: React.FC = () => {
  const particles = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    duration: Math.random() * 20 + 15,
    delay: Math.random() * 8,
    opacity: Math.random() * 0.3 + 0.05,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: `radial-gradient(circle, rgba(255,255,255,${p.opacity}) 0%, transparent 70%)`,
          }}
          animate={{
            y: [0, -30, 0, 20, 0],
            x: [0, 15, -10, 5, 0],
            opacity: [p.opacity, p.opacity * 1.5, p.opacity * 0.5, p.opacity],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Aurora Background — Animated gradient mesh
// ─────────────────────────────────────────────────────────────
const AuroraBackground: React.FC = () => (
  <div className="absolute inset-0 overflow-hidden">
    {/* Deep radial gradients that pulse and drift */}
    <motion.div
      className="absolute -top-1/2 -left-1/4 w-[120%] h-[120%]"
      style={{
        background: 'radial-gradient(ellipse at 30% 20%, rgba(59, 130, 246, 0.12) 0%, transparent 60%)',
      }}
      animate={{
        scale: [1, 1.1, 1],
        opacity: [0.8, 1, 0.8],
        rotate: [0, 3, 0],
      }}
      transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div
      className="absolute -bottom-1/3 -right-1/4 w-[100%] h-[100%]"
      style={{
        background: 'radial-gradient(ellipse at 70% 80%, rgba(168, 85, 247, 0.08) 0%, transparent 55%)',
      }}
      animate={{
        scale: [1, 1.15, 1],
        opacity: [0.6, 1, 0.6],
        rotate: [0, -2, 0],
      }}
      transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
    />
    <motion.div
      className="absolute top-1/3 left-1/3 w-[80%] h-[80%]"
      style={{
        background: 'radial-gradient(ellipse at 50% 50%, rgba(16, 185, 129, 0.06) 0%, transparent 50%)',
      }}
      animate={{
        scale: [1, 1.08, 1],
        opacity: [0.5, 0.8, 0.5],
      }}
      transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
    />
  </div>
);

// ─────────────────────────────────────────────────────────────
// Google Logo SVG
// ─────────────────────────────────────────────────────────────
const GoogleLogo: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// ─────────────────────────────────────────────────────────────
// Main Sign-In Component
// ─────────────────────────────────────────────────────────────
const GoogleSignIn: React.FC<GoogleSignInProps> = ({ onSignInComplete }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'waiting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showContent, setShowContent] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Staggered entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 400);
    return () => clearTimeout(timer);
  }, []);

  // Check if user is already authenticated
  useEffect(() => {
    const token = localStorage.getItem('natively_auth_token');
    if (token) {
      verifyExistingToken(token);
    }
  }, []);

  const verifyExistingToken = async (token: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const user = await res.json();
        onSignInComplete({
          token,
          name: user.name,
          email: user.email,
          picture: user.picture,
          calendarConnected: user.calendarConnected,
          isNewUser: false,
        });
      } else {
        localStorage.removeItem('natively_auth_token');
      }
    } catch {
      // Server not running — ignore, user can sign in manually
    }
  };

  // Clean approach: Use backend polling after opening OAuth in browser
  const handleSignIn = async () => {
    setState('loading');
    setErrorMessage('');

    try {
      const res = await fetch(`${BACKEND_URL}/auth/google`);
      if (!res.ok) throw new Error('Could not connect to server');

      const { url } = await res.json();

      // Open auth in external browser
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(url);
      } else {
        window.open(url, '_blank');
      }

      setState('waiting');

      // Start polling for token (backend stores it on callback)
      startTokenPolling();

    } catch (error: any) {
      setState('error');
      setErrorMessage(
        error.message?.includes('connect') || error.message?.includes('fetch')
          ? 'Backend server not running. Start it with: cd backend && npm run dev'
          : error.message || 'Failed to start sign in'
      );
    }
  };

  const startTokenPolling = () => {
    // Poll the backend /auth/pending endpoint for the auth result
    if (pollRef.current) clearInterval(pollRef.current);

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;

      if (attempts >= 180) { // 3 minutes
        clearInterval(pollRef.current!);
        setState('error');
        setErrorMessage('Sign in timed out. Please try again.');
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/auth/pending`);
        if (!res.ok) return;

        const data = await res.json();

        // Still waiting — no result yet
        if (data.pending) return;

        // Got a result — clear polling
        clearInterval(pollRef.current!);
        pollRef.current = null;

        if (data.success && data.token) {
          localStorage.setItem('natively_auth_token', data.token);
          if (data.user) {
            localStorage.setItem('natively_auth_user', JSON.stringify(data.user));
          }
          setState('success');

          // Delay slightly for the success animation
          setTimeout(() => {
            onSignInComplete({
              token: data.token,
              name: data.user?.name || 'User',
              email: data.user?.email || '',
              picture: data.user?.picture,
              calendarConnected: data.user?.calendarConnected || false,
              isNewUser: data.user?.isNewUser || false,
            });
          }, 1800);
        } else {
          setState('error');
          setErrorMessage(data.error || 'Sign in failed');
        }
      } catch {
        // Network error — ignore and keep polling
      }
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ─────────────────────────────────────────────
  // Animation variants
  // ─────────────────────────────────────────────
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.12, delayChildren: 0.3 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30, filter: 'blur(10px)' },
    visible: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.7, ease: [0.19, 1, 0.22, 1] as [number, number, number, number] },
    },
  };

  // ─────────────────────────────────────────────
  // Sign-in button animation (Scene.mp4 style)
  // ─────────────────────────────────────────────
  const btnX = useMotionValue(35);
  const btnY = useMotionValue(35);
  const btnXSpring = useSpring(btnX, { stiffness: 260, damping: 28, mass: 0.9 });
  const btnYSpring = useSpring(btnY, { stiffness: 260, damping: 28, mass: 0.9 });

  const highlight = useMotionTemplate`
      radial-gradient(240px 180px at ${btnXSpring}% ${btnYSpring}%, rgba(255,255,255,0.65), rgba(255,255,255,0.10) 55%, rgba(255,255,255,0) 70%),
      radial-gradient(220px 140px at clamp(0%, calc(${btnXSpring}% + 10%), 92%) clamp(0%, calc(${btnYSpring}% + 16%), 85%), rgba(66,133,244,0.16), rgba(66,133,244,0) 65%)
    `;

  return (
    <div className="fixed inset-0 z-[200] bg-[#030303] flex items-center justify-center overflow-hidden">
      {/* Animated Background Layers */}
      <AuroraBackground />
      <Particles />

      {/* Subtle vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.7)_100%)] pointer-events-none" />

      {/* Main Content */}
      <AnimatePresence>
        {showContent && (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="relative z-10 flex flex-col items-center max-w-[420px] w-full px-8"
          >
            {/* App Icon with Glow */}
            <motion.div variants={itemVariants} className="relative mb-8">
              <div className="absolute inset-0 w-20 h-20 bg-white/10 rounded-3xl blur-[30px] scale-150" />
              <motion.img
                src={appIcon}
                alt="TeamSync"
                className="w-20 h-20 object-contain relative z-10"
                animate={{
                  filter: [
                    'drop-shadow(0 0 10px rgba(255,255,255,0.1))',
                    'drop-shadow(0 0 25px rgba(255,255,255,0.2))',
                    'drop-shadow(0 0 10px rgba(255,255,255,0.1))',
                  ],
                }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </motion.div>

            {/* Welcome Text */}
            <motion.h1
              variants={itemVariants}
              className="text-[32px] font-semibold text-white tracking-[-0.02em] mb-2 text-center"
              style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}
            >
              Cheat on Everything
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="text-[15px] text-white/40 text-center mb-10 leading-relaxed max-w-[320px]"
            >
              Your AI meeting assistant. Sign in to sync your meetings, notes, and calendar.
            </motion.p>

            {/* Sign In Button */}
            <motion.div variants={itemVariants} className="w-full">
              <AnimatePresence mode="wait">
                {state === 'idle' || state === 'error' ? (
                  <motion.button
                    key="signin-btn"
                    onClick={handleSignIn}
                    onMouseMove={(e) => {
                      const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                      const x = ((e.clientX - rect.left) / rect.width) * 100;
                      const y = ((e.clientY - rect.top) / rect.height) * 100;
                      btnX.set(Math.max(0, Math.min(100, x)));
                      btnY.set(Math.max(0, Math.min(100, y)));
                    }}
                    onMouseLeave={() => {
                      btnX.set(35);
                      btnY.set(35);
                    }}
                    className="group relative w-full flex items-center justify-center gap-3 px-6 py-[14px] rounded-2xl text-[15px] font-medium overflow-hidden"
                    style={{
                      // Keep existing login theme/colors — only upgrade structure + highlight.
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                    }}
                    whileHover={{
                      scale: 1.01,
                      boxShadow: '0 4px 20px rgba(66,133,244,0.15), 0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
                      borderColor: 'rgba(66,133,244,0.3)',
                    }}
                    whileTap={{ scale: 0.99 }}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] }}
                  >
                    {/* "Start Natively" style layering (structure), but keep existing colors */}
                    <div className="absolute inset-x-3 top-0 h-[42%] bg-gradient-to-b from-white/20 to-transparent blur-[2px] rounded-b-lg opacity-80 pointer-events-none z-10" />
                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none z-10" />

                    {/* Specular highlight that follows cursor */}
                    <motion.div
                      aria-hidden="true"
                      className="absolute inset-0 pointer-events-none z-10"
                      style={{ backgroundImage: highlight, opacity: 0.85, mixBlendMode: 'soft-light' as any }}
                    />

                    {/* Border / rim */}
                    <div className="absolute inset-0 rounded-2xl pointer-events-none z-10" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }} />

                    <GoogleLogo />
                    <span className="relative z-20 text-white/90 group-hover:text-white transition-colors">
                      Continue with Google
                    </span>
                  </motion.button>
                ) : state === 'loading' ? (
                  <motion.div
                    key="loading"
                    className="w-full flex items-center justify-center py-[14px]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {/* Animated spinner */}
                    <div className="relative w-6 h-6">
                      <motion.div
                        className="absolute inset-0 border-2 border-white/10 border-t-blue-400 rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                      />
                    </div>
                    <span className="ml-3 text-[14px] text-white/50">Connecting...</span>
                  </motion.div>
                ) : state === 'waiting' ? (
                  <motion.div
                    key="waiting"
                    className="w-full flex flex-col items-center gap-4"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {/* Waiting indicator with breathing animation */}
                    <div className="flex items-center gap-3">
                      <motion.div
                        className="w-2.5 h-2.5 rounded-full bg-blue-400"
                        animate={{
                          scale: [1, 1.3, 1],
                          opacity: [0.6, 1, 0.6],
                          boxShadow: [
                            '0 0 0 0 rgba(59,130,246,0)',
                            '0 0 12px 4px rgba(59,130,246,0.3)',
                            '0 0 0 0 rgba(59,130,246,0)',
                          ],
                        }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <span className="text-[14px] text-white/60">
                        Waiting for Google sign in...
                      </span>
                    </div>

                    <p className="text-[12px] text-white/25 text-center">
                      Complete sign in in your browser, then return here.
                    </p>

                    <button
                      onClick={() => {
                        if (pollRef.current) clearInterval(pollRef.current);
                        setState('idle');
                      }}
                      className="text-[12px] text-white/30 hover:text-white/60 transition-colors mt-2"
                    >
                      Cancel
                    </button>
                  </motion.div>
                ) : state === 'success' ? (
                  <motion.div
                    key="success"
                    className="w-full flex flex-col items-center gap-3"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.1 }}
                    transition={{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
                  >
                    <motion.div
                      className="w-14 h-14 rounded-full flex items-center justify-center"
                      style={{
                        background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))',
                        border: '1px solid rgba(16,185,129,0.2)',
                      }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{
                        type: 'spring',
                        stiffness: 300,
                        damping: 15,
                        delay: 0.2,
                      }}
                    >
                      <motion.svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
                      >
                        <motion.path d="M20 6L9 17L4 12" />
                      </motion.svg>
                    </motion.div>
                    <motion.span
                      className="text-[15px] text-emerald-400 font-medium"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                    >
                      Signed in successfully
                    </motion.span>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>

            {/* Error Message */}
            <AnimatePresence>
              {state === 'error' && errorMessage && (
                <motion.p
                  initial={{ opacity: 0, y: 5, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -5, height: 0 }}
                  className="text-[12px] text-red-400/80 text-center mt-4 max-w-[320px]"
                >
                  {errorMessage}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Footer */}
            <motion.div
              variants={itemVariants}
              className="mt-12 flex flex-col items-center gap-2 px-5 py-3.5 border border-white/[0.08] rounded-2xl w-full max-w-[320px]"
            >
              <p className="text-[11px] text-[#9E9E9E] text-center leading-relaxed">
                By continuing, you agree to TeamSync's Terms of Service and Privacy Policy.
              </p>
            </motion.div>

            {/* Skip for dev */}
            {import.meta.env.DEV && (
              <motion.button
                variants={itemVariants}
                onClick={() => {
                  onSignInComplete({
                    token: 'dev_token',
                    name: 'Developer',
                    email: 'dev@teamsync.app',
                    calendarConnected: false,
                    isNewUser: false,
                  });
                }}
                className="mt-6 text-[11px] text-white/10 hover:text-white/30 transition-colors"
              >
                Skip (dev only)
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GoogleSignIn;
