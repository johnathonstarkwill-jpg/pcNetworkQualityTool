export const MAX_LOG_LINES = 500;

// Prefix a log line with a zero-padded HH:MM:SS timestamp.
export function stamp(line: string, now: Date = new Date()): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}] ${line}`;
}

// Append a line, returning a new array capped at MAX_LOG_LINES (oldest dropped).
export function appendLog(buffer: readonly string[], line: string): string[] {
  const next = [...buffer, line];
  return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
}
