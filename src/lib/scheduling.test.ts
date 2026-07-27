import { describe, it, expect } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { computeSchedule } from "@/lib/scheduling";
import type { ScheduleOptions } from "@/lib/types";

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TZ = "Asia/Kolkata";

function baseOpts(overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return {
    count: 10,
    // 2026-07-20 10:30 IST — inside the 9–18 window.
    startAt: new Date("2026-07-20T05:00:00Z"),
    timezone: TZ,
    workStartHour: 9,
    workEndHour: 18,
    dailyLimit: 100,
    minDelaySeconds: 120,
    maxDelaySeconds: 480,
    rng: mulberry32(42),
    ...overrides,
  };
}

function dayKey(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "yyyy-MM-dd");
}

function hourOf(d: Date, tz: string): number {
  return parseInt(formatInTimeZone(d, tz, "H"), 10);
}

describe("computeSchedule", () => {
  it("(a) returns exactly count timestamps, non-decreasing, for 500 @ limit 150", () => {
    const dates = computeSchedule(
      baseOpts({ count: 500, dailyLimit: 150, rng: mulberry32(1) }),
    );
    expect(dates).toHaveLength(500);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i - 1].getTime());
    }
  });

  it("(b) consecutive same-day gaps are within [min, max+60] seconds", () => {
    const min = 120;
    const max = 480;
    const dates = computeSchedule(
      baseOpts({
        count: 300,
        dailyLimit: 150,
        minDelaySeconds: min,
        maxDelaySeconds: max,
        rng: mulberry32(7),
      }),
    );
    let sameDayPairs = 0;
    for (let i = 1; i < dates.length; i++) {
      if (dayKey(dates[i], TZ) !== dayKey(dates[i - 1], TZ)) continue;
      sameDayPairs++;
      const gapSeconds = (dates[i].getTime() - dates[i - 1].getTime()) / 1000;
      expect(gapSeconds).toBeGreaterThanOrEqual(min);
      expect(gapSeconds).toBeLessThanOrEqual(max + 60);
    }
    expect(sameDayPairs).toBeGreaterThan(0);
  });

  it("(c) every timestamp falls inside the working-hours window", () => {
    const dates = computeSchedule(
      baseOpts({ count: 400, dailyLimit: 150, rng: mulberry32(99) }),
    );
    for (const d of dates) {
      const h = hourOf(d, TZ);
      expect(h).toBeGreaterThanOrEqual(9);
      expect(h).toBeLessThan(18);
    }
  });

  it("(d) per-day counts respect dailyLimit and each new day starts at window start", () => {
    const dates = computeSchedule(
      baseOpts({ count: 400, dailyLimit: 120, rng: mulberry32(3) }),
    );
    const byDay = new Map<string, Date[]>();
    for (const d of dates) {
      const key = dayKey(d, TZ);
      const arr = byDay.get(key) ?? [];
      arr.push(d);
      byDay.set(key, arr);
    }
    const days = [...byDay.keys()].sort();
    expect(days.length).toBeGreaterThan(1);
    for (const [, arr] of byDay) {
      expect(arr.length).toBeLessThanOrEqual(120);
    }
    // Auto-continue: day N+1 batch begins exactly at the window start hour.
    for (const day of days.slice(1)) {
      const first = byDay.get(day)![0];
      expect(hourOf(first, TZ)).toBe(9);
    }
  });

  it("(e) 350 recipients @ dailyLimit 100 span exactly 4 tz-days as 100/100/100/50", () => {
    const dates = computeSchedule(
      baseOpts({
        count: 350,
        dailyLimit: 100,
        // Short delays so the day rollover is limit-driven, not window-driven.
        minDelaySeconds: 10,
        maxDelaySeconds: 20,
        rng: mulberry32(5),
      }),
    );
    const counts = new Map<string, number>();
    for (const d of dates) {
      const key = dayKey(d, TZ);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const days = [...counts.keys()].sort();
    expect(days).toHaveLength(4);
    expect(days.map((k) => counts.get(k))).toEqual([100, 100, 100, 50]);
  });

  it("(f) startAt outside the window snaps forward correctly", () => {
    // 06:30 IST — before the window: snaps to the same day at 09:00 (+ <60s jitter).
    const early = computeSchedule(
      baseOpts({
        count: 1,
        startAt: new Date("2026-07-20T01:00:00Z"),
        rng: mulberry32(11),
      }),
    );
    expect(dayKey(early[0], TZ)).toBe("2026-07-20");
    expect(formatInTimeZone(early[0], TZ, "HH:mm")).toBe("09:00");

    // 20:30 IST — after the window: lands on the next day at 09:00.
    const late = computeSchedule(
      baseOpts({
        count: 1,
        startAt: new Date("2026-07-20T15:00:00Z"),
        rng: mulberry32(11),
      }),
    );
    expect(dayKey(late[0], TZ)).toBe("2026-07-21");
    expect(formatInTimeZone(late[0], TZ, "HH:mm")).toBe("09:00");
  });

  it("(g) DST spring-forward (America/New_York, Mar 8 2026): all hours stay in window", () => {
    const tz = "America/New_York";
    const dates = computeSchedule({
      count: 150,
      // Sat Mar 7 2026 15:00 EST — evening before the spring-forward Sunday.
      startAt: new Date("2026-03-07T20:00:00Z"),
      timezone: tz,
      workStartHour: 9,
      workEndHour: 18,
      dailyLimit: 150,
      minDelaySeconds: 120,
      maxDelaySeconds: 240,
      rng: mulberry32(13),
    });
    expect(dates).toHaveLength(150);
    const days = new Set(dates.map((d) => dayKey(d, tz)));
    expect(days.has("2026-03-08")).toBe(true); // crossed into the DST-transition day
    for (const d of dates) {
      const h = hourOf(d, tz);
      expect(h).toBeGreaterThanOrEqual(9);
      expect(h).toBeLessThan(18);
    }
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i - 1].getTime());
    }
  });

  it("(h) initialSentToday consumes the first day's capacity", () => {
    const dates = computeSchedule(
      baseOpts({
        count: 5,
        dailyLimit: 100,
        initialSentToday: 99,
        minDelaySeconds: 10,
        maxDelaySeconds: 20,
        rng: mulberry32(23),
      }),
    );
    const onDay1 = dates.filter((d) => dayKey(d, TZ) === "2026-07-20");
    expect(onDay1).toHaveLength(1);
    for (const d of dates.slice(1)) {
      expect(dayKey(d, TZ)).toBe("2026-07-21");
    }
    // The rolled-over batch resumes at the next day's window start.
    expect(formatInTimeZone(dates[1], TZ, "HH:mm")).toBe("09:00");
  });

  it("(i) initialSentToday >= dailyLimit rolls the whole batch to day 2", () => {
    const dates = computeSchedule(
      baseOpts({
        count: 3,
        dailyLimit: 100,
        initialSentToday: 100,
        minDelaySeconds: 10,
        maxDelaySeconds: 20,
        rng: mulberry32(29),
      }),
    );
    expect(dates).toHaveLength(3);
    for (const d of dates) {
      expect(dayKey(d, TZ)).toBe("2026-07-21");
    }
    expect(formatInTimeZone(dates[0], TZ, "HH:mm")).toBe("09:00");
  });

  it("(j) defaults initialSentToday to 0 when omitted", () => {
    const dates = computeSchedule(
      baseOpts({
        count: 100,
        dailyLimit: 100,
        minDelaySeconds: 10,
        maxDelaySeconds: 20,
        rng: mulberry32(31),
      }),
    );
    for (const d of dates) {
      expect(dayKey(d, TZ)).toBe("2026-07-20");
    }
  });

  it("(k) throws on invalid inputs", () => {
    expect(() => computeSchedule(baseOpts({ count: -1 }))).toThrow();
    expect(() => computeSchedule(baseOpts({ count: 1.5 }))).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ workStartHour: 18, workEndHour: 9 })),
    ).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ workStartHour: 9, workEndHour: 9 })),
    ).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ workStartHour: -1 })),
    ).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ workEndHour: 25 })),
    ).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ workStartHour: 9.5 })),
    ).toThrow();
    expect(() => computeSchedule(baseOpts({ dailyLimit: 0 }))).toThrow();
    expect(() => computeSchedule(baseOpts({ dailyLimit: 151 }))).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ minDelaySeconds: 500, maxDelaySeconds: 100 })),
    ).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ minDelaySeconds: -5 })),
    ).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ timezone: "Not/AZone" })),
    ).toThrow();
    expect(() =>
      computeSchedule(baseOpts({ startAt: new Date("garbage") })),
    ).toThrow();
  });

  it("returns an empty array for count 0", () => {
    expect(computeSchedule(baseOpts({ count: 0 }))).toEqual([]);
  });
});
