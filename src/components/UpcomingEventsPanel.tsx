import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getEventsNext8Hours, GoogleCalendarEventLike } from "../utils/filter";
import { formatTimeRange, getEventDuration } from "../utils/time";

interface UpcomingEventsPanelProps {
  events: GoogleCalendarEventLike[];
  syncing?: boolean;
  onRefresh?: () => Promise<void> | void;
  isLight?: boolean;
}

const PLATFORM_LABEL: Record<string, string> = { meet:"MEET", zoom:"ZOOM", teams:"TEAMS", other:"CALL" };

function countdown(startTime: string, endTime: string) {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (now >= start && now <= end) return { h:0, m:0, isLive:true };
  const diff = Math.max(0, start - now);
  const totalMin = Math.floor(diff / 60_000);
  return { h: Math.floor(totalMin / 60), m: totalMin % 60, isLive: false };
}

function progressRatio(startTime: string): number {
  const windowMs = 8 * 60 * 60 * 1000;
  const remaining = new Date(startTime).getTime() - Date.now();
  return Math.min(1, Math.max(0, 1 - remaining / windowMs));
}

function RingIcon({ progress }: { progress: number }) {
  const R = 36, circ = 2 * Math.PI * R;
  const filled = circ * Math.min(progress + 0.12, 0.88);
  const now = new Date();
  const SYS = `-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif`;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88">
      <circle cx="44" cy="44" r={R} fill="rgba(34,197,94,0.07)" stroke="rgba(34,197,94,0.14)" strokeWidth="5"/>
      <circle cx="44" cy="44" r={R} fill="none" stroke="#22c55e" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${filled} ${circ-filled}`} transform="rotate(-90 44 44)"
        style={{filter:"drop-shadow(0 0 5px rgba(34,199,89,0.55))"}}/>
      <text x="44" y="34" textAnchor="middle" fontSize="9" fontWeight="700" letterSpacing="1" fill="#f97316" fontFamily={SYS}>
        {now.toLocaleString("en-US",{month:"short"}).toUpperCase()}
      </text>
      <text x="44" y="51" textAnchor="middle" fontSize="20" fontWeight="700" fill="#ffffff" fontFamily={SYS}>
        {now.getDate()}
      </text>
      <text x="44" y="62" textAnchor="middle" fontSize="8" fontWeight="600" letterSpacing="0.8" fill="rgba(255,255,255,0.4)" fontFamily={SYS}>
        {now.toLocaleString("en-US",{weekday:"short"}).toUpperCase()}
      </text>
    </svg>
  );
}

const G = "#22c55e";
const OUTER_BG = "#0d1117";
const INNER_BG = "#0f1b13";
const BORDER = "rgba(34,197,94,0.14)";
const DIM = "rgba(255,255,255,0.45)";
const SYS = `-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif`;

const UpcomingEventsPanel: React.FC<UpcomingEventsPanelProps> = ({ events, onRefresh }) => {
  const [, tick] = useState(0);
  const [showReminder, setShowReminder] = useState(false);
  const [reminderSet, setReminderSet] = useState<number|null>(null);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // default pos so popover always mounts even if ref hasn't fired getBoundingClientRect yet
  const [reminderPos, setReminderPos] = useState<{x:number;y:number}>({x:16, y:180});
  const reminderBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { const id = setInterval(()=>tick(t=>t+1),30_000); return ()=>clearInterval(id); }, []);
  useEffect(() => { if(!onRefresh)return; const id=setInterval(()=>void onRefresh(),60_000); return ()=>clearInterval(id); },[onRefresh]);
  useEffect(() => {
    if (!showReminder) return;
    const handler = () => setShowReminder(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [showReminder]);

  const filtered = useMemo(() => getEventsNext8Hours(events), [events]);
  const nextUp = filtered[0] ?? null;

  const openLink = (link: string) =>
    window.electronAPI?.openExternal ? window.electronAPI.openExternal(link) : window.open(link,"_blank","noopener,noreferrer");

  const scheduleReminder = (ev: typeof nextUp, min: number) => {
    if (!ev) return;
    const fire = () => {
      try {
        new Notification(`Upcoming: ${ev.summary}`, { body: `Starts in ${min} min` });
      } catch (_) {}
    };
    const delay = new Date(ev.startTime).getTime() - min * 60_000 - Date.now();
    if (delay > 0) {
      if (Notification.permission === "granted") {
        setTimeout(fire, delay);
      } else {
        Notification.requestPermission().then(p => { if (p === "granted") setTimeout(fire, delay); });
      }
    }
    setReminderSet(min);
    setShowReminder(false);
  };

  // Always open the popover immediately — don't gate on permission
  const handleSetReminder = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (reminderBtnRef.current) {
      const r = reminderBtnRef.current.getBoundingClientRect();
      setReminderPos({ x: r.left, y: r.bottom + 8 });
    }
    setShowReminder(prev => !prev);
  };

  const handleCopy = async (link: string) => {
    await navigator.clipboard.writeText(link);
    setCopied(true); setTimeout(()=>setCopied(false), 1800);
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden"
      style={{ background:OUTER_BG, borderRadius:16, border:`1px solid ${BORDER}`, fontFamily:SYS }}>

      {/* HEADER */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="3.5" width="16" height="13" rx="2.5" stroke={G} strokeWidth="1.4"/>
            <path d="M1 7.5h16" stroke={G} strokeWidth="1.4"/>
            <rect x="5" y="1" width="1.4" height="4" rx="0.7" fill={G}/>
            <rect x="11.6" y="1" width="1.4" height="4" rx="0.7" fill={G}/>
          </svg>
          <span style={{fontSize:14,fontWeight:700,color:"#fff",letterSpacing:"-0.02em"}}>Upcoming</span>
          {filtered.length > 0 && (
            <span style={{fontSize:11,fontWeight:700,color:DIM,background:"rgba(255,255,255,0.10)",borderRadius:999,padding:"1px 8px"}}>
              {filtered.length}
            </span>
          )}
        </div>
        <motion.button whileTap={{scale:0.85,rotate:180}} transition={{duration:0.35}}
          onClick={()=>void onRefresh?.()} style={{background:"none",border:"none",cursor:"pointer",padding:4,color:DIM}}>
          <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M16 9A7 7 0 1 1 9 2c2.3 0 4.3 1.1 5.6 2.7"/><path d="M14 2.5l1.6 2.2-2.3 1.3"/>
          </svg>
        </motion.button>
      </div>

      {/* BODY */}
      <div className="flex-1 px-3 pb-3 flex flex-col gap-2 min-h-0 overflow-visible">
        <AnimatePresence mode="wait">
          {nextUp ? (
            <motion.div key={nextUp.id}
              initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
              transition={{duration:0.28,ease:[0.32,0.72,0,1]}}
              className="flex-1 flex flex-col min-h-0 relative"
              style={{background:INNER_BG,borderRadius:12,border:`1px solid ${BORDER}`}}>

              {/* THREE-COLUMN ROW */}
              <div className="flex items-stretch flex-1 min-h-0 px-3 py-3 gap-3">
                {/* LEFT */}
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <RingIcon progress={progressRatio(nextUp.startTime)}/>
                  {(() => {
                    const {isLive} = countdown(nextUp.startTime,nextUp.endTime);
                    return <span style={{fontSize:10,fontWeight:700,color:G,background:"rgba(34,197,94,0.14)",border:`1px solid rgba(34,197,94,0.28)`,borderRadius:999,padding:"3px 10px"}}>{isLive?"Live":"Upcoming"}</span>;
                  })()}
                </div>

                {/* CENTER */}
                <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
                  <div className="flex items-center gap-2">
                    <span style={{fontSize:9,fontWeight:800,letterSpacing:"0.08em",color:G,background:"rgba(34,197,94,0.16)",border:`1px solid rgba(34,197,94,0.3)`,borderRadius:6,padding:"2px 8px"}}>
                      {PLATFORM_LABEL[nextUp.platform]??"CALL"}
                    </span>
                    <span style={{fontSize:11,color:DIM,fontWeight:500}}>
                      {countdown(nextUp.startTime,nextUp.endTime).isLive ? "Live now" : "Next up"}
                    </span>
                    {nextUp.isInterview && (
                      <span style={{fontSize:9,fontWeight:700,color:"#f97316",background:"rgba(249,115,22,0.14)",border:"1px solid rgba(249,115,22,0.28)",borderRadius:6,padding:"2px 7px"}}>Interview</span>
                    )}
                  </div>
                  <p style={{fontSize:17,fontWeight:700,color:"#fff",letterSpacing:"-0.025em",lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nextUp.summary}</p>
                  <div className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="3" width="14" height="11" rx="2" stroke={DIM} strokeWidth="1.2"/>
                      <path d="M1 6h14" stroke={DIM} strokeWidth="1.2"/>
                      <rect x="4.5" y="1" width="1.2" height="3" rx="0.6" fill={DIM}/>
                      <rect x="10.3" y="1" width="1.2" height="3" rx="0.6" fill={DIM}/>
                    </svg>
                    <span style={{fontSize:11,color:DIM,fontWeight:500,fontVariantNumeric:"tabular-nums"}}>{formatTimeRange(nextUp.startTime,nextUp.endTime)}</span>
                  </div>
                </div>

                {/* DIVIDER */}
                <div style={{width:1,background:"rgba(255,255,255,0.07)",flexShrink:0}}/>

                {/* RIGHT */}
                <div className="flex flex-col gap-1.5 shrink-0 items-start justify-center" style={{minWidth:84}}>
                  {(() => {
                    const {h,m,isLive} = countdown(nextUp.startTime,nextUp.endTime);
                    const pr = progressRatio(nextUp.startTime);
                    return (
                      <>
                        <span style={{fontSize:10,color:DIM,fontWeight:500}}>{isLive?"Now":"Starts in"}</span>
                        <span style={{fontSize:22,fontWeight:700,color:G,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums",lineHeight:1,textShadow:"0 0 14px rgba(34,197,94,0.45)"}}>
                          {isLive?"LIVE":h>0?`${h}h ${m}m`:`${m}m`}
                        </span>
                        <div style={{width:80,height:5,borderRadius:99,background:"rgba(34,197,94,0.14)",overflow:"hidden"}}>
                          <motion.div initial={{width:0}} animate={{width:`${Math.round(pr*100)}%`}}
                            transition={{duration:1,ease:[0.32,0.72,0,1]}}
                            style={{height:"100%",borderRadius:99,background:`linear-gradient(90deg,${G},#4ade80)`,boxShadow:"0 0 6px rgba(34,197,94,0.6)"}}/>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* DETAILS OVERLAY — slides up inside the card */}
              <AnimatePresence>
                {showDetails && (
                  <motion.div
                    initial={{y:"100%",opacity:0}} animate={{y:0,opacity:1}} exit={{y:"100%",opacity:0}}
                    transition={{type:"spring",stiffness:380,damping:30}}
                    style={{position:"absolute",inset:0,background:"#0a1510",borderRadius:12,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8,overflowY:"auto",zIndex:10}}>
                    {/* overlay header */}
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                      <span style={{fontSize:12,fontWeight:700,color:"#fff",letterSpacing:"-0.02em"}}>Event Details</span>
                      <motion.button whileTap={{scale:0.9}} onClick={()=>setShowDetails(false)}
                        style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:999,width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:DIM,fontSize:11}}>✕</motion.button>
                    </div>

                    {/* Title */}
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase"}}>Title</span>
                      <span style={{fontSize:13,fontWeight:600,color:"#fff",lineHeight:1.3}}>{nextUp.summary}</span>
                    </div>

                    {/* Row: platform + duration + interview */}
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontSize:9,fontWeight:800,letterSpacing:"0.07em",color:G,background:"rgba(34,197,94,0.14)",border:`1px solid rgba(34,197,94,0.28)`,borderRadius:6,padding:"2px 8px"}}>
                        {PLATFORM_LABEL[nextUp.platform]??"CALL"}
                      </span>
                      <span style={{fontSize:10,color:DIM,fontWeight:500}}>· {getEventDuration(nextUp.startTime,nextUp.endTime)}</span>
                      {nextUp.isInterview && (
                        <span style={{fontSize:9,fontWeight:700,color:"#f97316",background:"rgba(249,115,22,0.14)",border:"1px solid rgba(249,115,22,0.3)",borderRadius:6,padding:"2px 7px"}}>Interview</span>
                      )}
                    </div>

                    {/* Time */}
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase"}}>Time</span>
                      <span style={{fontSize:11,color:DIM,fontVariantNumeric:"tabular-nums"}}>{formatTimeRange(nextUp.startTime,nextUp.endTime)}</span>
                    </div>

                    {/* Description */}
                    {nextUp.description && (
                      <div style={{display:"flex",flexDirection:"column",gap:2}}>
                        <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase"}}>Description</span>
                        <p style={{fontSize:11,color:"rgba(255,255,255,0.6)",lineHeight:1.5,margin:0,display:"-webkit-box",WebkitLineClamp:4,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
                          {nextUp.description}
                        </p>
                      </div>
                    )}

                    {/* Meeting link */}
                    {nextUp.meetingLink && (
                      <div style={{display:"flex",flexDirection:"column",gap:4}}>
                        <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase"}}>Meeting Link</span>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:10,color:G,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,opacity:0.8}}>
                            {nextUp.meetingLink.replace(/^https?:\/\//,"")}
                          </span>
                          <div style={{display:"flex",gap:4,flexShrink:0}}>
                            <motion.button whileTap={{scale:0.9}} onClick={()=>handleCopy(nextUp.meetingLink!)}
                              style={{background:copied?"rgba(34,197,94,0.18)":"rgba(255,255,255,0.08)",border:`1px solid ${copied?"rgba(34,197,94,0.3)":"rgba(255,255,255,0.1)"}`,borderRadius:999,padding:"3px 8px",cursor:"pointer",color:copied?G:DIM,fontSize:10,fontWeight:600}}>
                              {copied?"✓ Copied":"Copy"}
                            </motion.button>
                            <motion.button whileTap={{scale:0.9}} onClick={()=>openLink(nextUp.meetingLink!)}
                              style={{background:"rgba(34,197,94,0.14)",border:"1px solid rgba(34,197,94,0.28)",borderRadius:999,padding:"3px 8px",cursor:"pointer",color:G,fontSize:10,fontWeight:700}}>
                              Open ↗
                            </motion.button>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* BOTTOM ACTION BAR */}
              <div className="relative flex items-center justify-between px-3 py-2 shrink-0"
                style={{borderTop:`1px solid rgba(34,197,94,0.10)`}}>

                {/* SET REMINDER — popover goes UP via absolute */}
                <div className="relative" onClick={e=>e.stopPropagation()}>
                  <motion.button ref={reminderBtnRef} whileTap={{scale:0.94}}
                    transition={{type:"spring",stiffness:400,damping:20}}
                    onClick={handleSetReminder}
                    style={{display:"flex",alignItems:"center",gap:6,background:reminderSet?"rgba(34,197,94,0.14)":"rgba(255,255,255,0.06)",border:`1px solid ${reminderSet?"rgba(34,197,94,0.3)":"rgba(255,255,255,0.1)"}`,borderRadius:999,padding:"4px 10px",cursor:"pointer",color:reminderSet?G:DIM,fontSize:10,fontWeight:600,transition:"all 0.2s ease"}}>
                    {reminderSet ? (
                      <><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke={G} strokeWidth="2" strokeLinecap="round"><path d="M2 7l3.5 3.5L12 3"/></svg>{reminderSet}m before</>
                    ) : (
                      <><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M8 2a5 5 0 0 1 5 5v2.5l1 2H2l1-2V7a5 5 0 0 1 5-5z"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0"/></svg>Set reminder</>
                    )}
                  </motion.button>

                  {/* Popover anchored above the button */}
                  <AnimatePresence>
                    {showReminder && (
                      <motion.div
                        initial={{opacity:0,y:8,scale:0.95,filter:"blur(4px)"}}
                        animate={{opacity:1,y:0,scale:1,filter:"blur(0px)"}}
                        exit={{opacity:0,y:6,scale:0.97,filter:"blur(4px)"}}
                        transition={{type:"spring",stiffness:420,damping:26}}
                        onClick={e=>e.stopPropagation()}
                        style={{position:"absolute",bottom:"calc(100% + 8px)",left:0,background:"#111c15",border:"1px solid rgba(34,197,94,0.22)",borderRadius:14,padding:"6px",display:"flex",flexDirection:"column",gap:2,minWidth:155,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",backdropFilter:"blur(20px)",zIndex:50}}>
                        <p style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:"rgba(255,255,255,0.3)",padding:"2px 8px 4px",textTransform:"uppercase",margin:0}}>Remind me</p>
                        {[5,10,15,30].map(min => (
                          <motion.button key={min} whileHover={{background:"rgba(34,197,94,0.14)"}} whileTap={{scale:0.97}}
                            onClick={()=>nextUp&&scheduleReminder(nextUp,min)}
                            style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",borderRadius:8,color:"#fff",fontSize:11,fontWeight:500,gap:16}}>
                            <span>{min} min before</span>
                            {reminderSet===min && <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke={G} strokeWidth="2.2" strokeLinecap="round"><path d="M2 7l3.5 3.5L12 3"/></svg>}
                          </motion.button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* VIEW DETAILS + JOIN */}
                <div className="flex items-center gap-1.5">
                  {nextUp.meetingLink && (
                    <motion.button whileTap={{scale:0.9}} onClick={()=>handleCopy(nextUp.meetingLink!)}
                      style={{background:copied?"rgba(34,197,94,0.18)":"rgba(255,255,255,0.07)",border:`1px solid ${copied?"rgba(34,197,94,0.3)":"rgba(255,255,255,0.1)"}`,borderRadius:999,padding:"4px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:copied?G:DIM,fontSize:10,fontWeight:600,transition:"all 0.2s ease"}}>
                      {copied ? <><svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M2 7l3.5 3.5L12 3"/></svg>Copied!</> : <>
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M11 5V3a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></svg>Copy</>}
                    </motion.button>
                  )}
                  <motion.button whileTap={{scale:0.94}}
                    transition={{type:"spring",stiffness:400,damping:22}}
                    onClick={()=>setShowDetails(v=>!v)}
                    style={{background:showDetails?"rgba(34,197,94,0.18)":"rgba(255,255,255,0.07)",border:`1px solid ${showDetails?"rgba(34,197,94,0.3)":"rgba(255,255,255,0.1)"}`,borderRadius:999,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:showDetails?G:DIM,fontSize:10,fontWeight:600}}>
                    Details
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={showDetails?"M3 10l5-5 5 5":"M3 6l5 5 5-5"}/>
                    </svg>
                  </motion.button>
                  {nextUp.meetingLink && (
                    <motion.button whileTap={{scale:0.95}} transition={{type:"spring",stiffness:400,damping:22}}
                      onClick={()=>openLink(nextUp.meetingLink!)}
                      style={{background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:999,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:G,fontSize:10,fontWeight:700}}>
                      Join →
                    </motion.button>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="flex-1 flex flex-col items-center justify-center gap-2">
              <div style={{width:40,height:40,borderRadius:12,background:"rgba(34,197,94,0.07)",border:`1px solid ${BORDER}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={G} strokeWidth="1.3" strokeLinecap="round">
                  <rect x="1" y="3.5" width="16" height="13" rx="2.5"/><path d="M1 7.5h16"/>
                </svg>
              </div>
              <p style={{fontSize:11,color:DIM,textAlign:"center"}}>No events in the next 8 hours</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default UpcomingEventsPanel;
