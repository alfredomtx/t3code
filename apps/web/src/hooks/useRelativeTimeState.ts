import { useSyncExternalStore } from "react";

import {
  formatRelativeElapsed,
  msUntilRelativeTimeChange,
  relativeTimeElapsedMs,
  type RelativeTimeState,
  type RelativeTimePrecision,
} from "../timestampFormat";

/**
 * A "5m ago" label that re-renders only when its text changes: the snapshot is
 * the elapsed time floored to the label's precision, and one timer fires at the
 * next boundary instead of polling every second.
 */
export function useRelativeTimeState(
  isoDate: string | null,
  precision: RelativeTimePrecision = "minutes",
): RelativeTimeState {
  const subscribe = (onChange: () => void) => {
    if (isoDate === null) return () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delayMs = msUntilRelativeTimeChange(isoDate, Date.now(), precision);
      if (delayMs === null) return;
      timer = setTimeout(() => {
        onChange();
        schedule();
      }, delayMs);
    };
    schedule();
    return () => clearTimeout(timer);
  };
  const getSnapshot = () =>
    isoDate === null ? null : relativeTimeElapsedMs(isoDate, Date.now(), precision);
  const elapsedMs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (isoDate === null) return { status: "missing" };
  if (elapsedMs === null) return { status: "invalid" };
  return { status: "relative", ...formatRelativeElapsed(elapsedMs, precision) };
}
