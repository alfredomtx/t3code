import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/reactivity";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  type ModelSelection,
  type ScheduledTaskUpsertInput,
  type ScheduledTask,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { ScheduledTasksSettings } from "./ScheduledTasksSettings";

const environmentId = EnvironmentId.make("laptop");
const projectId = ProjectId.make("project");
const task: ScheduledTask = {
  id: ScheduledTaskId.make("nightly"),
  title: "Review issues",
  prompt: "Review open issues",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId,
  threadId: null,
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-09-17T00:00:00.000Z",
  updatedAt: "2026-09-17T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
  boundModelSelectionMode: "inherit_thread",
};

const threadFamilyRead = {
  snapshotSequence: 1,
  threads: [{ id: ThreadId.make("older-thread"), title: "Fix login bug" }],
};

const state = vi.hoisted(() => ({
  connected: true,
  tasksLoaded: true,
  secondary: false,
  supportsPolicy: true,
  task: null as ScheduledTask | null,
  inputs: [] as ScheduledTaskUpsertInput[],
  threadSelection: null as ModelSelection | null,
  threadStatus: "live" as "live" | "cached" | "synchronizing" | "deleted" | "empty",
  threadError: null as string | null,
  revision: 0,
  listeners: new Set<() => void>(),
}));

function setup(saved: ScheduledTask = task) {
  state.secondary = false;
  permissions.clear();
  permissions.set(environmentId, Atom.make(true));
  permissions.set(secondaryId, Atom.make(true));
  permissions.set("", Atom.make(false));
  state.connected = true;
  state.tasksLoaded = true;
  state.supportsPolicy = true;
  state.task = saved;
  state.inputs = [];
  state.threadSelection = null;
  state.threadStatus = "live";
  state.threadError = null;
}

function notify() {
  state.revision += 1;
  for (const listener of state.listeners) listener();
}

const secondaryId = EnvironmentId.make("secondary");
const permissions = new Map<string, Atom.Writable<boolean>>();

function secondaryEnvironment() {
  return { ...environment(), environmentId: secondaryId, label: "Secondary" };
}

function environment() {
  return {
    environmentId,
    label: "Laptop",
    entry: { target: { _tag: "PrimaryConnectionTarget" } },
    connection: { phase: state.connected ? "connected" : "disconnected" },
    serverConfig: state.connected
      ? {
          environment: {
            platform: "linux",
            capabilities: { scheduledTaskTurnModelSelection: state.supportsPolicy },
          },
        }
      : null,
  };
}

