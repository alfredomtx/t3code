import { RegistryContext } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type UnifiedSettings,
  ScheduledTaskId,
  ThreadId,
  type ModelSelection,
  type ScheduledTaskUpsertInput,
  type ScheduledTask,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { createModelCapabilities } from "@t3tools/shared/model";
import { act, render } from "../../../test/render";
import { ScheduledTasksSettings } from "./ScheduledTasksSettings";
import { ConfirmDialogHost } from "../ConfirmDialogHost";

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
  threads: [
    {
      id: ThreadId.make("older-thread"),
      title: "Fix login bug",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
    },
  ],
};

const state = vi.hoisted(() => ({
  connected: true,
  tasksLoaded: true,
  remove: vi.fn(),
  supportsPolicy: true,
  inputs: [] as ScheduledTaskUpsertInput[],
  threadSelection: null as ModelSelection | null,
  threadStatus: "live" as "live" | "cached" | "synchronizing" | "deleted" | "empty",
  threadError: null as string | null,
  revision: 0,
  listeners: new Set<() => void>(),
  tasks: [] as ScheduledTask[],
  secondary: false,
  providers: null as Atom.Writable<ReadonlyArray<ServerProvider>> | null,
  settings: null as unknown as UnifiedSettings,
  upsert: vi.fn(),
}));

function setup(saved: ScheduledTask = task) {
  state.connected = true;
  state.tasksLoaded = true;
  state.remove.mockReset().mockReturnValue(Effect.succeed({ id: task.id }));
  state.tasks = [saved];
  state.secondary = false;
  state.providers = null;
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: {
      ...DEFAULT_UNIFIED_SETTINGS.providerInstances,
      [ProviderInstanceId.make("codex_work")]: {
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        config: {},
      },
    },
  };
  state.upsert.mockReset();
  permissions.clear();
  permissions.set(environmentId, Atom.make(true));
  permissions.set(secondaryId, Atom.make(true));
  permissions.set("", Atom.make(false));
  state.supportsPolicy = true;
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

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
}));

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
            capabilities: {
              scheduledTaskTurnModelSelection: state.supportsPolicy,
              oneTimeSchedules: true,
            },
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
      providersValueAtom: () => state.providers ?? providers,
      scheduledTasksLive: () =>
        Atom.make(AsyncResult.success({ tasks: state.tasksLoaded ? state.tasks : [] })),
      deleteScheduledTask: {
        ...actual.serverEnvironment.deleteScheduledTask,
        run: state.remove,
      },
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
        : { tasks: state.tasksLoaded ? state.tasks : [] },
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
  useEnvironmentSettings: (() => state.settings) as never,
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
    useAtomCommand: ((command: unknown) =>
      async (request: { environmentId: EnvironmentId; input: ScheduledTaskUpsertInput }) => {
        const { serverEnvironment } = await import("../../state/server");
        if (command !== serverEnvironment.upsertScheduledTask) {
          return state.remove(command, request);
        }
        state.upsert(command, request);
        const { input } = request;
        state.inputs.push(input);
        const saved = {
          ...task,
          ...state.tasks.find((entry) => entry.id === input.id),
          ...input,
          boundModelSelectionMode: input.boundModelSelectionMode ?? "inherit_thread",
          threadId: input.threadId ?? null,
        } as ScheduledTask;
        state.tasks = [...state.tasks.filter((entry) => entry.id !== saved.id), saved];
        return AsyncResult.success({ task: saved });
      }) as never,
  };
});
function setupEffortTask() {
  setup();
  const selection = {
    ...task.modelSelection,
    options: [{ id: "reasoningEffort", value: "high" }],
  };
  state.tasks = [{ ...task, threadId: null, modelSelection: selection }];
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS, defaultModelSelection: selection };
  state.providers = Atom.make<ReadonlyArray<ServerProvider>>([
    {
      instanceId: selection.instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-11-03T00:00:00.000Z",
      models: [
        {
          slug: selection.model,
          name: "GPT-5.4",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Reasoning effort",
                type: "select",
                options: [
                  { id: "low", label: "Low", isDefault: true },
                  { id: "high", label: "High" },
                ],
                currentValue: "low",
              },
            ],
          }),
        },
        { slug: "plain", name: "Plain model", isCustom: false, capabilities: null },
        { slug: "gpt-5.5", name: "Bound model", isCustom: false, capabilities: null },
      ],
      skills: [],
      slashCommands: [],
    },
  ]);
  return selection;
}

