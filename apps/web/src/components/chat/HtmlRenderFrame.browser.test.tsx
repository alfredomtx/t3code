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

import { render as renderUi } from "../../../test/render";
import { HtmlRenderFrame } from "./HtmlRenderFrame";

const page = vi.hoisted(() => ({ url: "" }));
vi.mock(import("~/assets/longLivedAssetUrls"), () => ({
  useLongLivedAssetUrl: () => ({
    _tag: "Success",
    url: page.url || "about:blank",
    expiresAt: Date.now() + 60 * 60_000,
  }),
}));
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

function setup() {
  page.url = "";
}

it("grows past the agent's height to fit the page the client lays out", async () => {
  setup();
  page.url = URL.createObjectURL(
    new Blob([injectHtmlRenderBootstrap('<div style="height:2345px"></div>')], {
      type: "text/html",
    }),
  );
  using _url = { [Symbol.dispose]: () => URL.revokeObjectURL(page.url) };
  await using screen = await renderUi(
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

describe("HtmlRenderFrame", () => {
  it("reports leaving full screen when it unmounts while expanded", async () => {
    setup();
    const onFullscreenChange = vi.fn();
    await using screen = await renderUi(
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
});
