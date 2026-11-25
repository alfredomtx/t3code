import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { injectMcpAppDocumentBootstrap } from "@t3tools/shared/mcpApp";

import "~/index.css";
import { act, fakeTimers, render } from "../../../test/render";

// Asks to close twice when told to, and answers only the first teardown, so
// the second one is left to finish on the host's timeout.
const APP_HTML = injectMcpAppDocumentBootstrap(`<script>
let answered = false;
addEventListener("message", (event) => {
  const message = event.data;
  if (message === "close") {
    parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/request-teardown" }, "*");
    parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/request-teardown" }, "*");
  } else if (message?.method === "ui/resource-teardown" && !answered) {
    answered = true;
    parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
  }
});
parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
</script>`);

const sizeChanged = (height: number) =>
  `parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: ${height} } }, "*");`;
// What the app's frame shows after the app follows a link: another page in the same window.
// Its nested frame keeps `load`, which stops the app, from firing before its message arrives.
const REPLACEMENT_URL = `data:text/html,${encodeURIComponent(`<script>${sizeChanged(777)}</script><iframe srcdoc="x"></iframe>`)}`;
// Served as the server serves an app: the document bootstrap is its first script.
const NAVIGATING_APP_HTML = injectMcpAppDocumentBootstrap(`<script>
addEventListener("message", (event) => {
  if (event.data === "leave") location.href = ${JSON.stringify(REPLACEMENT_URL)};
  else if (event.data?.id === "init") ${sizeChanged(321)}
});
parent.postMessage({ jsonrpc: "2.0", id: "init", method: "ui/initialize", params: {} }, "*");
</script>`);

// What an app asks its host for: a resource, a tool call and a model-context update.
const HOST_REQUESTS = `
const ask = (id, method, params) => parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
ask("init", "ui/initialize", {});
ask(1, "resources/read", { uri: "ui://demo/other" });
ask(2, "tools/call", { name: "list", arguments: {} });
ask(3, "ui/update-model-context", { content: [{ type: "text", text: "note" }] });
${sizeChanged(777)}`;
const REQUESTING_URL = `data:text/html,${encodeURIComponent(`<script>${HOST_REQUESTS}</script><iframe srcdoc="x"></iframe>`)}`;

const asset = vi.hoisted(() => ({ html: "" }));
const commands = vi.hoisted(() => ({ labels: [] as Array<string> }));
const setup = (html: string) => {
  asset.html = html;
  commands.labels = [];
};

vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: ((command: { readonly label: string }) => async () => {
    commands.labels.push(command.label);
    return {
      _tag: "Success",
      value: { callable: true, readOnly: true, content: [], contents: [] },
    };
  }) as never,
}));

vi.mock(import("~/assets/longLivedAssetUrls"), () => ({
  useLongLivedAssetUrl: () => ({
    _tag: "Success",
    url: `data:text/html,${encodeURIComponent(asset.html)}`,
    expiresAt: Date.now() + 60 * 60_000,
  }),
}));

import { McpAppFrame } from "./McpAppFrame";
import { JiraResultDisclosure } from "./JiraResultDisclosure";

const nextInitializedFrom = () =>
  new Promise<MessageEventSource>((resolve) => {
    const listen = (event: MessageEvent) => {
      if (event.source === null || event.data?.method !== "ui/notifications/initialized") return;
      window.removeEventListener("message", listen);
      resolve(event.source);
    };
    window.addEventListener("message", listen);
  });

