export type GoogleCalendarEventLike = {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string } | { date?: string };
  end?: { dateTime?: string } | { date?: string };
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ uri?: string }>;
  };
  // Existing app shape fallback
  title?: string;
  startTime?: string;
  endTime?: string;
  link?: string;
};

export type PlatformType = "meet" | "zoom" | "teams" | "other";

export type NormalizedEvent = {
  id: string;
  summary: string;
  description?: string;
  startTime: string;
  endTime: string;
  meetingLink?: string;
  platform: PlatformType;
  isInterview: boolean;
};

export function isInterviewEvent(title: string): boolean {
  const text = title.toLowerCase();
  return ["interview", "round", "hr", "technical"].some((keyword) => text.includes(keyword));
}

export function detectPlatform(link?: string): PlatformType {
  if (!link) return "other";
  const lower = link.toLowerCase();
  if (lower.includes("meet.google.com") || lower.includes("hangouts")) return "meet";
  if (lower.includes("zoom.us")) return "zoom";
  if (lower.includes("teams.microsoft.com")) return "teams";
  return "other";
}

function getMeetingLink(event: GoogleCalendarEventLike): string | undefined {
  return event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || event.link;
}

export function normalizeCalendarEvent(event: GoogleCalendarEventLike): NormalizedEvent | null {
  const startTime = (event.start && "dateTime" in event.start ? event.start.dateTime : undefined) || event.startTime;
  const endTime = (event.end && "dateTime" in event.end ? event.end.dateTime : undefined) || event.endTime;
  if (!startTime || !endTime) return null;

  const summary = (event.summary || event.title || "Untitled event").trim();
  const meetingLink = getMeetingLink(event);

  return {
    id: event.id,
    summary,
    description: event.description,
    startTime,
    endTime,
    meetingLink,
    platform: detectPlatform(meetingLink),
    isInterview: isInterviewEvent(summary),
  };
}

export function getEventsNext8Hours(events: GoogleCalendarEventLike[]): NormalizedEvent[] {
  const now = Date.now();
  const eightHoursMs = 8 * 60 * 60 * 1000;
  const max = now + eightHoursMs;

  return getUpcomingEvents(events)
    .filter((event) => new Date(event.startTime).getTime() <= max);
}

export function getUpcomingEvents(events: GoogleCalendarEventLike[]): NormalizedEvent[] {
  const now = Date.now();

  return events
    .map(normalizeCalendarEvent)
    .filter((event): event is NormalizedEvent => Boolean(event))
    .filter((event) => {
      const end = new Date(event.endTime).getTime();
      if (Number.isNaN(end)) return false;
      if (end < now) return false;
      return true;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}
