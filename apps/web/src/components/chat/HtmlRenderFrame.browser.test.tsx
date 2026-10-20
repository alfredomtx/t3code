import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  htmlRenderTheme,
  HTML_RENDER_DEFAULT_FONTS,
  injectHtmlRenderBootstrap,
} from "@t3tools/shared/htmlRender";
import { T3_CODE_DARK_THEME_COLORS } from "@t3tools/shared/themePalettes";

import "~/index.css";

import { HtmlRenderFrame } from "./HtmlRenderFrame";
import { RenderedResultDisclosure } from "./RenderedResultDisclosure";
import { page as browserPage, userEvent } from "vite-plus/test/browser";

const page = vi.hoisted(() => ({ url: "" }));
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlState: () => ({
    _tag: "Success",
    url: page.url,
    expiresAt: Date.now() + 60 * 60_000,
  }),
  useAssetUrlRefresh: () => vi.fn(),
}));
vi.mock(import("~/hooks/useHtmlRenderTheme"), async (original) => ({
  ...(await original()),
  useHtmlRenderTheme: () =>
    htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark", HTML_RENDER_DEFAULT_FONTS),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  container?.remove();
  URL.revokeObjectURL(page.url);
});

it("grows past the agent's height to fit the page the client lays out", async () => {
  page.url = URL.createObjectURL(
    new Blob([injectHtmlRenderBootstrap('<div style="height:2345px"></div>')], {
      type: "text/html",
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root!.render(
      <HtmlRenderFrame
        environmentId={EnvironmentId.make("environment-1")}
        htmlRender={{ attachmentId: "html", title: "Tall page", height: 400 }}
        threadRef={undefined}
      />,
    ),
  );

  const box = container.firstElementChild as HTMLElement;
  await expect.poll(() => box.style.height).toBe("2345px");
  expect(box.querySelector("iframe")?.clientHeight).toBe(2345);
});

it("keeps the HTML document and draft across collapse", async () => {
  page.url = URL.createObjectURL(
    new Blob(
      [
        injectHtmlRenderBootstrap(
          '<input aria-label="Draft"><script>addEventListener("message", ({data}) => { if (data === "read-draft") parent.postMessage({draft: document.querySelector("input").value}, "*"); });</script>',
        ),
      ],
      { type: "text/html" },
    ),
  );
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const onFullscreenChange = vi.fn();
  await act(() =>
    root?.render(
      <RenderedResultDisclosure
        rowId="html"
        title="HTML result"
        defaultCollapsed={true}
        overrides={new Map()}
        onToggle={() => {}}
        onFullscreenChange={onFullscreenChange}
      >
        {({ onFullscreenChange }) => (
          <HtmlRenderFrame
            environmentId={EnvironmentId.make("environment-1")}
            htmlRender={{ attachmentId: "html", title: "Page", height: 400 }}
            threadRef={undefined}
            onFullscreenChange={onFullscreenChange}
          />
        )}
      </RenderedResultDisclosure>,
    ),
  );
  const disclosure = browserPage.getByRole("button", { name: "HTML result" });
  await expect.poll(() => container?.querySelector("iframe")).toBeTruthy();
  const frame = container.querySelector("iframe");
  const content = container.querySelector("[inert]");
  expect(content?.getBoundingClientRect().height).toBe(0);
  await userEvent.click(disclosure);
  const draft = browserPage
    .frameLocator(browserPage.getByTitle("Page"))
    .getByRole("textbox", { name: "Draft" });
  await userEvent.fill(draft, "Retain this input");
  await userEvent.click(disclosure);
  expect(content?.getBoundingClientRect().height).toBe(0);
  await userEvent.click(disclosure);
  expect(container.querySelector("iframe")).toBe(frame);
  const value = new Promise<unknown>((resolve) => {
    const read = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow || !event.data || !("draft" in event.data)) return;
      window.removeEventListener("message", read);
      resolve(event.data.draft);
    };
    window.addEventListener("message", read);
  });
  frame?.contentWindow?.postMessage("read-draft", "*");
  expect(await value).toBe("Retain this input");
  const disclosureButton = container.querySelector("button");
  await userEvent.click(browserPage.getByRole("button", { name: "Open full screen" }));
  await expect.poll(() => disclosureButton?.disabled).toBe(true);
  expect(onFullscreenChange).toHaveBeenLastCalledWith(true);
  await userEvent.click(browserPage.getByRole("button", { name: "Close", exact: true }));
  await expect.poll(() => disclosureButton?.disabled).toBe(false);
  expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
  expect(container.querySelector("iframe")).toBe(frame);
});
