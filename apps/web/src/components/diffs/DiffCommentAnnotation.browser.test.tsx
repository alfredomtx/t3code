import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { registerCommands } from "~/shortcuts/dispatcher";
import { act, render } from "../../../test/render";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";

it("leaves IME keys in a diff comment to the composition", async () => {
  const onCancel = vi.fn();
  const onComment = vi.fn();
  await using screen = await render(
    <DiffCommentAnnotation
      kind="draft"
      rangeLabel="3"
      text=""
      onCancel={onCancel}
      onComment={onComment}
    />,
  );
  const heard: Array<{ key: string; consumed: boolean }> = [];
  using _observer = {
    [Symbol.dispose]: registerCommands(
      {},
      { observe: (event, consumed) => heard.push({ key: event.key, consumed }) },
    ),
  };
  const draft = screen.getByRole("textbox", { name: "Comment on lines 3" });
  await draft.fill("Draft");

  for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
    for (const keys of [
      { key: "Escape" },
      { key: "Enter", ctrlKey: true },
      { key: "Enter", metaKey: true },
    ]) {
      const label = JSON.stringify({ ...keys, ...composing });
      const event = new KeyboardEvent("keydown", {
        ...keys,
        ...composing,
        bubbles: true,
        cancelable: true,
      });
      await act(() => draft.element().dispatchEvent(event));
      expect(event.defaultPrevented, label).toBe(false);
      // The right panel sheet and pull requests page close on an Escape that reaches them.
      expect(heard, label).toEqual([]);
    }
  }
  expect(onCancel).not.toHaveBeenCalled();
  expect(onComment).not.toHaveBeenCalled();

  await userEvent.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledOnce();
  expect(heard).toEqual([{ key: "Escape", consumed: true }]);

  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  expect(onComment).toHaveBeenCalledExactlyOnceWith("Draft");
});

it("sends a line comment to the agent with Cmd+Enter while preserving the review button", async () => {
  const review = vi.fn();
  const agent = vi.fn();
  await using screen = await render(
    <DiffCommentAnnotation
      kind="draft"
      rangeLabel="a.ts:1"
      text=""
      onCancel={() => {}}
      onComment={review}
      submitLabel="Add to review"
      secondaryAction={{ label: "Add to agent", submitOnShortcut: true, onAction: agent }}
    />,
  );
  const input = screen.getByRole("textbox");
  await input.fill("Please explain this line");
  await input.click();
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
  expect(agent).toHaveBeenCalledExactlyOnceWith("Please explain this line");
  expect(review).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Add to review", exact: true }).click();
  expect(review).toHaveBeenCalledExactlyOnceWith("Please explain this line");
});
