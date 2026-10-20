import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { RenderedResultDisclosure } from "./RenderedResultDisclosure";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  container?.remove();
});

it("retains the iframe and input across pointer and keyboard disclosure and remembers overrides on remount", async () => {
  container = document.body.appendChild(document.createElement("div"));
  container.style.width = "640px";
  root = createRoot(container);
  const overrides = new Map<string, boolean>();
  const onToggle = vi.fn();
  const render = async (defaultCollapsed: boolean, mounted = true) => {
    await act(() =>
      root?.render(
        mounted ? (
          <RenderedResultDisclosure
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
          </RenderedResultDisclosure>
        ) : null,
      ),
    );
  };
  await render(true);
  const button = page.getByRole("button", { name: "Rendered result" });
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
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const overrides = new Map<string, boolean>();
  const render = async (defaultCollapsed: boolean) => {
    await act(() =>
      root?.render(
        <RenderedResultDisclosure
          rowId="result"
          title="Page"
          defaultCollapsed={defaultCollapsed}
          overrides={overrides}
          onToggle={() => {}}
          onFullscreenChange={() => {}}
        >
          {() => <iframe sandbox="" title="Page content" srcDoc="A rendered result" />}
        </RenderedResultDisclosure>,
      ),
    );
  };
  await render(true);
  const button = page.getByRole("button", { name: "Page", exact: true });
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