vi.mock(import("./SettingsScopeContext"), async (original) => {
  const scope = () => {
    const entry = environment();
    return {
      scope: { kind: "all", label: "All", members: [], environmentIds: [environmentId] },
      environments: state.secondary ? [entry, secondaryEnvironment()] : [entry],
      connectedEnvironments: state.connected
        ? state.secondary
          ? [entry, secondaryEnvironment()]
          : [entry]
        : [],
      environment: entry,
      target: null,
      targets: [],
    };
  };
  return {
    ...(await original()),
    useSettingsScope: scope as never,
  };
});
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { AsyncResult } = await import("effect/reactivity");
  const Schema = await import("effect/Schema");
  const { ServerProvider } = await import("@t3tools/contracts");
  const models = [
    {
      slug: "gpt-5.4",
      name: "Test model",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "low", label: "Low", isDefault: true },
              { id: "high", label: "High" },
            ],
          },
        ],
      },
    },
    {
      slug: "gpt-5.5",
      name: "Other model",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "minimal", label: "Minimal", isDefault: true },
              { id: "max", label: "Maximum" },
            ],
          },
        ],
      },
    },
    {
      slug: "plain",
      name: "Plain model",
      isCustom: false,
      capabilities: { optionDescriptors: [] },
    },
  ];
  const decodeProvider = Schema.decodeUnknownSync(ServerProvider);
  const providers = Atom.make(
    ["codex", "codex_work"].map((instanceId) =>
      decodeProvider({
        instanceId,
        driver: "codex",
        displayName: instanceId === "codex" ? "Codex" : "Work",
        enabled: true,
        installed: true,
        version: "1",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-10-01T00:00:00.000Z",
        models,
        skills: [],
        versionAdvisory: {
          status: "current",
          currentVersion: "1",
          latestVersion: "1",
          updateCommand: null,
          checkedAt: null,
          message: null,
        },
      }),
    ),
  );

  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: () => providers,
      scheduledTasksLive: () =>
        Atom.make(
          AsyncResult.success({ tasks: state.tasksLoaded && state.task ? [state.task] : [] }),
        ),
      upsertScheduledTask: {
        ...actual.serverEnvironment.upsertScheduledTask,
        permissionAtom: (id: string | null) => permissions.get(id ?? "")!,
      },
    },
  };
});
// Mirrors the real query: a null request (disconnected environment) has no data.
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((request: unknown) => ({
    data:
      request === null || request === threadFamilyRead
        ? request
        : { tasks: state.tasksLoaded && state.task ? [state.task] : [] },
    error: null,
    isPending: false,
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: ((id: EnvironmentId) =>
    id === secondaryId ? secondaryEnvironment() : environment()) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: (() => null) as never,
  useProjects: (() => [{ id: projectId, environmentId, title: "Project" }]) as never,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: (() => ({
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: {
      ...DEFAULT_UNIFIED_SETTINGS.providerInstances,
      codex_work: { driver: "codex", enabled: true, config: {} },
    },
  })) as never,
}));

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/threads"), async (original) => {
  const Option = await import("effect/Option");
  const { useSyncExternalStore } = await import("react");
  const { EMPTY_ENVIRONMENT_THREAD_STATE } = await import("@t3tools/client-runtime/state/threads");
  return {
    ...(await original()),
    threadFamilies: {
      ...(await original()).threadFamilies,
      familyAtom: (() => threadFamilyRead) as never,
    },
    useEnvironmentThread: (() => {
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        () => state.revision,
      );
      return {
        ...EMPTY_ENVIRONMENT_THREAD_STATE,
        data: state.threadSelection
          ? Option.some({ thread: { modelSelection: state.threadSelection } })
          : Option.none(),
        status: state.threadStatus,
        error: state.threadError ? Option.some(state.threadError) : Option.none(),
      };
    }) as never,
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => {
  const { AsyncResult } = await import("effect/reactivity");
  return {
    ...(await original()),
    useAtomCommand: (() =>
      async ({ input }: { input: ScheduledTaskUpsertInput }) => {
        state.inputs.push(input);
        state.task = {
          ...state.task!,
          ...input,
          boundModelSelectionMode: input.boundModelSelectionMode ?? "inherit_thread",
          threadId: input.threadId ?? null,
        } as ScheduledTask;
        return AsyncResult.success({ task: state.task });
      }) as never,
  };
});

