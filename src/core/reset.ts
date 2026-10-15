const MAX_AHEAD_MS = 14 * 24 * 3_600_000;

function fromEpoch(text: string): number | null {
  const m = /\|(\d{10})\b/.exec(text);
  return m ? Number(m[1]) * 1000 : null;
}

/** "try again at 10:05 PM", "resets at 9pm", "until 22:05": next local occurrence. */
function fromClock(text: string, now: number): number | null {
  let hour: number;
  let minute: number;
  const meridiem = /\b(?:at|until|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (meridiem) {
    const h12 = Number(meridiem[1]);
    minute = Number(meridiem[2] ?? 0);
    if (h12 < 1 || h12 > 12 || minute > 59) return null;
    hour = (h12 % 12) + (meridiem[3].toLowerCase() === "pm" ? 12 : 0);
  } else {
    const h24 = /\b(?:at|until|by)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(text);
    if (!h24) return null;
    hour = Number(h24[1]);
    minute = Number(h24[2]);
  }
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** "try again in 2 hours", "retry after 30 minutes". */
function fromRelative(text: string, now: number): number | null {
  const m = /\b(?:in|after)\s+(\d+)\s*(second|sec|minute|min|hour|hr|day)s?\b/i.exec(text);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const ms = unit.startsWith("s") ? 1000 : unit.startsWith("m") ? 60_000 : unit.startsWith("h") ? 3_600_000 : 86_400_000;
  return now + Number(m[1]) * ms;
}

/**
 * Best-effort: when a limit message says when the quota resets, return that
 * moment (epoch ms). Returns null when nothing parses or the time is not in
 * the next 14 days, so callers fall back to their default cooldown.
 */
export function parseResetTime(text: string, now: number): number | null {
  const t = fromEpoch(text) ?? fromClock(text, now) ?? fromRelative(text, now);
  if (t === null || t <= now || t > now + MAX_AHEAD_MS) return null;
  return t;
}