async function fillTitleAndPrompt() {
  await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Effort task");
  await userEvent.fill(page.getByRole("textbox", { name: "Prompt", exact: true }), "Review issues");
}

describe("ScheduledTasksSettings", () => {
  it("only deletes a scheduled task after confirmation, including after cancelling", async () => {
    setup();
    await using screen = await render(
      <>
        <ScheduledTasksSettings />
        <ConfirmDialogHost />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions for Review issues" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Delete", exact: true }));
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    expect(state.remove).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
    expect(state.remove).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("button", { name: "Actions for Review issues" }))
      .toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Review issues" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Delete", exact: true }));
    await userEvent.click(page.getByRole("button", { name: "Confirm", exact: true }));
    await vi.waitFor(() =>
      expect(state.remove).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        environmentId,
        input: { id: task.id },
      }),
    );
  });

  it.each([false, true])(
    "keeps model options when the same model is reselected (existing task: %s)",
    async (editing) => {
      const selection = setupEffortTask();
      await using screen = await render(
        <ScheduledTasksSettings {...(editing ? { taskId: task.id } : {})} />,
      );
      if (!editing) {
        await screen.getByRole("button", { name: "New task" }).click();
        await page.getByRole("combobox", { name: "Workspace" }).click();
        await page.getByRole("option", { name: "Use the project checkout" }).click();
      }
      await fillTitleAndPrompt();
      await page.getByRole("button", { name: "GPT-5.4", exact: true }).click();
      await page.getByRole("option", { name: /GPT-5.4/ }).click();
      await expect.element(page.getByRole("button", { name: "High", exact: true })).toBeVisible();
      await page.getByRole("button", { name: editing ? "Save task" : "Create task" }).click();
      await vi.waitFor(() =>
        expect(state.upsert).toHaveBeenLastCalledWith(expect.anything(), {
          environmentId,
          input: expect.objectContaining({ modelSelection: selection }),
        }),
      );
    },
  );

  it("saves a changed effort and drops options when switching models", async () => {
    const selection = setupEffortTask();
    await using screen = await render(<ScheduledTasksSettings taskId={task.id} />);
    await fillTitleAndPrompt();
    await page.getByRole("button", { name: "High", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /^Low/ }).click();
    await expect.element(page.getByRole("button", { name: "Low", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save task" }).click();
    await vi.waitFor(() =>
      expect(state.upsert).toHaveBeenLastCalledWith(expect.anything(), {
        environmentId,
        input: expect.objectContaining({
          modelSelection: {
            ...selection,
            options: expect.arrayContaining([{ id: "reasoningEffort", value: "low" }]),
          },
        }),
      }),
    );

    await screen.rerender(<ScheduledTasksSettings />);
    await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
    await page.getByRole("button", { name: "GPT-5.4", exact: true }).click();
    await page.getByRole("option", { name: /Plain model/ }).click();
    expect(page.getByRole("button", { name: "High", exact: true }).query()).toBeNull();
    await page.getByRole("button", { name: "Save task" }).click();
    await vi.waitFor(() =>
      expect(state.upsert).toHaveBeenLastCalledWith(expect.anything(), {
        environmentId,
        input: expect.objectContaining({
          modelSelection: { instanceId: selection.instanceId, model: "plain" },
        }),
      }),
    );
  });
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

  it("offers no model choice for a task bound to a thread, whose runs use the thread's model", async () => {
    setupEffortTask();
    state.tasks = [{ ...state.tasks[0]!, threadId: threadFamilyRead.threads[0]!.id }];
    state.threadSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" };
    await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
    await expect.element(page.getByRole("dialog").getByText("Fix login bug")).toBeVisible();
    const enabledPicker = document.querySelector(
      '[role="dialog"] [data-chat-provider-model-picker]:not(:disabled)',
    );
    expect(enabledPicker).toBeNull();
    expect(page.getByRole("button", { name: "High", exact: true }).query()).toBeNull();
    await expect
      .element(page.getByRole("dialog").getByRole("button", { name: "Bound model", exact: true }))
      .toBeDisabled();
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

  it("keeps a new task's draft when the user clicks outside the editor", async () => {
    setup();
    await using _screen = await render(<ScheduledTasksSettings />);
    await userEvent.click(page.getByRole("button", { name: "New task" }));
    const dialog = page.getByRole("dialog");
    const name = dialog.getByRole("textbox", { name: "Name" });
    await userEvent.fill(name, "My draft");

    await userEvent.click(document.body, { position: { x: 1, y: 1 } });

    await expect.element(dialog).toHaveAttribute("data-open");
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