describe("McpAppFrame", () => {
  it("keeps a reopened app when the old document's second teardown finishes late", async () => {
    setup(APP_HTML);
    const firstInitialized = nextInitializedFrom();
    await using screen = await render(
      <McpAppFrame
        environmentId={EnvironmentId.make("environment")}
        threadId={ThreadId.make("thread")}
        conversationThreadId={ThreadId.make("thread")}
        itemId={TurnItemId.make("item")}
        revision="1"
        app={{
          attachmentId: "attachment",
          server: "Demo",
          tool: "show",
          resourceUri: "ui://demo/app",
        }}
        onSendMessage={undefined}
      />,
    );
    const firstApp = await firstInitialized;
    using _timers = fakeTimers();

    (firstApp as Window).postMessage("close", "*");
    await userEvent.click(screen.getByRole("button", { name: "Show app" }));
    await expect.element(screen.getByTitle("Demo app")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole("button", { name: "Show app" }).query()).toBeNull();
    await expect.element(screen.getByTitle("Demo app")).toBeInTheDocument();
  });

  it("ignores a page the app's frame navigated to", async () => {
    setup(NAVIGATING_APP_HTML);
    const element = () => (
      <McpAppFrame
        environmentId={EnvironmentId.make("environment")}
        threadId={ThreadId.make("thread")}
        conversationThreadId={ThreadId.make("thread")}
        itemId={TurnItemId.make("item")}
        revision="1"
        app={{
          attachmentId: "attachment",
          server: "Demo",
          tool: "show",
          resourceUri: "ui://demo/app",
        }}
        onSendMessage={undefined}
      />
    );
    await using screen = await render(element());
    const frame = screen.getByTitle("Demo app").element() as HTMLIFrameElement;
    const row = frame.parentElement!.parentElement!;
    // The app resizes only after the host's answer reached it, so the bridge works both ways.
    await expect.element(row).toHaveStyle({ height: "321px" });

    // A tool update hands the row an equal app in a new object, which re-attaches the host.
    await screen.rerender(element());
    frame.contentWindow!.postMessage("leave", "*");
    await expect
      .element(screen.getByText("The Demo app left its page and was stopped"))
      .toBeInTheDocument();
    expect(row.style.height).toBe("321px");
  });

  // A server that predates the document bootstrap serves the app without it.
  it.each([
    ["the app's own page", `<script>${HOST_REQUESTS}</script>`],
    [
      "a page the app navigated to",
      `<script>location.href = ${JSON.stringify(REQUESTING_URL)};</script>`,
    ],
  ])("gives no bridge to %s when the document bootstrap is missing", async (_page, html) => {
    setup(html);
    await using screen = await render(
      <McpAppFrame
        environmentId={EnvironmentId.make("environment")}
        threadId={ThreadId.make("thread")}
        conversationThreadId={ThreadId.make("thread")}
        itemId={TurnItemId.make("item")}
        revision="1"
        app={{
          attachmentId: "attachment",
          server: "Demo",
          tool: "show",
          resourceUri: "ui://demo/app",
        }}
        onSendMessage={undefined}
      />,
    );

    await expect
      .element(
        screen.getByText(
          "The Demo app needs a newer T3 Code server on this environment. Update the server to use it.",
        ),
      )
      .toBeInTheDocument();
    expect(screen.getByTitle("Demo app").query()).toBeNull();
    expect(commands.labels).toEqual([]);
  });

  it("answers an app whose document carries the bootstrap", async () => {
    setup(injectMcpAppDocumentBootstrap(`<script>${HOST_REQUESTS}</script>`));
    await using screen = await render(
      <McpAppFrame
        environmentId={EnvironmentId.make("environment")}
        threadId={ThreadId.make("thread")}
        conversationThreadId={ThreadId.make("thread")}
        itemId={TurnItemId.make("item")}
        revision="1"
        app={{
          attachmentId: "attachment",
          server: "Demo",
          tool: "show",
          resourceUri: "ui://demo/app",
        }}
        onSendMessage={undefined}
      />,
    );
    const frame = screen.getByTitle("Demo app").element() as HTMLIFrameElement;
    await expect.element(frame.parentElement!.parentElement!).toHaveStyle({ height: "777px" });
    await vi.waitFor(() =>
      expect(commands.labels.toSorted()).toEqual([
        "environment-command:mcp-apps:call-tool",
        "environment-command:mcp-apps:read-resource",
        "environment-command:mcp-apps:tool-info",
        "environment-command:mcp-apps:update-model-context",
      ]),
    );
  });
});

