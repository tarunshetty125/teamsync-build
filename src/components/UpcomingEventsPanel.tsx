import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, RefreshCw } from "lucide-react";
import EventCard from "./EventCard";
import { getEventsNext8Hours, GoogleCalendarEventLike } from "../utils/filter";
import { GlassCard } from "./ui/GlassCard";

type EventChangeType = "new" | "updated" | null;

interface UpcomingEventsPanelProps {
  events: GoogleCalendarEventLike[];
  syncing?: boolean;
  onRefresh?: () => Promise<void> | void;
  isLight?: boolean;
}

const UpcomingEventsPanel: React.FC<UpcomingEventsPanelProps> = ({ events, syncing = false, onRefresh, isLight = false }) => {
  const [isPolling, setIsPolling] = useState(false);
  const [changeMap, setChangeMap] = useState<Record<string, EventChangeType>>({});
  const previousSnapshotRef = useRef<Map<string, string>>(new Map());

  const filtered = useMemo(() => getEventsNext8Hours(events), [events]);
  const nextUp = filtered[0] || null;

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
      initial={{ opacity: 0, transform: "translateY(20px) scale(0.98)", filter: "blur(6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)", filter: "blur(0px)" }}
      transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
      className="h-auto w-full"
    >
      <GlassCard className="w-full flex flex-col items-stretch bg-white/10 border-white/20 p-0">
        <div className="px-4 pt-4 pb-2 shrink-0">
          <div className="flex items-center justify-between">
            <h3 className={`text-xs font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Next Up</h3>
            <div className="flex items-center gap-2">
              {(syncing || isPolling) && <Loader2 size={14} className="animate-spin text-blue-300" />}
              <button
                onClick={() => onRefresh?.()}
                className={`p-1.5 rounded-md transition-colors ${
                  isLight ? "bg-white/80 hover:bg-white text-slate-700" : "bg-white/10 hover:bg-white/20 text-white/90"
                }`}
                title="Refresh events"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="w-full pb-4">
          {nextUp ? (
            <EventCard event={nextUp} isNextUp isLight={isLight} changeType={changeMap[nextUp.id] || null} />
          ) : (
            <div
              className={`w-full rounded-xl px-4 py-8 text-center text-sm ${
                isLight ? "border border-slate-200/80 bg-white/75 text-slate-500" : "border border-white/20 bg-white/10 text-white/80"
              }`}
            >
              No upcoming events in the next 8 hours.
            </div>
          )}
        </div>
      </GlassCard>
    </motion.div>
  );
};

export default UpcomingEventsPanel;
