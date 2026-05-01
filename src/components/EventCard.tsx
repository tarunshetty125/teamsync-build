import React from "react";
import { motion } from "framer-motion";
import { Clock3, ExternalLink, Video } from "lucide-react";
import { NormalizedEvent } from "../utils/filter";
import { formatTimeRange, getEventDuration, getTimeLeft } from "../utils/time";

type EventChangeType = "new" | "updated" | null;

interface EventCardProps {
  event: NormalizedEvent;
  changeType?: EventChangeType;
  isNextUp?: boolean;
  isLight?: boolean;
}

const platformLabel: Record<string, string> = {
  meet: "Meet",
  zoom: "Zoom",
  teams: "Teams",
  other: "Call",
};

const EventCard: React.FC<EventCardProps> = ({ event, changeType = null, isNextUp = false, isLight = false }) => {
  const now = Date.now();
  const startMs = new Date(event.startTime).getTime();
  const endMs = new Date(event.endTime).getTime();
  const isLive = startMs <= now && endMs >= now;
  const minutesToStart = Math.floor((startMs - now) / (1000 * 60));
  const isUrgent = !isLive && minutesToStart >= 0 && minutesToStart < 10;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, transform: "translateY(16px) scale(0.98)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ transform: "translateY(0px) scale(1.02)" }}
      className={[
        "rounded-xl border p-4 transition-colors duration-200 backdrop-blur-xl",
        isLight
          ? "bg-gradient-to-br from-white/95 to-blue-50/65 border-slate-200/80 shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
          : "bg-gradient-to-br from-[#1b1c21]/88 to-[#14161b]/78 border-white/12 shadow-[0_18px_40px_rgba(0,0,0,0.28)]",
        isNextUp ? "ring-1 ring-blue-400/35" : "",
        event.isInterview ? "ring-1 ring-yellow-400/35" : "",
        isLive ? "border-emerald-400/45" : "",
        isUrgent ? "border-red-400/55 animate-pulse" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            {isNextUp && (
              <span className={`text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full ${isLight ? "bg-blue-500/12 text-blue-700" : "bg-blue-500/20 text-blue-300"}`}>
                Next Up
              </span>
            )}
            {event.isInterview && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${isLight ? "bg-yellow-500/14 text-yellow-700" : "bg-yellow-500/20 text-yellow-300"}`}>🎯 Interview</span>
            )}
            {isLive && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${isLight ? "bg-emerald-500/14 text-emerald-700" : "bg-emerald-500/20 text-emerald-300"}`}>LIVE NOW</span>
            )}
            {isUrgent && !isLive && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${isLight ? "bg-red-500/14 text-red-700" : "bg-red-500/20 text-red-300"}`}>Starts in {minutesToStart}m</span>
            )}
            {changeType && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                changeType === "new"
                  ? (isLight ? "bg-indigo-500/14 text-indigo-700" : "bg-indigo-500/20 text-indigo-300")
                  : (isLight ? "bg-amber-500/14 text-amber-700" : "bg-amber-500/20 text-amber-300")
              }`}>
                {changeType === "new" ? "New" : "Updated"}
              </span>
            )}
          </div>

          <h4 className={`text-sm font-semibold truncate ${isLight ? "text-slate-900" : "text-white"}`}>{event.summary}</h4>
          {event.description && (
            <p className={`text-xs mt-1 line-clamp-2 ${isLight ? "text-slate-600" : "text-white/60"}`}>{event.description}</p>
          )}
        </div>

        <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${
          isLight ? "bg-white/80 text-slate-700 border-slate-300/60" : "bg-white/5 text-white/70 border-white/10"
        }`}>
          {platformLabel[event.platform]}
        </span>
      </div>

      <div className={`mt-3 flex flex-wrap items-center gap-3 text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>
        <span className="inline-flex items-center gap-1">
          <Clock3 size={12} />
          {formatTimeRange(event.startTime, event.endTime)}
        </span>
        <span>{getEventDuration(event.startTime, event.endTime)}</span>
        <span className={isLive ? (isLight ? "text-emerald-700" : "text-emerald-300") : isUrgent ? (isLight ? "text-red-700" : "text-red-300") : (isLight ? "text-slate-600" : "text-white/70")}>
          {getTimeLeft(event.startTime)}
        </span>
      </div>

      {event.meetingLink && (
        <a
          href={event.meetingLink}
          target="_blank"
          rel="noreferrer"
          className={`mt-3 inline-flex items-center gap-1.5 text-[11px] transition-colors ${isLight ? "text-blue-700 hover:text-blue-800" : "text-blue-300 hover:text-blue-200"}`}
        >
          <Video size={12} />
          Join link
          <ExternalLink size={11} />
        </a>
      )}
    </motion.div>
  );
};

export default EventCard;