// The app asks for full screen from its button. It also focuses its own frame
// and asks on load, right after it is told it left full screen, and whenever
// it loses focus while inline. It reports each answer to the page with a
// message the host ignores.
const FULLSCREEN_APP_HTML = `<!doctype html><button>Open full screen</button><input aria-label="Draft"><script>
let nextId = 0;
const pending = new Map();
const request = (method, params) =>
  new Promise((resolve) => {
    nextId += 1;
    pending.set(nextId, resolve);
    parent.postMessage({ jsonrpc: "2.0", id: nextId, method, params }, "*");
  });
let mode = "inline";
const askFullscreen = async (source) => {
  const answer = await request("ui/request-display-mode", { mode: "fullscreen" });
  mode = answer.mode;
  parent.postMessage({ probe: source + ":" + answer.mode }, "*");
};
const button = document.querySelector("button");
button.onclick = () => askFullscreen("tap");
const refocusAndAsk = (source) => {
  button.focus();
  void askFullscreen(source);
};
addEventListener("message", ({ data }) => {
  if (data === "read-draft") return parent.postMessage({ probe: "draft:" + document.querySelector("input").value }, "*");
  if (data === "retry") return refocusAndAsk("retry");
  if (pending.has(data.id)) {
    pending.get(data.id)(data.result);
    pending.delete(data.id);
    return;
  }
  if (data.method !== "ui/notifications/host-context-changed") return;
  const left = mode === "fullscreen" && data.params.displayMode === "inline";
  mode = data.params.displayMode ?? mode;
  if (left) refocusAndAsk("exit");
});
// Focus can only be taken back once the browser has finished moving it away.
addEventListener("blur", () => {
  if (mode === "inline") setTimeout(() => refocusAndAsk("blur"));
});
void request("ui/initialize", { protocolVersion: "2026-01-26", appCapabilities: {} }).then(() => {
  parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }, "*");
  refocusAndAsk("load");
});
</script>`;

function setupFullscreen() {
  setup(FULLSCREEN_APP_HTML);
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  // Reset page input in the controlled clock, then start with an idle host.
  window.dispatchEvent(new Event("pointerdown"));
  now = 5_000;
  const answers: string[] = [];
  let answered: (() => void) | undefined;
  const onProbe = (event: MessageEvent) => {
    const probe = (event.data as { readonly probe?: unknown } | null)?.probe;
    if (typeof probe !== "string") return;
    answers.push(probe);
    answered?.();
  };
  window.addEventListener("message", onProbe);
  const nextAnswer = async (action: () => Promise<unknown>, prefix = "") => {
    const seen = answers.length;
    const answer = new Promise<string>((resolve) => {
      answered = () => {
        const answer = answers.slice(seen).find((value) => value.startsWith(prefix));
        if (answer !== undefined) resolve(answer);
      };
    });
    await action();
    return answer;
  };

  const isFullscreen = () => document.querySelector("[data-mcp-app-fullscreen]") !== null;

  const renderApp = async (defaultCollapsed = false) =>
    render(
      <JiraResultDisclosure
        resourceUri="ui://widget/jira-widget.html"
        rowId="app"
        defaultCollapsed={defaultCollapsed}
        overrides={new Map()}
        onToggle={() => {}}
        onFullscreenChange={() => {}}
      >
        {({ visible, onFullscreenChange }) => (
          <McpAppFrame
            visible={visible}
            onFullscreenChange={onFullscreenChange}
            environmentId={EnvironmentId.make("env")}
            threadId={ThreadId.make("thread")}
            conversationThreadId={ThreadId.make("thread")}
            itemId={TurnItemId.make("item")}
            revision="1"
            app={{ attachmentId: "app", server: "srv", tool: "show", resourceUri: "ui://srv/app" }}
            onSendMessage={undefined}
          />
        )}
      </JiraResultDisclosure>,
    );

  const retry = () =>
    nextAnswer(async () => {
      document.querySelector("iframe")!.contentWindow!.postMessage("retry", "*");
    }, "retry:");

  return {
    renderApp,
    nextAnswer,
    retry,
    isFullscreen,
    answers,
    advance: (ms: number) => {
      now += ms;
    },
    [Symbol.dispose]() {
      window.removeEventListener("message", onProbe);
      clock.mockRestore();
    },
  };
}

it("keeps load and idle retries inline even after the page-input cooldown", async () => {
  // Chromium can retain activation from the test runner while the host clock advances.
  using _activation = vi.spyOn(navigator.userActivation, "isActive", "get").mockReturnValue(false);
  using fixture = setupFullscreen();
  await using screens = new AsyncDisposableStack();
  const { renderApp, nextAnswer, retry, isFullscreen, advance } = fixture;
  expect(
    await nextAnswer(async () => {
      screens.use(await renderApp());
    }),
  ).toBe("load:inline");
  advance(5_000);
  expect(await retry()).toBe("retry:inline");
  expect(await retry()).toBe("retry:inline");
  expect(isFullscreen()).toBe(false);
});

