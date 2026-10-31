import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";

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
