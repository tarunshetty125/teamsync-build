import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, RefreshCw } from "lucide-react";
import { Clock3, ExternalLink, Video } from "lucide-react";
import { getEventsNext8Hours, GoogleCalendarEventLike } from "../utils/filter";
import { formatTimeRange, getEventDuration, getTimeLeft } from "../utils/time";

type EventChangeType = "new" | "updated" | null;

interface UpcomingEventsPanelProps {
  events: GoogleCalendarEventLike[];
  syncing?: boolean;
  onRefresh?: () => Promise<void> | void;
  isLight?: boolean;
}

const UpcomingEventsPanel: React.FC<UpcomingEventsPanelProps> = ({
  events,
  syncing = false,
  onRefresh,
  isLight = false,
}) => {
  const [isPolling, setIsPolling] = useState(false);
  const [changeMap, setChangeMap] = useState<Record<string, EventChangeType>>(
    {},
  );
  const previousSnapshotRef = useRef<Map<string, string>>(new Map());

  const filtered = useMemo(() => getEventsNext8Hours(events), [events]);
  const nextUp = filtered[0] || null;
  const upcomingCount = filtered.length;
  const now = Date.now();

  const handleOpenMeetingLink = async (link: string) => {
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(link);
      return;
    }

    window.open(link, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    const nextSnapshot = new Map<string, string>();
    const nextChanges: Record<string, EventChangeType> = {};

    filtered.forEach((event) => {
      const signature = JSON.stringify({
        summary: event.summary,
        description: event.description || "",
        start: event.startTime,
        end: event.endTime,
        link: event.meetingLink || "",
      });
      nextSnapshot.set(event.id, signature);
      const prev = previousSnapshotRef.current.get(event.id);
      if (!prev) nextChanges[event.id] = "new";
      else if (prev !== signature) nextChanges[event.id] = "updated";
      else nextChanges[event.id] = null;
    });

    previousSnapshotRef.current = nextSnapshot;
    setChangeMap(nextChanges);
  }, [filtered]);

  useEffect(() => {
    if (!onRefresh) return;
    const interval = setInterval(async () => {
      setIsPolling(true);
      try {
        await onRefresh();
      } finally {
        setIsPolling(false);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [onRefresh]);

  return (
    <motion.div
      initial={{
        opacity: 0,
        transform: "translateY(20px) scale(0.98)",
        filter: "blur(6px)",
      }}
      animate={{
        opacity: 1,
        transform: "translateY(0px) scale(1)",
        filter: "blur(0px)",
      }}
      transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
      className="h-auto w-full"
    >
      <div className={`relative w-full flex flex-col items-stretch overflow-hidden rounded-[28px] border ${isLight ? "border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-white/50" : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.74),rgba(2,6,23,0.56))] shadow-[0_24px_84px_rgba(0,0,0,0.46)] ring-1 ring-white/5"}`}>
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          animate={{ opacity: [0.45, 0.82, 0.55], scale: [1, 1.02, 1] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
          style={{
            background: isLight
              ? "radial-gradient(circle at 14% 0%, rgba(34,197,94,0.18), transparent 26%), radial-gradient(circle at 84% 18%, rgba(99,102,241,0.10), transparent 24%), radial-gradient(circle at 50% 100%, rgba(14,165,233,0.08), transparent 34%), linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0))"
              : "radial-gradient(circle at 14% 0%, rgba(34,197,94,0.16), transparent 26%), radial-gradient(circle at 84% 18%, rgba(168,85,247,0.12), transparent 24%), radial-gradient(circle at 50% 100%, rgba(16,185,129,0.12), transparent 34%), linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0))",
          }}
        />
        <div className={`relative px-4 pt-4 pb-3 shrink-0 border-b ${isLight ? "border-slate-200/80 bg-white/30" : "border-white/10 bg-white/[0.02]"}`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-xs font-semibold tracking-[0.02em] ${isLight ? "text-slate-900" : "text-white"}`}>
              Next Up
            </h3>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border backdrop-blur-md ${isLight ? "bg-white/80 text-slate-600 border-slate-200 shadow-[0_2px_12px_rgba(15,23,42,0.06)]" : "bg-white/10 text-white/80 border-white/10"}`}
                title="Upcoming meetings in the next 8 hours"
              >
                Upcoming meetings: {upcomingCount}
              </span>
              {(syncing || isPolling) && <Loader2 size={14} className="animate-spin text-blue-300" />}
              <button
                onClick={() => onRefresh?.()}
                className={`p-1.5 rounded-md transition-all duration-300 ${isLight ? "bg-white/80 hover:bg-white text-slate-700 hover:shadow-[0_2px_10px_rgba(15,23,42,0.08)]" : "bg-white/10 hover:bg-white/20 text-white/90"}`}
                title="Refresh events"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="relative w-full p-4">
          {nextUp ? (
            <div className={`relative w-full rounded-[22px] p-5 overflow-hidden ${isLight ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.86))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" : "bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.035))] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"}`}>
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                animate={{ opacity: [0.45, 0.7, 0.5], x: [0, 8, 0] }}
                transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  background: isLight
                    ? "radial-gradient(circle at 18% 18%, rgba(34,197,94,0.14), transparent 30%), radial-gradient(circle at 84% 28%, rgba(129,140,248,0.10), transparent 26%), linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0))"
                    : "radial-gradient(circle at 18% 18%, rgba(34,197,94,0.14), transparent 30%), radial-gradient(circle at 84% 28%, rgba(168,85,247,0.10), transparent 26%), linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0))",
                }}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/12 via-transparent to-violet-500/10 opacity-80" />
              <div className="relative flex w-full items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    {nextUp.isInterview && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${isLight ? "bg-yellow-500/14 text-yellow-700" : "bg-yellow-500/20 text-yellow-300"}`}>🎯 Interview</span>
                    )}
                    {now >= new Date(nextUp.startTime).getTime() && now <= new Date(nextUp.endTime).getTime() && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${isLight ? "bg-emerald-500/16 text-emerald-800" : "bg-emerald-500/20 text-emerald-300"}`}>LIVE NOW</span>
                    )}
                    {changeMap[nextUp.id] && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${changeMap[nextUp.id] === "new" ? (isLight ? "bg-indigo-500/14 text-indigo-700" : "bg-indigo-500/20 text-indigo-300") : (isLight ? "bg-amber-500/14 text-amber-700" : "bg-amber-500/20 text-amber-300")}`}>
                        {changeMap[nextUp.id] === "new" ? "New" : "Updated"}
                      </span>
                    )}
                  </div>

                  <h4 className={`text-sm font-semibold truncate tracking-[-0.02em] ${isLight ? "text-slate-900" : "text-white"}`}>{nextUp.summary}</h4>
                  {nextUp.description && (
                    <p className={`text-xs mt-1 line-clamp-2 leading-relaxed ${isLight ? "text-slate-600" : "text-white/65"}`}>{nextUp.description}</p>
                  )}
                </div>

                <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 backdrop-blur-md ${isLight ? "bg-white/82 text-slate-700 border-slate-200/90 shadow-[0_2px_10px_rgba(15,23,42,0.05)]" : "bg-white/10 text-white/80 border-white/20 shadow-[0_2px_16px_rgba(0,0,0,0.18)]"}`}>
                  {nextUp.platform === "meet" ? "Meet" : nextUp.platform === "zoom" ? "Zoom" : nextUp.platform === "teams" ? "Teams" : "Call"}
                </span>
              </div>

              <div className={`mt-3 flex w-full flex-wrap items-center gap-3 text-[11px] ${isLight ? "text-slate-700" : "text-white/72"}`}>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={12} />
                  {formatTimeRange(nextUp.startTime, nextUp.endTime)}
                </span>
                <span className={`px-2 py-0.5 rounded-full border backdrop-blur-md ${isLight ? "bg-white/82 border-slate-200/80 shadow-[0_2px_8px_rgba(15,23,42,0.05)]" : "bg-white/5 border-white/10"}`}>{getEventDuration(nextUp.startTime, nextUp.endTime)}</span>
                <span className={now >= new Date(nextUp.startTime).getTime() && now <= new Date(nextUp.endTime).getTime() ? (isLight ? "text-emerald-700" : "text-emerald-300") : (isLight ? "text-slate-600" : "text-white/70")}>{getTimeLeft(nextUp.startTime)}</span>
              </div>

              {nextUp.meetingLink && (
                <button
                  type="button"
                  onClick={() => void handleOpenMeetingLink(nextUp.meetingLink!)}
                  className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] backdrop-blur-md transition-all duration-300 ${isLight ? "bg-white/82 border-emerald-200/70 text-emerald-700 hover:bg-white hover:border-emerald-300 shadow-[0_2px_12px_rgba(15,23,42,0.06)]" : "bg-emerald-500/10 border-emerald-400/20 text-emerald-300 hover:bg-emerald-500/15 hover:border-emerald-300/25"}`}
                >
                  <Video size={12} />
                  Join link
                  <ExternalLink size={11} />
                </button>
              )}
            </div>
          ) : (
            <div className={`w-full rounded-xl px-4 py-8 text-center text-sm ${isLight ? "border border-slate-200/80 bg-white/75 text-slate-500" : "border border-white/20 bg-white/10 text-white/80"}`}>
              No upcoming events in the next 8 hours.
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default UpcomingEventsPanel;
