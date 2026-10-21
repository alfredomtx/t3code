import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { JiraResultDisclosure } from "./JiraResultDisclosure";

import { render as renderUi } from "../../../test/render";

it("retains the iframe and input across pointer and keyboard disclosure and remembers overrides on remount", async () => {
  await using screen = await renderUi(null);
  const container = screen.container;
  container.style.width = "640px";
  const overrides = new Map<string, boolean>();
  const onToggle = vi.fn();
  const render = async (defaultCollapsed: boolean, mounted = true) => {
    await screen.rerender(
      mounted ? (
        <JiraResultDisclosure
          resourceUri="ui://widget/jira-widget.html"
          rowId="result"
          defaultCollapsed={defaultCollapsed}
          overrides={overrides}
          onToggle={onToggle}
          onFullscreenChange={() => {}}
        >
          {() => (
            <iframe
              sandbox="allow-same-origin"
              title="Interactive result"
              srcDoc='<input aria-label="Draft" />'
              style={{ width: "100%", height: 250 }}
            />
          )}
        </JiraResultDisclosure>
      ) : null,
    );
  };
  await render(true);
  const button = page.getByRole("button", { name: "Jira result" });
  const frame = container.querySelector("iframe");
  if (!frame) throw new Error("Missing result frame");
  const content = frame.parentElement;
  if (!content) throw new Error("Missing result content");
  expect(content.getBoundingClientRect().height).toBe(0);
  expect(frame.getBoundingClientRect().width).toBe(640);
  expect(content.inert).toBe(true);
  await userEvent.click(button);
  expect(content.getBoundingClientRect().height).toBeGreaterThanOrEqual(250);
  await expect.poll(() => frame.contentDocument?.querySelector("input")).toBeTruthy();
  const input = frame.contentDocument?.querySelector("input");
  if (!input) throw new Error("Missing result input");
  input.value = "Keep my draft";
  await userEvent.keyboard("{Enter}");
  expect(content.getBoundingClientRect().height).toBe(0);
  expect(content.getAttribute("aria-hidden")).toBe("true");
  await userEvent.keyboard(" ");
  expect(container.querySelector("iframe")).toBe(frame);
  expect(frame.contentDocument?.querySelector("input")).toBe(input);
  expect(input.value).toBe("Keep my draft");
  expect(onToggle.mock.calls).toEqual([
    ["result", false],
    ["result", true],
    ["result", false],
  ]);
  await render(false);
  await render(true);
  expect(content.getBoundingClientRect().height).toBeGreaterThanOrEqual(250);
  await render(true, false);
  await render(true);
  expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
});

it("follows preference changes until overridden", async () => {
  await using screen = await renderUi(null);
  const overrides = new Map<string, boolean>();
  const render = async (defaultCollapsed: boolean) => {
    await screen.rerender(
      <JiraResultDisclosure
        resourceUri="ui://widget/jira-widget.html"
        rowId="result"
        defaultCollapsed={defaultCollapsed}
        overrides={overrides}
        onToggle={() => {}}
        onFullscreenChange={() => {}}
      >
        {() => <iframe sandbox="" title="Page content" srcDoc="A rendered result" />}
      </JiraResultDisclosure>,
    );
  };
  await render(true);
  const button = page.getByRole("button", { name: "Jira result", exact: true });
  await expect.element(button).toHaveAttribute("aria-expanded", "false");
  await render(false);
  await expect.element(button).toHaveAttribute("aria-expanded", "true");
  await render(true);
  await expect.element(button).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(button);
  await render(true);
  await expect.element(button).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(button);
  await render(false);
  await expect.element(button).toHaveAttribute("aria-expanded", "false");
});

it("leaves other MCP apps visible without adding disclosure controls", async () => {
  const onFullscreenChange = vi.fn();
  await using screen = await renderUi(
    <JiraResultDisclosure
      resourceUri="ui://widget/other-app.html"
      rowId="other-app"
      defaultCollapsed={true}
      overrides={new Map()}
      onToggle={() => {}}
      onFullscreenChange={onFullscreenChange}
    >
      {({ visible }) => (
        <iframe
          sandbox=""
          title="Other app"
          srcDoc="<input aria-label='Draft'>"
          data-visible={visible}
          style={{ height: 250 }}
        />
      )}
    </JiraResultDisclosure>,
  );
  const frame = screen.container.querySelector("iframe");
  expect(frame?.getBoundingClientRect().height).toBe(250);
  expect(frame?.getAttribute("data-visible")).toBe("true");
  expect(screen.container.querySelector("button")).toBeNull();
  expect(screen.container.querySelector("[inert]")).toBeNull();
});
