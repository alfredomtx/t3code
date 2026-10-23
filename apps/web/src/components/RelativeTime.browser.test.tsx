import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../test/render";
import { RelativeTime } from "./RelativeTime";

it("ticks from 59 seconds to one minute while the legacy label stays unchanged", async () => {
  const timestamp = "2026-10-23T12:00:00.000Z";
  const instant = Date.parse(timestamp);
  // router: false because relative labels do not navigate.
  await using screen = await render(<div />, { router: false });
  using _timers = fakeTimers({ now: instant + 59_000 });
  await screen.rerender(
    <>
      <span aria-label="seconds">
        <RelativeTime timestamp={timestamp} precision="seconds" />
      </span>
      <span aria-label="legacy">
        <RelativeTime timestamp={timestamp} />
      </span>
    </>,
  );
  expect(screen.getByLabelText("seconds").element().textContent).toBe("59s ago");
  expect(screen.getByLabelText("legacy").element().textContent).toBe("just now");
  await act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByLabelText("seconds").element().textContent).toBe("1m ago");
  expect(screen.getByLabelText("legacy").element().textContent).toBe("1m ago");
  await screen.rerender(<RelativeTime timestamp={timestamp} precision="seconds" />);
  await screen.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
