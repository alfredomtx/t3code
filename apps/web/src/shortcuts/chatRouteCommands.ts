import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthPreviewOperateScope, type EnvironmentId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { isPreviewAvailableFor } from "../browser/previewRuntime";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  dispatchPreviewAction,
  PREVIEW_COMMAND_ACTIONS,
  type PreviewAction,
} from "../components/preview/previewActionBus";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { shouldCreateNewThreadInCurrentProject } from "../components/Sidebar.logic";
import { createNewThreadHandler, resolveDefaultProjectRef } from "../hooks/useHandleNewThread";
import { createScratchProjectActions } from "../hooks/useScratchProject";
import { getClientSettings } from "../hooks/useSettings";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import {
  selectActiveRightPanel,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { readProjects, readThreadShell } from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { readEnvironmentScope } from "../state/session";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { type CommandHandler, registerCommands, registerMenuAction } from "./dispatcher";

const CHAT_ROUTE_ID = "/_chat";

/**
 * New-thread and preview commands, live while a chat route is showing and no
 * modal page (Settings, Usage) covers it. Everything is read at event time, so
 * the scope is registered once instead of re-registering on every store change.
 */
export function installChatRouteCommands(router: AnyRouter): () => void {
  const handleNewThread = createNewThreadHandler(router);
  const scratch = createScratchProjectActions({
    environments: () =>
      [...appAtomRegistry.get(environmentPresentations.presentationsAtom)].map(
        ([environmentId, presentation]) => ({ ...presentation, environmentId }),
      ),
    primaryEnvironmentId: () => appAtomRegistry.get(primaryEnvironmentIdAtom),
    registry: appAtomRegistry,
    handleNewThread,
  });

  const readRouteTarget = () => resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const readRouteThreadRef = () => {
    const target = readRouteTarget();
    if (!target) return null;
    if (target.kind === "server") return target.threadRef;
    const draft = useComposerDraftStore.getState().getDraftSession(target.draftId);
    return draft ? (draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId)) : null;
  };
  const readPreviewOpen = () => {
    const threadRef = readRouteThreadRef();
    // Store-only on purpose: the URL-aware arbitration lives in ChatView's
    // preview toggle, which the action bus reaches.
    return threadRef
      ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) === "preview"
      : false;
  };
  const readThreadContext = () => {
    const target = readRouteTarget();
    const drafts = useComposerDraftStore.getState();
    const activeThread = target?.kind === "server" ? readThreadShell(target.threadRef) : null;
    const activeDraftThread = target
      ? target.kind === "server"
        ? drafts.getDraftThread(target.threadRef)
        : drafts.getDraftSession(target.draftId)
      : null;
    return {
      activeDraftThread,
      activeThread: activeThread ?? undefined,
      defaultProjectRef: resolveDefaultProjectRef(
        readProjects(),
        useUiStateStore.getState().projectOrder,
      ),
      handleNewThread,
    };
  };
  // Grouped like the sidebar, so the shortcut and the New thread button agree.
  const readProjectGroups = () =>
    buildSidebarProjectSnapshots({
      projects: readProjects(),
      groupScratchProjects: true,
      settings: selectProjectGroupingSettings(getClientSettings()),
      primaryEnvironmentId: appAtomRegistry.get(primaryEnvironmentIdAtom),
      resolveEnvironmentLabel: () => null,
    });
  const canOperatePreview = (environmentId: EnvironmentId) =>
    readEnvironmentScope(environmentId, AuthPreviewOperateScope);

  const claim = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const startNewLocal: CommandHandler = (event) => {
    claim(event);
    // With no current or open project, such as when every project is archived, pick one.
    void startNewThreadFromContext(readThreadContext()).then((started) => {
      if (!started) openCommandPalette({ open: "new-thread-in" });
    });
  };

  const runPreviewAction = (action: PreviewAction) => {
    const threadRef = readRouteThreadRef();
    if (
      !threadRef ||
      (action === "toggle-panel"
        ? !canOperatePreview(threadRef.environmentId) && !readPreviewOpen()
        : !canOperatePreview(threadRef.environmentId))
    )
      return;
    if (!isPreviewAvailableFor(threadRef.environmentId)) {
      if (action === "toggle-panel")
        toastManager.add(
          stackedThreadToast({
            type: "info",
            title: "Preview is desktop-only",
            description: "Open T3 Code in the desktop app to use the in-app preview.",
          }),
        );
      return;
    }
    dispatchPreviewAction(action);
  };
  const previewCommand =
    (action: PreviewAction): CommandHandler =>
    (event) => {
      claim(event);
      runPreviewAction(action);
    };
  const routeActive = () =>
    router.state.matches.some((match) => match.routeId === CHAT_ROUTE_ID) &&
    !router.state.matches.some((match) => isAppModalPage(match.pathname)) &&
    !isCommandPaletteOpen();

  const releaseKeys = registerCommands(
    {
      "chat.newLocal": startNewLocal,
      "chat.newWithoutProject": (event) => {
        const { activeThread, activeDraftThread } = readThreadContext();
        const environmentId = scratch.scratchEnvironmentId(
          activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null,
        );
        if (environmentId === null) return;
        claim(event);
        void scratch.startScratchThread(environmentId);
      },
      "chat.new": (event) => {
        // The boring sidebar's folders already show the context, so it starts in
        // the current project like the legacy sidebar did.
        const { boringSidebarEnabled, legacySidebarEnabled } = getClientSettings();
        const groups = readProjectGroups();
        if (
          !boringSidebarEnabled &&
          !legacySidebarEnabled &&
          !shouldCreateNewThreadInCurrentProject(
            false,
            groups.filter((group) => !group.archived).length,
            groups.length,
          )
        ) {
          claim(event);
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        startNewLocal(event);
      },
      "preview.toggle": previewCommand("toggle-panel"),
      "preview.refresh": previewCommand("refresh"),
      "preview.focusUrl": previewCommand("focus-url"),
      "preview.zoomIn": previewCommand("zoom-in"),
      "preview.zoomOut": previewCommand("zoom-out"),
      "preview.resetZoom": previewCommand("reset-zoom"),
    },
    {
      when: routeActive,
      context: () => {
        const threadRef = readRouteThreadRef();
        return {
          terminalOpen: threadRef
            ? selectThreadTerminalUiState(
                useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                threadRef,
              ).terminalOpen
            : false,
          previewOpen: readPreviewOpen(),
          rightPanelOpen: selectThreadRightPanelState(
            useRightPanelStore.getState().byThreadKey,
            threadRef,
          ).isOpen,
        };
      },
      onKeyDown: (event) => {
        if (event.key !== "Escape") return false;
        const selection = useThreadSelectionStore.getState();
        if (selection.selectedThreadKeys.size === 0) return false;
        event.preventDefault();
        selection.clearSelection();
      },
    },
  );
  const releaseMenus = PREVIEW_COMMAND_ACTIONS.map(([command, action]) =>
    registerMenuAction(command, () => {
      if (routeActive()) runPreviewAction(action);
    }),
  );
  return () => {
    releaseKeys();
    for (const release of releaseMenus) release();
  };
}
