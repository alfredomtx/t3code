import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useStableCallback } from "~/hooks/useStableCallback";

import { toastManager } from "../ui/toast";
import {
  isFileViewed,
  isStaleViewedState,
  toFileViewedBatch,
  toFileViewedStates,
  type FileViewedStates,
} from "./pullRequestFilesViewed.logic";

const FLUSH_DELAY_MS = 400;
type ViewedChange = { readonly path: string; readonly viewed: boolean };
type Outcome = "confirmed" | "failed" | "uncertain" | "superseded";
export type ViewedUndoReceipt = { readonly id: number };
export type BulkViewedResult = {
  readonly requested: number;
  readonly confirmed: number;
  readonly failed: number;
  readonly uncertain: number;
  readonly superseded: number;
  readonly undo: ViewedUndoReceipt | null;
};
type IntentPolicy =
  | { readonly kind: "manual" }
  | { readonly kind: "automatic"; readonly scopeKey: string }
  | { readonly kind: "undo"; readonly expectedViewed: boolean };
type Intent = ViewedChange &
  IntentPolicy & {
    readonly revision: number;
    readonly finish: (outcome: Outcome) => void;
  };
type UndoEntry = Intent & { readonly previous: boolean };
type ViewedOwnership = {
  readonly owners: Map<string, number>;
  readonly overlay: Map<string, boolean>;
  readonly listeners: Set<() => void>;
  revision: number;
  retainers: number;
  writers: number;
};
const ownershipByRegistry = new WeakMap<object, Map<string, ViewedOwnership>>();

