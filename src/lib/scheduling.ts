import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import type { ScheduleOptions } from "@/lib/types";

/**
 * Computes send timestamps for a campaign.
 *
 * Pure function: given the same options (including an injected rng) it always
 * returns the same result. All window logic is evaluated in the campaign's
 * IANA timezone; returned Dates are UTC instants.
 */
export function computeSchedule(opts: ScheduleOptions): Date[] {
  validateOptions(opts);

  const {
    timezone,
    workStartHour,
    workEndHour,
    dailyLimit,
    minDelaySeconds,
    maxDelaySeconds,
  } = opts;
  const rng = opts.rng ?? Math.random;

  /** Build a UTC instant for `workStartHour` (+ jitter seconds) on the given zoned calendar day (+ dayOffset). */
  function windowStartOn(zoned: Date, dayOffset: number): Date {
    const jitterSeconds = Math.floor(rng() * 60);
    const naive = new Date(
      zoned.getFullYear(),
      zoned.getMonth(),
      zoned.getDate() + dayOffset,
      workStartHour,
      0,
      jitterSeconds,
      0,
    );
    return fromZonedTime(naive, timezone);
  }

  /** If `d` falls outside the [workStartHour, workEndHour) window, move it to the nearest upcoming window start. */
  function snapIntoWindow(d: Date): Date {
    const zoned = toZonedTime(d, timezone);
    const hour = zoned.getHours();
    if (hour < workStartHour) {
      // Too early: same day at window start (+ small jitter).
      return windowStartOn(zoned, 0);
    }
    if (hour >= workEndHour) {
      // Past the window: next day at window start (+ small jitter).
      return windowStartOn(zoned, 1);
    }
    return d;
  }

  /** Start of the next day's window relative to `d`. */
  function startOfNextWindow(d: Date): Date {
    const zoned = toZonedTime(d, timezone);
    return windowStartOn(zoned, 1);
  }

  const result: Date[] = [];
  let cursor = snapIntoWindow(opts.startAt);
  let currentDayKey = formatInTimeZone(cursor, timezone, "yyyy-MM-dd");
  let sentOnDay = opts.initialSentToday ?? 0;

  for (let i = 0; i < opts.count; i++) {
    const dayKey = formatInTimeZone(cursor, timezone, "yyyy-MM-dd");
    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey;
      sentOnDay = 0;
    }

    if (sentOnDay >= dailyLimit) {
      cursor = startOfNextWindow(cursor);
      currentDayKey = formatInTimeZone(cursor, timezone, "yyyy-MM-dd");
      sentOnDay = 0;
    }

    // Non-decreasing guarantee: DST transitions or snap arithmetic must never
    // emit a timestamp earlier than the previous one.
    const prev = result[result.length - 1];
    if (prev && cursor.getTime() < prev.getTime()) {
      cursor = new Date(prev.getTime());
    }

    result.push(new Date(cursor.getTime()));
    sentOnDay++;

    const delaySeconds =
      minDelaySeconds +
      Math.floor(rng() * (maxDelaySeconds - minDelaySeconds + 1));
    cursor = new Date(cursor.getTime() + delaySeconds * 1000);
    cursor = snapIntoWindow(cursor);
  }

  return result;
}

function validateOptions(opts: ScheduleOptions): void {
  const {
    count,
    startAt,
    timezone,
    workStartHour,
    workEndHour,
    dailyLimit,
    minDelaySeconds,
    maxDelaySeconds,
  } = opts;

  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`count must be a non-negative integer, got ${count}`);
  }
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new Error("startAt must be a valid Date");
  }
  if (!Number.isInteger(workStartHour) || !Number.isInteger(workEndHour)) {
    throw new Error("workStartHour and workEndHour must be integers");
  }
  if (workStartHour < 0 || workStartHour >= workEndHour || workEndHour > 24) {
    throw new Error(
      `working hours must satisfy 0 <= workStartHour < workEndHour <= 24, got [${workStartHour}, ${workEndHour}]`,
    );
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 150) {
    throw new Error(`dailyLimit must be an integer in [1, 150], got ${dailyLimit}`);
  }
  if (
    !Number.isFinite(minDelaySeconds) ||
    !Number.isFinite(maxDelaySeconds) ||
    minDelaySeconds < 0 ||
    minDelaySeconds > maxDelaySeconds
  ) {
    throw new Error(
      `delays must satisfy 0 <= minDelaySeconds <= maxDelaySeconds, got [${minDelaySeconds}, ${maxDelaySeconds}]`,
    );
  }
  try {
    formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}
