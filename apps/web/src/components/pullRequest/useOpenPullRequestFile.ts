import { msg } from "gt-react";
import { m } from "~/i18n/messages";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, PullRequestDetailView } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveFileContextMenuAbsolutePath } from "~/fileContextMenu";
import { useOpenInPreferredEditor } from "~/editorPreferences";
import { filesystemEnvironment } from "~/state/filesystem";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { vcsEnvironment } from "~/state/vcs";
import { toastManager } from "../ui/toast";

export function useOpenPullRequestFile(
  environmentId: EnvironmentId,
  detail: Pick<PullRequestDetailView, "workspaceRoot" | "headBranch">,
) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const readRefs = useAtomCommand(vcsEnvironment.readRefs, { reportFailure: false });
  const readMetadata = useAtomQueryRunner(filesystemEnvironment.getMetadata, {
    reportFailure: false,
    refresh: true,
  });
  const openInEditor = useOpenInPreferredEditor(environmentId, config?.availableEditors ?? []);

  const openFile = async (filePath: string) => {
    let cursor: number | undefined;
    let checkout: string | null = null;
    do {
      const result = await readRefs({
        environmentId,
        input: {
          cwd: detail.workspaceRoot,
          query: detail.headBranch,
          refKind: "local",
          refresh: true,
          ...(cursor === undefined ? {} : { cursor }),
        },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        throw squashAtomCommandFailure(result);
      }
      const branch = result.value.refs.find(
        (ref) => !ref.isRemote && ref.name === detail.headBranch,
      );
      checkout = branch?.worktreePath ?? null;
      cursor = result.value.nextCursor ?? undefined;
    } while (checkout === null && cursor !== undefined);
    if (checkout === null) {
      throw new Error(`Check out ${detail.headBranch} locally before opening this file.`);
    }
    const confirmation = await readRefs({
      environmentId,
      input: { cwd: checkout, query: detail.headBranch, refKind: "local", refresh: true },
    });
    if (confirmation._tag === "Failure") {
      if (isAtomCommandInterrupted(confirmation)) return;
      throw squashAtomCommandFailure(confirmation);
    }
    if (!confirmation.value.refs.some((ref) => ref.current && ref.name === detail.headBranch)) {
      throw new Error(
        `The checkout changed branches. Check out ${detail.headBranch} and try again.`,
      );
    }
    const target = resolveFileContextMenuAbsolutePath({
      environmentId,
      filePath,
      workspaceRoot: checkout,
    });
    if (target === null) throw new Error("This file path cannot be opened in the local checkout.");
    const metadata = await readMetadata({ environmentId, input: { paths: [target] } });
    if (metadata._tag === "Failure") {
      if (isAtomCommandInterrupted(metadata)) return;
      throw squashAtomCommandFailure(metadata);
    }
    if (metadata.value.entries[0]?.kind !== "file") {
      throw new Error(`The file ${filePath} is missing or unreadable in ${checkout}.`);
    }
    const opened = await openInEditor(target, checkout);
    if (opened._tag === "Failure" && !isAtomCommandInterrupted(opened)) {
      throw squashAtomCommandFailure(opened);
    }
  };
  return (filePath: string) =>
    openFile(filePath).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: m(msg("Could not open file in editor")),
        description: error instanceof Error ? error.message : String(error),
      });
    });
}
