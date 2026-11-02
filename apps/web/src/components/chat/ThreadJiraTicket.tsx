import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  parseJiraTicketUrl,
  type ScopedThreadRef,
  type ThreadLinkedJiraTicket,
} from "@t3tools/contracts";
import { TicketIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { useOpenLink } from "~/browser/useOpenLink";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { serverEnvironment } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { jiraTicketDialogThreadAtom } from "./threadJiraTicketState";

export function ThreadJiraTicketBadge({
  threadRef,
  ticket,
  onActivate,
}: {
  threadRef: ScopedThreadRef;
  ticket: ThreadLinkedJiraTicket;
  onActivate?: (() => void) | undefined;
}) {
  const openLink = useOpenLink(threadRef);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="info"
            size="sm"
            render={
              <button
                type="button"
                aria-label={`Open Jira ticket ${ticket.key}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onActivate?.();
                  void openLink(ticket.url, { event }).catch((error: unknown) => {
                    toastManager.add({
                      type: "error",
                      title: "Could not open Jira ticket",
                      description: error instanceof Error ? error.message : String(error),
                    });
                  });
                }}
              />
            }
          >
            <TicketIcon aria-hidden />
            <span className="max-w-32 truncate">{ticket.key}</span>
          </Badge>
        }
      />
      <TooltipPopup>{ticket.url}</TooltipPopup>
    </Tooltip>
  );
}

export function ThreadJiraTicketHeader({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  return thread?.linkedJiraTicket ? (
    <ThreadJiraTicketBadge threadRef={threadRef} ticket={thread.linkedJiraTicket} />
  ) : null;
}

export function JiraTicketDialogHost() {
  const threadRef = useAtomValue(jiraTicketDialogThreadAtom);
  return threadRef ? (
    <JiraTicketDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
    />
  ) : null;
}

function JiraTicketDialog({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const update = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(thread?.linkedJiraTicket?.url ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseJiraTicketUrl(url);
  const supported = config?.environment.capabilities.threadJiraTickets === true;
  const close = () => appAtomRegistry.set(jiraTicketDialogThreadAtom, null);
  const save = async (linkedJiraTicket: ThreadLinkedJiraTicket | null) => {
    if (!canOperate || !supported || !thread || pending) return;
    setPending(true);
    setError(null);
    const result = await update({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, linkedJiraTicket },
    });
    setPending(false);
    if (result._tag === "Success") close();
    else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not save Jira ticket.");
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogPopup initialFocus={inputRef}>
        <DialogHeader>
          <DialogTitle>Link Jira ticket</DialogTitle>
          <DialogDescription>
            Attach one ticket to this thread. Linking another replaces it. Jira will not change.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="link-jira-ticket"
            onSubmit={(event) => {
              event.preventDefault();
              if (parsed) void save(parsed);
              else
                setError(
                  "Paste an HTTPS Jira ticket URL such as https://your-site.atlassian.net/browse/CRM-123.",
                );
            }}
          >
            <label htmlFor="jira-ticket-url">Jira ticket URL</label>
            <Input
              ref={inputRef}
              id="jira-ticket-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-site.atlassian.net/browse/CRM-123"
              disabled={pending || !canOperate || !supported}
            />
            {!supported ? (
              <p role="status">Update this connection's backend to link Jira tickets.</p>
            ) : !canOperate ? (
              <p role="status">This connection cannot change threads.</p>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          {thread?.linkedJiraTicket ? (
            <Button
              variant="destructive"
              disabled={pending || !canOperate || !supported}
              onClick={() => void save(null)}
            >
              Unlink ticket
            </Button>
          ) : null}
          <Button variant="outline" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="link-jira-ticket"
            disabled={pending || !canOperate || !supported || !thread}
          >
            Save ticket
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
