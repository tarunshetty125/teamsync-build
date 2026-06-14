// src/components/trial/FreeTrialModal.tsx
//
// Skills: ui-ux-pro-max · canvas-designer · frontend-design · ui-design-system
//
// Post-trial license panel — Apple-grade dark glass card language.
// Keeps the trial cleanup path visible while directing paid access to
// administrator-issued license keys.

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Key, ArrowRight, Loader2, CheckCircle, ShieldCheck } from 'lucide-react';
import { TeamSyncLogoMark } from '../TeamSyncLogoMark';

const F = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

// Apple easing curve
const EASE = 'cubic-bezier(0.4,0,0.2,1)';

// 5 opacity stops — the only contrast control we touch
const C = {
  t1:  '#FFFFFF',
  t2:  'rgba(255,255,255,0.76)',
  t3:  'rgba(255,255,255,0.46)',
  t4:  'rgba(255,255,255,0.28)',
  t5:  'rgba(255,255,255,0.14)',
  div: 'rgba(255,255,255,0.08)',
  glass: 'rgba(255,255,255,0.04)',
};

// ─────────────────────────────────────────────────────────────

interface TrialModalProps {
  usage:      { ai: number; stt_seconds: number; search: number };
  onByok:     () => Promise<void>;
  onDone?:    () => void;
}

type Step = 'choose' | 'wiping' | 'done';

