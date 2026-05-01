export function getTimeLeft(startTime: string): string {
  const start = new Date(startTime).getTime();
  const now = Date.now();
  const diff = start - now;

  if (diff <= 0) return "Live Now";

  const totalMinutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `Starts in ${hours}h ${minutes}m`;
  }
  return `Starts in ${minutes}m`;
}

export function formatTimeRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameDay = startDate.toDateString() === endDate.toDateString();

  const timeFmt: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };

  if (!sameDay) {
    const dayFmt: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    };
    return `${startDate.toLocaleString([], dayFmt)} - ${endDate.toLocaleString([], dayFmt)}`;
  }

  return `${startDate.toLocaleTimeString([], timeFmt)} - ${endDate.toLocaleTimeString([], timeFmt)}`;
}

export function getEventDuration(start: string, end: string): string {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const totalMinutes = Math.max(0, Math.round((endMs - startMs) / (1000 * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}
