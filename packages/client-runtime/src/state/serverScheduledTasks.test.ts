import {
  EnvironmentId,
  ScheduledTask,
  type ScheduledTaskUpsertInput,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import { vi } from "vite-plus/test";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type NetworkStatus,
} from "../connection/model.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createServerEnvironmentAtoms } from "./server.ts";
vi.mock("./session.ts", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const allowed = Atom.make(
    AsyncResult.success({
      authenticated: true,
      auth: {
        policy: "remote-reachable",
        bootstrapMethods: [],
        sessionMethods: [],
        sessionCookieName: "test",
      },
      scopes: ["orchestration:operate"],
      permissions: ["orchestration:operate"],
    }),
  );
  return { createEnvironmentSessionAtoms: () => ({ sessionStateAtom: () => allowed }) };
});

const decodeTask = Schema.decodeEffect(ScheduledTask);

it.effect.each(["unsupported", "ignored", "supported"] as const)(
  "guards task policy saves against a %s server",
  (mode) =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("scheduled-test");
      const config = {
        environment: { capabilities: { scheduledTaskTurnModelSelection: mode !== "unsupported" } },
      } as ServerConfig;
      const calls: ScheduledTaskUpsertInput[] = [];
      const task = yield* decodeTask({
        id: "task",
        title: "Task",
        prompt: "Run",
        enabled: false,
        schedule: { type: "interval", everyMs: 60000 },
        projectId: "project",
        threadId: "thread",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "test" },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy: "user",
        creationSource: "web",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: "never",
        lastRunError: null,
        runCount: 0,
      });
      const session: RpcSession = {
        client: {
          [WS_METHODS.scheduledTasksUpsert]: (input: ScheduledTaskUpsertInput) =>
            Effect.sync(() => {
              calls.push(input);
              return {
                task: {
                  ...task,
                  boundModelSelectionMode:
                    mode === "ignored" ? "inherit_thread" : input.boundModelSelectionMode,
                },
              };
            }),
        } as unknown as WsRpcProtocolClient,
        initialConfig: Effect.succeed(config),
        subscribeServerConfig: () => {
          throw new Error("unused");
        },
        ready: Effect.void,
        probe: Effect.void,
        inboundFrames: Effect.succeed(0),
        closed: Effect.never,
      };
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: new PrimaryConnectionTarget({
          environmentId,
          label: "Test",
          httpBaseUrl: "https://example.test",
          wsBaseUrl: "wss://example.test",
        }),
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.some(session)),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      });
      const runtime = Atom.runtime(
        Layer.merge(
          Layer.mock(EnvironmentRegistry.EnvironmentRegistry)({
            entries: yield* SubscriptionRef.make<
              ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
            >(new Map()),
            networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
            run: (_id, effect) =>
              Effect.provideService(
                effect,
                EnvironmentSupervisor.EnvironmentSupervisor,
                supervisor,
              ),
          }),
          Layer.mock(Persistence.EnvironmentCacheStore)({}),
        ),
      );
      const atoms = createServerEnvironmentAtoms(runtime, {
        initialConfigValueAtom: () => Atom.make(config),
      });
      const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (value) =>
        Effect.sync(() => value.dispose()),
      );
      const result = yield* Effect.promise(() =>
        atoms.upsertScheduledTask.run(registry, {
          environmentId,
          input: { ...task, boundModelSelectionMode: "use_task_selection" },
        }),
      );
      expect(AsyncResult.isSuccess(result)).toBe(mode === "supported");
      expect(calls.length).toBe(mode === "unsupported" ? 0 : 1);
    }),
);