it("allows an app click immediately after loading on an idle page", async () => {
  using activation = vi.spyOn(navigator.userActivation, "isActive", "get").mockReturnValue(false);
  using fixture = setupFullscreen();
  await using screens = new AsyncDisposableStack();
  const { renderApp, nextAnswer, isFullscreen } = fixture;
  expect(
    await nextAnswer(async () => {
      screens.use(await renderApp());
    }),
  ).toBe("load:inline");
  activation.mockRestore();
  const appButton = page
    .frameLocator(page.getByTitle("srv app"))
    .getByRole("button", { name: "Open full screen" });
  expect(await nextAnswer(() => userEvent.click(appButton))).toBe("tap:fullscreen");
  expect(isFullscreen()).toBe(true);
  const disclosure = page.getByRole("button", { name: "Jira result", exact: true });
  await expect.element(disclosure).toBeDisabled();
  expect(
    await nextAnswer(() => userEvent.click(page.getByRole("button", { name: "Exit full screen" }))),
  ).toBe("exit:inline");
  await expect.element(disclosure).toBeEnabled();
});

it("opens full screen only from a tap in the app, never from activation the page got elsewhere", async () => {
  using fixture = setupFullscreen();
  await using screens = new AsyncDisposableStack();
  const { renderApp, nextAnswer, isFullscreen, advance } = fixture;
  const appButton = page
    .frameLocator(page.getByTitle("srv app"))
    .getByRole("button", { name: "Open full screen" });
  const elsewhere = document.body.appendChild(document.createElement("button"));
  using _elsewhere = { [Symbol.dispose]: () => elsewhere.remove() };
  elsewhere.textContent = "Elsewhere";
  const tapApp = async () => {
    advance(5_000);
    expect(await nextAnswer(() => userEvent.click(appButton))).toBe("tap:fullscreen");
    expect(isFullscreen()).toBe(true);
  };

  // The click that opens a thread still activates the page as its app loads.
  const load = nextAnswer(async () => {
    await userEvent.click(elsewhere);
    screens.use(await renderApp());
  });
  expect(await load).toBe("load:inline");
  expect(isFullscreen()).toBe(false);

  await tapApp();
  const exit = page.getByRole("button", { name: "Exit full screen" });
  expect(await nextAnswer(() => userEvent.click(exit))).toBe("exit:inline");
  expect(isFullscreen()).toBe(false);

  advance(5_000);
  expect(await nextAnswer(() => userEvent.click(elsewhere))).toBe("blur:inline");
  expect(isFullscreen()).toBe(false);

  // Escape activates nothing, but the tap that opened full screen still does.
  await tapApp();
  (await exit.element()).focus();
  expect(await nextAnswer(() => userEvent.keyboard("{Escape}"))).toBe("exit:inline");
  expect(isFullscreen()).toBe(false);
});

it("keeps the MCP document and draft across collapse and refuses hidden fullscreen requests", async () => {
  using fixture = setupFullscreen();
  await using screens = new AsyncDisposableStack();
  const { renderApp, nextAnswer, retry, isFullscreen, advance, answers } = fixture;
  expect(
    await nextAnswer(async () => {
      screens.use(await renderApp(true));
    }),
  ).toBe("load:inline");
  const disclosure = page.getByRole("button", { name: "Jira result", exact: true });
  const frame = document.querySelector("iframe");
  if (!frame) throw new Error("Missing app frame");
  const content = frame.closest("[aria-hidden]");
  if (!content) throw new Error("Missing app content");
  expect(content.getBoundingClientRect().height).toBe(0);
  await userEvent.click(disclosure);
  const draft = page
    .frameLocator(page.getByTitle("srv app"))
    .getByRole("textbox", { name: "Draft" });
  await userEvent.fill(draft, "Keep this draft");
  await userEvent.click(disclosure);
  advance(5_000);
  expect(await retry()).toBe("retry:inline");
  expect(isFullscreen()).toBe(false);
  expect(content.getBoundingClientRect().height).toBe(0);
  await userEvent.click(disclosure);
  expect(document.querySelector("iframe")).toBe(frame);
  expect(
    await nextAnswer(async () => frame.contentWindow?.postMessage("read-draft", "*"), "draft:"),
  ).toBe("draft:Keep this draft");
  expect(answers.filter((answer) => answer.startsWith("load:"))).toHaveLength(1);
});