describe("ScheduledTasksSettings", () => {
  it("creates on a permitted secondary and reacts to permission changes", async () => {
    setup();
    state.secondary = true;
    const registry = AtomRegistry.make();
    using _registry = { [Symbol.dispose]: () => registry.dispose() };
    registry.set(permissions.get(environmentId)!, false);
    await using screen = await render(
      <RegistryContext.Provider value={registry}>
        <ScheduledTasksSettings />
      </RegistryContext.Provider>,
    );
    const create = screen.getByRole("button", { name: "New task" });
    await expect.element(create).toBeEnabled();
    await act(() => registry.set(permissions.get(secondaryId)!, false));
    await expect.element(create).toBeDisabled();
    await act(() => registry.set(permissions.get(secondaryId)!, true));
    await expect.element(create).toBeEnabled();
    await create.click();
    await expect.element(page.getByLabelText("Runs on")).toHaveTextContent("Secondary");
  });

  it("keeps the permitted representative as the creation target", async () => {
    setup();
    state.secondary = true;
    await using screen = await render(<ScheduledTasksSettings />);
    await screen.getByRole("button", { name: "New task" }).click();
    await expect.element(page.getByLabelText("Runs on")).toHaveTextContent("Laptop");
  });

  it("disables creation without a connected target", async () => {
    setup();
    state.connected = false;
    await using screen = await render(<ScheduledTasksSettings />);
    await expect.element(screen.getByRole("button", { name: "New task" })).toBeDisabled();
  });

  it("keeps a linked task's unsaved edits across a disconnect and reconnect", async () => {
    setup({ ...task, threadId: ThreadId.make("older-thread") });
    await using screen = await render(<ScheduledTasksSettings taskId={task.id} />);
    await expect.element(page.getByRole("dialog").getByText("Fix login bug")).toBeVisible();
    const name = page.getByRole("dialog").getByRole("textbox", { name: "Name" });
    await expect.element(name).toHaveValue("Review issues");
    await userEvent.fill(name, "Review stale issues");

    state.connected = false;
    notify();
    await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);

    await expect.element(name).toHaveValue("Review stale issues");

    state.connected = true;
    notify();
    await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
    await expect.element(name).toHaveValue("Review stale issues");
  });

  it("keeps an editor the user opened when the linked task loads later", async () => {
    setup();
    state.tasksLoaded = false;
    await using screen = await render(<ScheduledTasksSettings taskId={task.id} />);
    await userEvent.click(page.getByRole("button", { name: "New task" }));
    const dialog = page.getByRole("dialog");
    const name = dialog.getByRole("textbox", { name: "Name" });
    await userEvent.fill(name, "My draft");

    state.tasksLoaded = true;
    notify();
    await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);

    await expect.element(dialog.getByRole("heading", { name: "New task" })).toBeInTheDocument();
    await expect.element(name).toHaveValue("My draft");
  });
});

it("saves reasoning through the actual editor, preserves unknown options and reopens the saved choice", async () => {
  setup({
    ...task,
    modelSelection: { ...task.modelSelection, options: [{ id: "futureOption", value: "keep" }] },
  });
  await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  await userEvent.click(page.getByRole("dialog").getByRole("button", { name: /Low/ }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "High", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs[0]?.modelSelection.options).toEqual(
    expect.arrayContaining([
      { id: "futureOption", value: "keep" },
      { id: "reasoningEffort", value: "high" },
    ]),
  );
  await userEvent.click(page.getByRole("button", { name: "Actions for Review issues" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Edit", exact: true }));
  await expect
    .element(page.getByRole("dialog").getByRole("button", { name: /High/ }))
    .toBeInTheDocument();
});

it("leaves a provider default absent on an untouched save", async () => {
  setup();
  await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs[0]?.modelSelection).toEqual(task.modelSelection);
});

it("clears stale options when switching the model", async () => {
  setup({
    ...task,
    modelSelection: {
      ...task.modelSelection,
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "futureOption", value: true },
      ],
    },
  });
  await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  await userEvent.click(
    page.getByRole("dialog").getByRole("button", { name: "Test model", exact: true }),
  );
  await userEvent.click(page.getByRole("option", { name: /Other model/ }));
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs[0]?.modelSelection).toEqual({ instanceId: "codex", model: "gpt-5.5" });
});