export function usePullRequestFilesViewed(options: {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly enabled: boolean;
  readonly automaticScopeKey?: string;
  readonly isAutomaticEligible?: () => boolean;
  readonly onManualChanges?: (changes: ReadonlyArray<ViewedChange>) => void;
}) {
  const { environmentId, reference, enabled } = options;
  const registry = useContext(RegistryContext);
  const atom = pullRequestEnvironment.filesViewed({ environmentId, input: reference });
  const query = useEnvironmentQuery(enabled ? atom : null);
  const canWrite = useAtomValue(
    pullRequestEnvironment.setFilesViewed.permissionAtom(environmentId),
  );
  const states = toFileViewedStates(query.data);
  const setFilesViewed = useAtomCommand(pullRequestEnvironment.setFilesViewed, {
    reportFailure: false,
  });
  const scopeKey = JSON.stringify([
    environmentId,
    reference.projectId,
    reference.repository,
    reference.number,
  ]);
  const createLane = () => ({
    scopeKey,
    environmentId,
    reference,
    atom,
    queued: new Map<string, Intent>(),
    ownership: {
      owners: new Map<string, number>(),
      overlay: new Map<string, boolean>(),
      listeners: new Set<() => void>(),
      revision: 0,
      retainers: 0,
      writers: 0,
    },
    retained: false,
    detached: false,
    attempted: new Set<string>(),
    running: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    abort: new AbortController(),
    receipt: null as { token: ViewedUndoReceipt; entries: UndoEntry[] } | null,
  });
  type Lane = ReturnType<typeof createLane>;
  const laneRef = useRef(createLane());
  const [presentation, setPresentation] = useState({
    scopeKey,
    overlay: new Map<string, boolean>(),
    busy: false,
  });
  const overlay =
    presentation.scopeKey === scopeKey ? presentation.overlay : new Map<string, boolean>();
  const notify = (lane: Lane) => {
    for (const listener of lane.ownership.listeners) listener();
  };
  const release = (lane: Lane) => {
    if (!lane.detached || !lane.retained) return;
    lane.retained = false;
    if (--lane.ownership.retainers === 0) ownershipByRegistry.get(registry)?.delete(lane.scopeKey);
  };
  const canAutomaticallyView = useStableCallback(
    (generation: string) =>
      generation === (options.automaticScopeKey ?? scopeKey) &&
      (options.isAutomaticEligible?.() ?? true),
  );
  const readStates = (lane: Lane) => {
    const result = registry.get(lane.atom);
    return AsyncResult.isSuccess(result) ? toFileViewedStates(result.value) : null;
  };
  const ready =
    enabled &&
    canWrite &&
    query.isSuccess &&
    !query.isPending &&
    query.error === null &&
    !query.data?.truncated &&
    !(presentation.scopeKey === scopeKey && presentation.busy);

  const isReady = () => {
    const lane = laneRef.current;
    const result = registry.get(lane.atom);
    return (
      lane.scopeKey === scopeKey &&
      !lane.abort.signal.aborted &&
      enabled &&
      registry.get(pullRequestEnvironment.setFilesViewed.permissionAtom(environmentId)) &&
      AsyncResult.isSuccess(result) &&
      !result.waiting &&
      !result.value.truncated &&
      lane.ownership.writers === 0 &&
      lane.ownership.overlay.size === 0
    );
  };

  const readAfterWrite = (lane: Lane) =>
    new Promise<FileViewedStates | null>((resolve) => {
      if (lane.abort.signal.aborted) {
        registry.refresh(lane.atom);
        resolve(null);
        return;
      }
      const before = registry.get(lane.atom);
      let stop = () => {};
      const finish = (value: FileViewedStates | null) => {
        stop();
        lane.abort.signal.removeEventListener("abort", abort);
        resolve(value);
      };
      const abort = () => finish(null);
      const check = () => {
        const result = registry.get(lane.atom);
        if (result === before || result.waiting) return;
        if (AsyncResult.isSuccess(result)) {
          finish(result.value.truncated ? null : toFileViewedStates(result.value));
        } else if (AsyncResult.isFailure(result)) finish(null);
      };
      stop = registry.subscribe(lane.atom, check);
      lane.abort.signal.addEventListener("abort", abort, { once: true });
      registry.refresh(lane.atom);
      check();
    });

  const drain = async (lane: Lane) => {
    if (lane.running) return;
    if (lane.timer !== null) clearTimeout(lane.timer);
    lane.timer = null;
    lane.running = true;
    lane.ownership.writers++;
    notify(lane);
    while (lane.queued.size > 0) {
      const allowed = registry.get(
        pullRequestEnvironment.setFilesViewed.permissionAtom(lane.environmentId),
      );
      const read = registry.get(lane.atom);
      const observedStates =
        AsyncResult.isSuccess(read) && !read.waiting && !read.value.truncated
          ? toFileViewedStates(read.value)
          : null;
      for (const [path, intent] of lane.queued) {
        const owned = lane.ownership.owners.get(path) === intent.revision;
        const eligible =
          intent.kind === "manual" ||
          (intent.kind === "automatic" &&
            allowed &&
            !lane.detached &&
            canAutomaticallyView(intent.scopeKey) &&
            observedStates !== null &&
            observedStates.get(path) !== "viewed" &&
            !isStaleViewedState(observedStates.get(path))) ||
          (intent.kind === "undo" &&
            observedStates !== null &&
            !isStaleViewedState(observedStates.get(path)) &&
            (observedStates.get(path) === "viewed") === intent.expectedViewed);
        if (owned && eligible) continue;
        lane.queued.delete(path);
        if (owned) lane.ownership.overlay.delete(path);
        if (intent.kind === "automatic") lane.attempted.delete(path);
        intent.finish("superseded");
      }
      if (lane.queued.size === 0) break;
      const batch = toFileViewedBatch(
        new Map([...lane.queued].map(([path, intent]) => [path, intent.viewed])),
      );
      const intents = batch.flatMap(({ path }) => {
        const intent = lane.queued.get(path);
        lane.queued.delete(path);
        return intent ? [intent] : [];
      });
      const result = await setFilesViewed({
        environmentId: lane.environmentId,
        input: { ...lane.reference, files: batch },
      });
      const observed = await readAfterWrite(lane);
      for (const intent of intents) {
        const owned = lane.ownership.owners.get(intent.path) === intent.revision;
        if (owned) lane.ownership.overlay.delete(intent.path);
        intent.finish(
          !owned
            ? "superseded"
            : result._tag === "Failure"
              ? "failed"
              : observed === null
                ? "uncertain"
                : !isStaleViewedState(observed.get(intent.path)) &&
                    (observed.get(intent.path) === "viewed") === intent.viewed
                  ? "confirmed"
                  : "uncertain",
        );
      }
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        toastManager.add({ type: "error", title: "Could not update viewed files" });
      }
      notify(lane);
    }
    lane.running = false;
    lane.ownership.writers--;
    notify(lane);
    release(lane);
  };

  const enqueue = (
    change: ViewedChange,
    finish: Intent["finish"],
    policy: IntentPolicy = { kind: "manual" },
  ) => {
    const lane = laneRef.current;
    lane.queued.get(change.path)?.finish("superseded");
    const intent = { ...change, ...policy, revision: ++lane.ownership.revision, finish };
    lane.ownership.owners.set(change.path, intent.revision);
    lane.ownership.overlay.set(change.path, change.viewed);
    lane.queued.set(change.path, intent);
    return intent;
  };

  const initializeLane = useEffectEvent((nextScopeKey: string) => {
    if (laneRef.current.scopeKey !== nextScopeKey || laneRef.current.abort.signal.aborted)
      laneRef.current = createLane();
    const lane = laneRef.current;
    let scopes = ownershipByRegistry.get(registry);
    if (scopes === undefined) {
      scopes = new Map();
      ownershipByRegistry.set(registry, scopes);
    }
    const ownership = scopes.get(nextScopeKey);
    if (ownership !== undefined) lane.ownership = ownership;
    else scopes.set(nextScopeKey, lane.ownership);
    lane.ownership.retainers++;
    lane.retained = true;
    const publish = () => {
      if (laneRef.current === lane && !lane.abort.signal.aborted)
        setPresentation({
          scopeKey: lane.scopeKey,
          overlay: new Map(lane.ownership.overlay),
          busy: lane.ownership.writers > 0 || lane.ownership.overlay.size > 0,
        });
    };
    lane.ownership.listeners.add(publish);
    publish();
    return () => {
      lane.detached = true;
      lane.ownership.listeners.delete(publish);
      lane.abort.abort();
      if (lane.timer !== null) clearTimeout(lane.timer);
      for (const [path, intent] of lane.queued) {
        if (intent.kind === "automatic") {
          lane.queued.delete(path);
          if (lane.ownership.owners.get(path) === intent.revision)
            lane.ownership.overlay.delete(path);
          intent.finish("superseded");
        }
      }
      void drain(lane);
    };
  });
  useEffect(() => initializeLane(scopeKey), [scopeKey]);

  const setViewed = useStableCallback((path: string, viewed: boolean) => {
    if (
      !enabled ||
      !registry.get(pullRequestEnvironment.setFilesViewed.permissionAtom(environmentId))
    )
      return;
    const lane = laneRef.current;
    options.onManualChanges?.([{ path, viewed }]);
    enqueue({ path, viewed }, () => {});
    notify(lane);
    if (lane.timer !== null) clearTimeout(lane.timer);
    lane.timer = setTimeout(() => void drain(lane), FLUSH_DELAY_MS);
  });

  const setManyViewed = async (
    changes: ReadonlyArray<ViewedChange>,
    undoPreconditions: ReadonlyMap<string, boolean> | null = null,
  ): Promise<BulkViewedResult> => {
    const lane = laneRef.current;
    const unique = [...new Map(changes.map((change) => [change.path, change])).values()];
    const result = {
      requested: unique.length,
      confirmed: 0,
      failed: 0,
      uncertain: 0,
      superseded: 0,
      undo: null as ViewedUndoReceipt | null,
    };
    if (!isReady()) return { ...result, failed: unique.length };
    lane.receipt = null;
    const entries: UndoEntry[] = [];
    options.onManualChanges?.(unique);
    const before = readStates(lane);
    const settlements = unique.map((change) => {
      const previous = isFileViewed(change.path, before, lane.ownership.overlay);
      if (previous === change.viewed) {
        lane.ownership.owners.set(change.path, ++lane.ownership.revision);
        result.superseded++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const expectedViewed = undoPreconditions?.get(change.path);
        const intent = enqueue(
          change,
          (outcome) => {
            result[outcome]++;
            if (outcome === "confirmed") entries.push({ ...intent, previous });
            resolve();
          },
          expectedViewed === undefined ? { kind: "manual" } : { kind: "undo", expectedViewed },
        );
      });
    });
    void drain(lane);
    await Promise.all(settlements);
    if (!lane.abort.signal.aborted && entries.length > 0) {
      const token = { id: ++lane.ownership.revision };
      lane.receipt = { token, entries };
      result.undo = token;
    }
    return result;
  };

  const undo = async (token: ViewedUndoReceipt): Promise<BulkViewedResult> => {
    const lane = laneRef.current;
    const receipt = lane.receipt;
    const empty = {
      requested: 0,
      confirmed: 0,
      failed: 0,
      uncertain: 0,
      superseded: 0,
      undo: null,
    };
    if (receipt?.token !== token) return empty;
    lane.receipt = null;
    if (!isReady())
      return { ...empty, requested: receipt.entries.length, failed: receipt.entries.length };
    const observed = readStates(lane);
    const changes = receipt.entries
      .filter(
        (entry) =>
          lane.ownership.owners.get(entry.path) === entry.revision &&
          isFileViewed(entry.path, observed, lane.ownership.overlay) === entry.viewed &&
          !isStaleViewedState(observed?.get(entry.path)),
      )
      .map((entry) => ({ path: entry.path, viewed: entry.previous }));
    const result = await setManyViewed(
      changes,
      new Map(receipt.entries.map((entry) => [entry.path, entry.viewed])),
    );
    lane.receipt = null;
    return {
      ...result,
      requested: receipt.entries.length,
      superseded: result.superseded + receipt.entries.length - changes.length,
      undo: null,
    };
  };

  const setAutomaticallyViewed = (paths: ReadonlyArray<string>) => {
    if (!isReady()) return;
    const lane = laneRef.current;
    for (const path of paths) {
      if (
        lane.attempted.has(path) ||
        lane.ownership.overlay.has(path) ||
        states?.get(path) === "viewed" ||
        isStaleViewedState(states?.get(path))
      )
        continue;
      lane.attempted.add(path);
      enqueue({ path, viewed: true }, () => {}, {
        kind: "automatic",
        scopeKey: options.automaticScopeKey ?? scopeKey,
      });
    }
    if (lane.queued.size > 0) void drain(lane);
  };

  return {
    enabled,
    canWrite,
    ready,
    isViewed: (path: string) => isFileViewed(path, states, overlay),
    isStale: (path: string) => !overlay.has(path) && isStaleViewedState(states?.get(path)),
    setViewed,
    setManyViewed,
    setAutomaticallyViewed,
    undo,
    cancelAutomatic: () => {
      const lane = laneRef.current;
      for (const [path, intent] of lane.queued) {
        if (intent.kind !== "automatic") continue;
        lane.queued.delete(path);
        if (lane.ownership.owners.get(path) === intent.revision)
          lane.ownership.overlay.delete(path);
        intent.finish("superseded");
      }
    },
    resetAutomaticAttempts: () => laneRef.current.attempted.clear(),
    truncated: query.data?.truncated === true,
    error: query.error,
    refresh: query.refresh,
  };
}
