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
  const meetingLink = event.meetingLink;

  const handleOpenMeetingLink = async (link: string) => {
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(link);
      return;
    }

    window.open(link, "_blank", "noopener,noreferrer");
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, transform: "translateY(16px) scale(0.98)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ transform: "translateY(0px) scale(1.02)" }}
      className={[
        "relative group isolate w-full self-stretch overflow-hidden rounded-2xl p-5 transition-all duration-300 ease-out backdrop-blur-2xl",
        isLight
          ? "bg-white/55 border border-white/45 shadow-[0_12px_38px_rgba(15,23,42,0.12)] hover:shadow-[0_18px_52px_rgba(15,23,42,0.16)]"
          : "bg-slate-950/40 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] hover:shadow-[0_14px_48px_rgba(0,0,0,0.48)]",
        "hover:scale-[1.02]",
        isNextUp ? "ring-1 ring-blue-400/20" : "",
        event.isInterview ? "border-blue-500/30 shadow-[0_18px_45px_rgba(59,130,246,0.18)]" : "",
        isLive ? "border-emerald-400/30" : "",
        isUrgent ? "border-red-400/40" : "",
      ].join(" ")}
    >
      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
        <div className="absolute w-[200%] h-[200%] -top-1/2 -left-1/2 animate-glow-move bg-gradient-to-r from-blue-400/20 via-emerald-400/20 to-purple-400/20 blur-3xl opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 via-emerald-400/10 to-transparent blur-2xl animate-breath" />
      </div>
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-blue-500/10 via-white/5 to-purple-500/10" />
      <div className="absolute inset-0 rounded-2xl pointer-events-none border border-white/10" />
      <div className="absolute inset-0 rounded-2xl pointer-events-none bg-gradient-to-r from-blue-500/20 to-purple-500/20 blur-xl opacity-30" />

      <div className="relative z-10 w-full">
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            {isNextUp && (
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-widest backdrop-blur-md ${isLight ? "bg-blue-500/10 border-blue-500/20 text-blue-700" : "bg-blue-500/10 border-blue-500/20 text-blue-300"}`}>
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
          isLight ? "bg-white/55 text-slate-700 border-white/60 backdrop-blur-md shadow-[0_2px_12px_rgba(15,23,42,0.08)]" : "bg-white/10 text-white/80 border-white/20 backdrop-blur-md shadow-[0_2px_16px_rgba(0,0,0,0.18)]"
        }`}>
          {platformLabel[event.platform]}
        </span>
      </div>

      <div className={`mt-3 flex w-full flex-wrap items-center gap-3 text-[11px] ${isLight ? "text-slate-700" : "text-white/72"}`}>
        <span className="inline-flex items-center gap-1">
          <Clock3 size={12} />
          {formatTimeRange(event.startTime, event.endTime)}
        </span>
        <span>{getEventDuration(event.startTime, event.endTime)}</span>
        <span className={isLive ? (isLight ? "text-emerald-700" : "text-emerald-300") : isUrgent ? (isLight ? "text-red-700" : "text-red-300") : (isLight ? "text-slate-600" : "text-white/70")}>
          {getTimeLeft(event.startTime)}
        </span>
      </div>

      {meetingLink && (
        <button
          type="button"
          onClick={() => void handleOpenMeetingLink(meetingLink)}
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] backdrop-blur-md transition-all duration-300 ${isLight ? "bg-white/55 border-white/60 text-blue-700 hover:bg-white/70 hover:border-white/80" : "bg-white/10 border-white/15 text-blue-300 hover:bg-white/15 hover:border-white/25"}`}
        >
          <Video size={12} />
          Join link
          <ExternalLink size={11} />
        </button>
      )}
      </div>
    </motion.div>
  );
};

export default EventCard;