export const FreeTrialModal: React.FC<TrialModalProps> = ({ usage, onByok, onDone }) => {
  const [step,  setStep]  = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion() ?? false;

  const handleByok = async () => {
    setStep('wiping');
    setError(null);
    try   { await onByok(); setStep('done'); }
    catch (e: any) { setError(e.message || 'Something went wrong. Restart the app.'); setStep('choose'); }
  };

  return (
    <>
      <style>{`
        @keyframes fm-border {
          0%,100% { background-position:0% 50%; }
          50%      { background-position:100% 50%; }
        }
        .fm-ring {
          background: linear-gradient(145deg,rgba(139,92,246,.7),rgba(99,102,241,.52),rgba(139,92,246,.7));
          background-size:300% 300%;
          animation:fm-border 7s ease infinite;
        }
        .fm-ring-r { background:linear-gradient(145deg,rgba(139,92,246,.55),rgba(99,102,241,.4)); }
      `}</style>

      {/* Backdrop */}
      <div style={{
        position:'fixed', inset:0, zIndex:9999,
        display:'flex', alignItems:'center', justifyContent:'center',
        background:'radial-gradient(ellipse 80% 70% at 50% 50%,rgba(139,92,246,.07) 0%,rgba(0,0,0,.9) 100%)',
        backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
        fontFamily: F,
      } as React.CSSProperties}>

        {/* Iridescent ring */}
        <motion.div
          initial={reduced ? {opacity:0} : {opacity:0,scale:.95,y:20,filter:'blur(8px)'}}
          animate={reduced ? {opacity:1} : {opacity:1,scale:1,  y:0, filter:'blur(0px)'}}
          transition={{type:'spring',stiffness:280,damping:24,mass:.85}}
          className={reduced ? 'fm-ring-r' : 'fm-ring'}
          style={{padding:'1.5px',borderRadius:'24px',boxShadow:'0 56px 130px -24px rgba(0,0,0,.98),0 0 80px rgba(139,92,246,.05)'}}
        >
          {/* Card shell */}
          <div style={{
            position:'relative', width:'468px',
            borderRadius:'23px',
            background:'linear-gradient(158deg,rgba(12,9,22,.99) 0%,rgba(7,5,13,1) 100%)',
          }}>
            {/* Catch-light */}
            <div aria-hidden style={{position:'absolute',top:0,left:0,right:0,height:'1px',background:'rgba(255,255,255,.12)',pointerEvents:'none',zIndex:5}} />
            {/* Aurora pulse */}
            {!reduced && (
              <motion.div aria-hidden
                animate={{opacity:[.07,.16,.07]}}
                transition={{duration:7,repeat:Infinity,ease:'easeInOut'}}
                style={{position:'absolute',top:'-80px',left:'50%',transform:'translateX(-50%)',width:'440px',height:'280px',background:'radial-gradient(ellipse,rgba(139,92,246,.28) 0%,transparent 65%)',pointerEvents:'none',zIndex:1}}
              />
            )}
            {/* Grain */}
            <div aria-hidden style={{
              position:'absolute',inset:0,borderRadius:'23px',pointerEvents:'none',zIndex:4,
              opacity:.026,mixBlendMode:'overlay',
              backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize:'180px',
            }} />

            <div style={{padding:'22px 22px 24px',position:'relative',zIndex:6}}>
              {step==='wiping' && <WipingState />}
              {step==='done'   && <DoneState onDone={onDone} />}
              {step==='choose' && (
                <ChooseState
                  usage={usage} error={error}
                  onByok={handleByok}
                />
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

// ─── Choose ──────────────────────────────────────────────────

function ChooseState({ usage, error, onByok }: {
  usage: {ai:number;stt_seconds:number;search:number};
  error: string|null;
  onByok:()=>void;
}) {
  const sttMin = (usage.stt_seconds/60).toFixed(1);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>

      {/* ── Header ─── */}
      <div style={{display:'flex',alignItems:'center',gap:'10px',paddingBottom:'12px',borderBottom:`1px solid ${C.div}`}}>
        <div style={{width:'34px',height:'34px',borderRadius:'10px',background:'rgba(139,92,246,.13)',border:'1px solid rgba(139,92,246,.22)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <TeamSyncLogoMark size={16} className="text-violet-400" />
        </div>
        <div>
          <div style={{fontSize:'14px',fontWeight:650,color:C.t1,letterSpacing:'-.02em',lineHeight:1.2}}>Keep the momentum going</div>
          <div style={{fontSize:'11.5px',color:C.t4,marginTop:'2px'}}>
            {usage.ai} AI · {sttMin} min · {usage.search} searches used in your trial
          </div>
        </div>
      </div>

      <div style={{
        display:'flex', gap:'12px', alignItems:'flex-start',
        padding:'14px', borderRadius:'14px',
        border:`1px solid rgba(139,92,246,0.2)`,
        background:'rgba(139,92,246,0.06)',
      }}>
        <div style={{
          width:'32px',height:'32px',borderRadius:'9px',flexShrink:0,
          background:'rgba(139,92,246,0.13)',
          border:'1px solid rgba(139,92,246,0.22)',
          display:'flex',alignItems:'center',justifyContent:'center',
        }}>
          <ShieldCheck size={14} strokeWidth={1.8} color="#A78BFA" />
        </div>
        <div>
          <div style={{fontSize:'13px',fontWeight:640,color:C.t1,letterSpacing:'-.015em',lineHeight:1.35}}>
            Licensing available through administrator-issued license keys.
          </div>
          <div style={{fontSize:'11px',color:C.t3,marginTop:'5px',lineHeight:1.55}}>
            Enter your issued key in Settings, or use your own API keys after ending trial mode.
          </div>
        </div>
      </div>

      <ByokRow onClick={onByok} />

      {error && <p style={{fontSize:'11px',color:'rgba(248,113,113,.85)',textAlign:'center',margin:0}}>{error}</p>}
    </div>
  );
}

// ─── BYOK row ─────────────────────────────────────────────────

function ByokRow({ onClick }: { onClick:()=>void }) {
  const [hov, setHov] = useState(false);
  const reduced = useReducedMotion() ?? false;
  return (
    <div style={{borderTop:`1px solid ${C.div}`,paddingTop:'8px'}}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          width:'100%', display:'flex', alignItems:'center', gap:'10px',
          padding:'9px 12px', borderRadius:'10px',
          border:`1px solid ${hov ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}`,
          cursor:'pointer',
          background: hov ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
          transform: hov && !reduced ? 'translateY(-1px)' : 'translateY(0)',
          transition:`background 180ms ${EASE}, border-color 180ms ${EASE}, transform 180ms ${EASE}`,
          textAlign:'left', fontFamily:F,
        }}
      >
        <div style={{
          width:'26px',height:'26px',borderRadius:'7px',flexShrink:0,
          background: hov ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.06)',
          border:`1px solid ${hov ? 'rgba(255,255,255,0.15)' : C.div}`,
          display:'flex',alignItems:'center',justifyContent:'center',
          transition:`background 180ms ${EASE}, border-color 180ms ${EASE}`,
        }}>
          <Key size={11} strokeWidth={1.75} color={hov ? C.t2 : C.t3} />
        </div>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:'7px'}}>
            <span style={{fontSize:'12px',fontWeight:580,color:hov ? C.t1 : C.t2,transition:`color 180ms ${EASE}`}}>
              Use my own API keys
            </span>
            <span style={{fontSize:'7.5px',fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:C.t4,border:`1px solid rgba(255,255,255,0.12)`,padding:'1.5px 4px',borderRadius:'3px'}}>free</span>
          </div>
          <div style={{fontSize:'10.5px',color:C.t4,marginTop:'1px'}}>
            Quietly API disabled · No Pro features
          </div>
        </div>
        <ArrowRight size={11} strokeWidth={2} color={hov ? C.t2 : C.t3} style={{flexShrink:0,transition:`color 180ms ${EASE}`}} />
      </button>
    </div>
  );
}

