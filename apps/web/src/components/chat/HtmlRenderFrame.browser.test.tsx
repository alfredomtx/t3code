import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { EnvironmentId } from "@t3tools/contracts";
import {
  htmlRenderTheme,
  HTML_RENDER_DEFAULT_FONTS,
  injectHtmlRenderBootstrap,
} from "@t3tools/shared/htmlRender";
import { T3_CODE_DARK_THEME_COLORS } from "@t3tools/shared/themePalettes";

import "~/index.css";
import { render, type Screen } from "../../../test/render";

const assetUrl = vi.hoisted(() => ({ current: "about:blank" }));

import { HtmlRenderFrame } from "./HtmlRenderFrame";

vi.mock(import("~/assets/longLivedAssetUrls"), () => ({
  useLongLivedAssetUrl: () => ({
    _tag: "Success",
    url: assetUrl.current,
    expiresAt: Date.now() + 60 * 60_000,
  }),
}));
vi.mock(import("~/assets/assetUrls"), async (original) => ({
  ...(await original()),
  useAssetUrlState: () => ({
    _tag: "Success",
    url: assetUrl.current,
    expiresAt: Date.now() + 60 * 60_000,
  }),
  useAssetUrlRefresh: () => vi.fn(),
}));
vi.mock(import("~/hooks/useHtmlRenderTheme"), async (original) => ({
  ...(await original()),
  useHtmlRenderTheme: () =>
    htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark", HTML_RENDER_DEFAULT_FONTS),
}));

it("grows past the agent's height to fit the page the client lays out", async () => {
  setup();
  const url = URL.createObjectURL(
    new Blob([injectHtmlRenderBootstrap('<div style="height:2345px"></div>')], {
      type: "text/html",
    }),
  );
  assetUrl.current = url;
  using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(url) };
  await using screen = await render(
    <HtmlRenderFrame
      environmentId={EnvironmentId.make("environment-1")}
      htmlRender={{ attachmentId: "html", title: "Tall page", height: 400 }}
      threadRef={undefined}
    />,
  );
  const { container } = screen;

  const box = container.firstElementChild as HTMLElement;
  await expect.poll(() => box.style.height).toBe("2361px");
  expect(box.querySelector("iframe")?.clientHeight).toBe(2361);
});

function setup() {
  assetUrl.current = "about:blank";
}

const sizeChanged = (height: number) => ({
  jsonrpc: "2.0",
  method: "ui/notifications/size-changed",
  params: { height },
});

describe("HtmlRenderFrame", () => {
  it("reports leaving full screen when it unmounts while expanded", async () => {
    setup();
    const onFullscreenChange = vi.fn();
    await using screen = await render(
      <HtmlRenderFrame
        environmentId={EnvironmentId.make("environment")}
        htmlRender={{ attachmentId: "attachment", title: "Report", height: 200 }}
        threadRef={undefined}
        onFullscreenChange={onFullscreenChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open full screen" }));
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    expect(onFullscreenChange).toHaveBeenLastCalledWith(true);

    await screen.unmount();
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
  });

  it("reopens at the page height it last measured", async () => {
    setup();
    using page = (() => {
      const html = `<script>parent.postMessage(${JSON.stringify(sizeChanged(1500))}, "*");</script>`;
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      return { url, [Symbol.dispose]: () => URL.revokeObjectURL(url) };
    })();
    const frame = () => (
      <HtmlRenderFrame
        environmentId={EnvironmentId.make("environment")}
        htmlRender={{ attachmentId: "measured", title: "Mockup", height: 200 }}
        threadRef={undefined}
      />
    );
    const frameHeight = (screen: Screen) =>
      screen.getByTitle("Mockup").element().parentElement?.style.height;

    assetUrl.current = page.url;
    {
      await using first = await render(frame());
      await vi.waitFor(() => expect(frameHeight(first)).toBe("1500px"));
    }

    // A page that never reports its height, so only the remembered measurement can size the frame.
    assetUrl.current = "about:blank";
    await using second = await render(frame());
    expect(frameHeight(second)).toBe("1500px");
  });
});
