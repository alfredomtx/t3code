import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { page, userEvent } from "vite-plus/test/browser";
import { injectHtmlRenderBootstrap } from "@t3tools/shared/htmlRender";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";

import { render } from "../../../test/render";

import { HtmlRenderDocument } from "./BrowserDocumentFrame";

const sizeChanged = (height: number) => ({
  jsonrpc: "2.0",
  method: "ui/notifications/size-changed",
  params: { height },
});

describe("HtmlRenderDocument", () => {
  it("reports the page's first height and ignores messages from other windows", async () => {
    using pageUrl = (() => {
      const page = `<script>parent.postMessage(${JSON.stringify(sizeChanged(321))}, "*");</script>`;
      const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
      return { url, [Symbol.dispose]: () => URL.revokeObjectURL(url) };
    })();
    const onContentHeight = vi.fn();
    await using _screen = await render(
      <HtmlRenderDocument src={pageUrl.url} title="Report" onContentHeight={onContentHeight} />,
    );

    await vi.waitFor(() => expect(onContentHeight).toHaveBeenCalledWith(321));

    // Listeners run in registration order, so once this one sees the message the frame's has too.
    const delivered = new Promise<void>((resolve) =>
      window.addEventListener("message", () => resolve(), { once: true }),
    );
    window.postMessage(sizeChanged(999), "*");
    await delivered;
    expect(onContentHeight).toHaveBeenCalledTimes(1);
  });
});

it("relays Alt-only tab navigation from a focused HTML frame while preserving typing", async () => {
  const html =
    injectHtmlRenderBootstrap(`<button>Waiting</button><input aria-label="Frame input" /><script>
    window.addEventListener("message", function(e) {
      if (e.data?.method === "t3/notifications/shortcuts" && e.data.params.shortcuts.some(s => s.altKey && s.key === "f")) document.querySelector("button").textContent = "Ready";
    });
  </script>`);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(url) };
  await using screen = await render(
    <AppAtomRegistryProvider>
      <HtmlRenderDocument src={url} title="Tab shortcut frame" />
    </AppAtomRegistryProvider>,
  );
  const frame = screen.getByTitle("Tab shortcut frame").element();
  const delivered = vi.fn();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target === frame && event.altKey && event.code === "KeyF") delivered();
  };
  window.addEventListener("keydown", onKeyDown);
  using _listener = { [Symbol.dispose]: () => window.removeEventListener("keydown", onKeyDown) };
  const content = page.frameLocator(screen.getByTitle("Tab shortcut frame"));
  await content.getByRole("button", { name: "Ready" }).click();
  await userEvent.keyboard("{Alt>}f{/Alt}");
  await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
  await content.getByRole("textbox", { name: "Frame input" }).click();
  await userEvent.keyboard("{Alt>}f{/Alt}");
  expect(delivered).toHaveBeenCalledOnce();
});
