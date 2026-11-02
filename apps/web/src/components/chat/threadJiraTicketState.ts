import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { serverEnvironment } from "~/state/server";

export const jiraTicketDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
);

export function openJiraTicketDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(jiraTicketDialogThreadAtom, threadRef);
}

export function supportsThreadJiraTickets(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
      .threadJiraTickets === true
  );
}
