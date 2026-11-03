import { describe, expect, it } from "vite-plus/test";
import {
  formatRelativeTimeLabel,
  msUntilRelativeTimeChange,
  relativeTimeElapsedMs,
  formatDayAwareTimestamp,
  formatUpcomingTimestamp,
} from "./timestampFormat";

const timestamp = "2026-10-23T12:00:00.000Z";
const instant = Date.parse(timestamp);

it.each([
  [0, "0s ago", 1000],
  [1000, "1s ago", 1000],
  [59_500, "59s ago", 500],
  [60_000, "1m ago", 60_000],
  [3_599_000, "59m ago", 1000],
  [3_600_000, "1h ago", 3_600_000],
  [86_399_000, "23h ago", 1000],
  [86_400_000, "1d ago", 86_400_000],
])("formats age %i with seconds precision", (age, label, delay) => {
  expect(formatRelativeTimeLabel(timestamp, instant + age, "seconds")).toBe(label);
  expect(msUntilRelativeTimeChange(timestamp, instant + age, "seconds")).toBe(delay);
});

it("keeps legacy minute snapshots and labels", () => {
  expect(relativeTimeElapsedMs(timestamp, instant + 59_500)).toBe(0);
  expect(formatRelativeTimeLabel(timestamp, instant + 59_500)).toBe("just now");
  expect(msUntilRelativeTimeChange(timestamp, instant + 59_500)).toBe(500);
  expect(formatRelativeTimeLabel(timestamp, instant + 60_000)).toBe("1m ago");
});

it("keeps invalid dates absent and future dates clamped with bounded wakeups", () => {
  expect(formatRelativeTimeLabel("invalid", instant, "seconds")).toBe("");
  expect(msUntilRelativeTimeChange("invalid", instant, "seconds")).toBeNull();
  expect(formatRelativeTimeLabel(timestamp, instant - 5000, "seconds")).toBe("0s ago");
  expect(msUntilRelativeTimeChange(timestamp, instant - 5000, "seconds")).toBe(6000);
  expect(msUntilRelativeTimeChange(timestamp, instant - 10 ** 12, "seconds")).toBe(86_400_000);
});

describe("timestamps in an explicit time zone", () => {
  const now = Date.parse("2026-07-01T23:00:00.000Z");
  const zone = "America/New_York";

  it("picks relative days from the calendar in that zone", () => {
    expect(formatUpcomingTimestamp("2026-07-02T00:30:00.000Z", "12-hour", now, zone)).not.toMatch(
      /tomorrow/,
    );
    expect(formatUpcomingTimestamp("2026-07-02T05:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^tomorrow at /,
    );
    expect(formatDayAwareTimestamp("2026-07-01T03:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^yesterday at /,
    );
  });
});