it("uses live inherited settings and keeps the saved task selection through override and restore", async () => {
  setup({ ...task, threadId: ThreadId.make("bound") });
  state.threadSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.5",
    options: [{ id: "reasoningEffort", value: "max" }],
  };
  await using screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  await expect
    .element(page.getByRole("dialog").getByRole("button", { name: "Other model", exact: true }))
    .toBeDisabled();
  await expect
    .element(page.getByRole("combobox", { name: "Model policy" }))
    .toHaveTextContent("Inherit from thread");
  state.threadSelection = task.modelSelection;
  notify();
  await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
  await expect
    .element(page.getByRole("dialog").getByRole("button", { name: "Test model", exact: true }))
    .toBeDisabled();
  await userEvent.click(page.getByRole("combobox", { name: "Model policy" }));
  await userEvent.click(page.getByRole("option", { name: "Use task model and reasoning" }));
  await expect
    .element(page.getByRole("dialog").getByRole("button", { name: "Test model", exact: true }))
    .toBeEnabled();
  await userEvent.click(page.getByRole("dialog").getByRole("button", { name: /Low/ }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "High", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs[0]?.boundModelSelectionMode).toBe("use_task_selection");
  expect(state.inputs[0]?.modelSelection).toEqual({
    ...task.modelSelection,
    options: [{ id: "reasoningEffort", value: "high" }],
  });
  await userEvent.click(page.getByRole("button", { name: "Actions for Review issues" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Edit", exact: true }));
  await userEvent.click(page.getByRole("combobox", { name: "Model policy" }));
  await userEvent.click(page.getByRole("option", { name: "Inherit from thread", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs[1]?.boundModelSelectionMode).toBe("inherit_thread");
  expect(state.inputs[1]?.modelSelection).toEqual(state.inputs[0]?.modelSelection);
});

it("labels cached settings and never substitutes task selection for unavailable inherited settings", async () => {
  setup({ ...task, threadId: ThreadId.make("bound") });
  state.threadSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" };
  state.threadStatus = "cached";
  await using screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  await expect.element(page.getByText(/Last known thread settings/)).toBeInTheDocument();
  state.threadSelection = null;
  state.threadStatus = "synchronizing";
  notify();
  await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
  await expect.element(page.getByText(/Loading the thread/)).toBeInTheDocument();
  state.threadStatus = "deleted";
  notify();
  await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
  await expect.element(page.getByText("The bound thread no longer exists.")).toBeInTheDocument();
  state.threadStatus = "empty";
  state.threadError = "not found";
  notify();
  await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
  await expect.element(page.getByText(/settings are unavailable/)).toBeInTheDocument();
  state.connected = false;
  notify();
  await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
  await expect.element(page.getByText(/Reconnect to load the thread/)).toBeInTheDocument();
  await expect
    .element(page.getByRole("dialog").getByRole("button", { name: "Test model", exact: true }))
    .not.toBeInTheDocument();
});

it("does not offer or send a policy to an older server", async () => {
  setup({ ...task, threadId: ThreadId.make("bound") });
  state.supportsPolicy = false;
  state.threadSelection = task.modelSelection;
  await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  await expect.element(page.getByRole("combobox", { name: "Model policy" })).toBeDisabled();
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs[0]).not.toHaveProperty("boundModelSelectionMode");
  expect(state.inputs[0]?.modelSelection).toEqual(task.modelSelection);
});

it("clears stale options when switching provider instances", async () => {
  setup({
    ...task,
    modelSelection: { ...task.modelSelection, options: [{ id: "reasoningEffort", value: "high" }] },
  });
  await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  await userEvent.click(
    page.getByRole("dialog").getByRole("button", { name: "Test model", exact: true }),
  );
  await userEvent.click(page.getByRole("button", { name: "Work", exact: true }));
  await userEvent.click(page.getByRole("option", { name: /Test model/ }));
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs[0]?.modelSelection).toEqual({ instanceId: "codex_work", model: "gpt-5.4" });
});

it("preserves an unavailable saved model without showing another model's reasoning choices", async () => {
  const selection = {
    ...task.modelSelection,
    model: "missing-model",
    options: [{ id: "futureOption", value: true }],
  };
  setup({ ...task, modelSelection: selection });
  await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  await expect.element(page.getByText("Saved model unavailable")).toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs[0]?.modelSelection).toEqual(selection);
});

it("blocks an override save if the connected server loses policy support", async () => {
  setup({
    ...task,
    threadId: ThreadId.make("bound"),
    boundModelSelectionMode: "use_task_selection",
  });
  await using screen = await render(<ScheduledTasksSettings taskId={task.id} />);
  state.supportsPolicy = false;
  notify();
  await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
  await userEvent.click(page.getByRole("button", { name: "Save task" }));
  expect(state.inputs).toEqual([]);
  await expect.element(page.getByRole("dialog")).toBeInTheDocument();
});
