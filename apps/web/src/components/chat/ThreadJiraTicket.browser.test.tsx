import "~/index.css";
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({
  ticket: null as { key: string; url: string } | null,
  allowed: true,
  supported: true,
  update: vi.fn(),
  openLink: vi.fn(),
}));
vi.mock("~/state/entities", () => ({
  readThreadShell: () => ({ linkedJiraTicket: state.ticket }),
  useThreadShell: () => ({ linkedJiraTicket: state.ticket }),
}));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => state.allowed }));
vi.mock("~/state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => state.update,
}));
vi.mock("~/state/threads", () => ({ threadEnvironment: { updateMetadata: {} } }));
vi.mock("~/state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  const config = Atom.make(() => ({
    environment: { capabilities: { threadJiraTickets: state.supported } },
  }));
  return { serverEnvironment: { configValueAtom: () => config } };
});
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => state.openLink }));

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { serverEnvironment } from "~/state/server";
import { ConfirmDialogHost } from "../ConfirmDialogHost";
import {
  JiraTicketDialogHost,
  ThreadJiraTicketBadge,
  ThreadJiraTicketLinkAction,
} from "./ThreadJiraTicket";
import { jiraTicketDialogThreadAtom, openJiraTicketDialog } from "./threadJiraTicketState";

const threadRef = {
  environmentId: EnvironmentId.make("jira-environment"),
  threadId: ThreadId.make("jira-thread"),
};
const first = { key: "CRM-123", url: "https://jira.example.com/browse/CRM-123" };

function fixture() {
  state.ticket = null;
  state.allowed = true;
  state.update.mockReset().mockResolvedValue(AsyncResult.success({ sequence: 1 }));
  state.openLink.mockReset().mockResolvedValue(undefined);
  state.supported = true;
  appAtomRegistry.refresh(serverEnvironment.configValueAtom(threadRef.environmentId));
  return {
    [Symbol.dispose]() {
      appAtomRegistry.set(jiraTicketDialogThreadAtom, null);
    },
  };
}

it("saves a normalized ticket on its own environment and closes on success", async () => {
  using _fixture = fixture();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <JiraTicketDialogHost />
    </RegistryContext.Provider>,
  );
  await act(() => openJiraTicketDialog(threadRef));
  await page
    .getByRole("textbox", { name: "Jira ticket URL" })
    .fill("https://jira.example.com/browse/crm-123?source=chat#comment-1");
  await page.getByRole("button", { name: "Save ticket" }).click();
  await vi.waitFor(() =>
    expect(state.update).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, linkedJiraTicket: first },
    }),
  );
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

it("refuses invalid URLs without a write", async () => {
  using _fixture = fixture();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <JiraTicketDialogHost />
    </RegistryContext.Provider>,
  );
  await act(() => openJiraTicketDialog(threadRef));
  await page
    .getByRole("textbox", { name: "Jira ticket URL" })
    .fill("https://jira.example.com/not-a-ticket");
  await page.getByRole("button", { name: "Save ticket" }).click();
  await expect.element(page.getByRole("alert")).toBeVisible();
  expect(state.update).not.toHaveBeenCalled();
});

it("disables ticket writes on read-only connections", async () => {
  using _fixture = fixture();
  state.allowed = false;
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <JiraTicketDialogHost />
    </RegistryContext.Provider>,
  );
  await act(() => openJiraTicketDialog(threadRef));
  await expect.element(page.getByRole("button", { name: "Save ticket" })).toBeDisabled();
  expect(state.update).not.toHaveBeenCalled();
});

it("keeps unsupported backends from silently discarding ticket links", async () => {
  using _fixture = fixture();
  state.supported = false;
  appAtomRegistry.refresh(serverEnvironment.configValueAtom(threadRef.environmentId));
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <JiraTicketDialogHost />
    </RegistryContext.Provider>,
  );
  await act(() => openJiraTicketDialog(threadRef));
  await expect.element(page.getByRole("button", { name: "Save ticket" })).toBeDisabled();
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Update this connection's backend to link Jira tickets.");
  expect(state.update).not.toHaveBeenCalled();
});

it("opens the ticket without activating the parent row", async () => {
  const parent = vi.fn();
  using _fixture = fixture();
  await using _screen = await render(
    <div onClick={parent}>
      <ThreadJiraTicketBadge threadRef={threadRef} ticket={first} />
    </div>,
  );
  await page.getByRole("button", { name: "Open Jira ticket CRM-123" }).click();
  expect(state.openLink).toHaveBeenCalledWith(first.url, expect.anything());
  expect(parent).not.toHaveBeenCalled();
});

function inlineAction() {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <ThreadJiraTicketLinkAction threadRef={threadRef} ticket={first} />
      <ConfirmDialogHost />
    </RegistryContext.Provider>
  );
}

it("links directly and reflects the linked ticket without a dialog", async () => {
  using _fixture = fixture();
  state.update.mockImplementation(async () => {
    state.ticket = first;
    return AsyncResult.success({ sequence: 1 });
  });
  await using screen = await render(inlineAction());
  await page.getByRole("button", { name: "Link to thread" }).click();
  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
  await screen.rerender(inlineAction());
  await expect.element(page.getByText("Linked", { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Link to thread" }))
    .not.toBeInTheDocument();
});

it("keeps the current Jira ticket until replacement is confirmed", async () => {
  using _fixture = fixture();
  state.ticket = { key: "CRM-456", url: "https://jira.example.com/browse/CRM-456" };
  state.update.mockImplementation(async () => {
    state.ticket = first;
    return AsyncResult.success({ sequence: 1 });
  });
  await using screen = await render(inlineAction());
  const link = page.getByRole("button", { name: "Link to thread" });
  const dialog = page.getByRole("alertdialog", {
    name: "Replace CRM-456 with CRM-123 on this thread?",
  });
  await link.click();
  await expect.element(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(state.ticket?.key).toBe("CRM-456");
  await link.click();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  await screen.rerender(inlineAction());
  await expect.element(page.getByText("Linked", { exact: true })).toBeVisible();
});

it.each(["read-only", "unsupported"])(
  "hides the inline link action on %s connections",
  async (reason) => {
    using _fixture = fixture();
    if (reason === "read-only") state.allowed = false;
    else {
      state.supported = false;
      appAtomRegistry.refresh(serverEnvironment.configValueAtom(threadRef.environmentId));
    }
    await using _screen = await render(inlineAction());
    await expect
      .element(page.getByRole("button", { name: "Link to thread" }))
      .not.toBeInTheDocument();
  },
);