// ─── Intermediate states ──────────────────────────────────────

function WipingState() {
  return (
    <div style={{padding:'52px 28px',display:'flex',flexDirection:'column',alignItems:'center',gap:'18px',textAlign:'center'}}>
      <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:'linear'}}>
        <Loader2 size={24} strokeWidth={1.5} color={C.t4} />
      </motion.div>
      <div>
        <div style={{fontSize:'14px',fontWeight:560,color:C.t2,marginBottom:'6px',fontFamily:F}}>Cleaning up trial data…</div>
        <div style={{fontSize:'12px',color:C.t4,lineHeight:1.6,fontFamily:F}}>Wiping cached company research and Pro data.</div>
      </div>
    </div>
  );
}

function DoneState({ onDone }: { onDone?:()=>void }) {
  return (
    <div style={{padding:'52px 28px',display:'flex',flexDirection:'column',alignItems:'center',gap:'18px',textAlign:'center'}}>
      <div style={{width:'52px',height:'52px',borderRadius:'50%',background:'rgba(52,211,153,.1)',border:'1px solid rgba(52,211,153,.2)',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <CheckCircle size={22} strokeWidth={1.5} color="#34D399" />
      </div>
      <div>
        <div style={{fontSize:'15px',fontWeight:600,color:C.t1,marginBottom:'6px',fontFamily:F}}>All set.</div>
        <div style={{fontSize:'12.5px',color:C.t3,lineHeight:1.65,maxWidth:'240px',margin:'0 auto',fontFamily:F}}>
          Trial data wiped. Add your API keys in Settings → AI Providers to get started.
        </div>
      </div>
      {onDone && (
        <button
          onClick={onDone}
          style={{
            padding:'9px 24px', borderRadius:'10px', border:`1px solid ${C.div}`, cursor:'pointer',
            background:'rgba(255,255,255,.06)', fontSize:'12.5px', fontWeight:560,
            color:C.t3, fontFamily:F, transition:'background 150ms,color 150ms',
          }}
          onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,.1)';e.currentTarget.style.color=C.t2;}}
          onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.06)';e.currentTarget.style.color=C.t3;}}
        >
          Continue →
        </button>
      )}
    </div>
  );
}
