import { createAtomCommandScheduler } from "@t3tools/client-runtime/state/runtime";
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId, type PullRequestFilesViewedResult } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { useEffect, useState } from "react";

const mocked = await vi.hoisted(async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const data = Atom.family((_number: number) =>
    Atom.make<PullRequestFilesViewedResult>({ files: [], truncated: false }),
  );
  const viewed = Atom.family((number: number) =>
    Atom.make((get) => AsyncResult.success(get(data(number)))),
  );
  return { data, viewed, permission: Atom.make(true), command: vi.fn(), execute: vi.fn() };
});
vi.mock(import("~/state/use-atom-command"), () => ({ useAtomCommand: () => mocked.command }));
vi.mock(import("~/state/pullRequests"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    pullRequestEnvironment: {
      ...actual.pullRequestEnvironment,
      filesViewed: ({ input }) => mocked.viewed(input.number),
      setFilesViewed: {
        ...actual.pullRequestEnvironment.setFilesViewed,
        permissionAtom: () => mocked.permission,
      },
    },
  };
});

import { act, render, fakeTimers } from "../../../test/render";
import {
  usePullRequestFilesViewed,
  type BulkViewedResult,
  type ViewedUndoReceipt,
} from "./usePullRequestFilesViewed";

const reference = { projectId: ProjectId.make("project"), repository: "owner/repo", number: 1 };
function setup(count: number) {
  const registry = AtomRegistry.make();
  registry.set(mocked.permission, true);
  registry.set(mocked.data(1), { files: [], truncated: false });
  registry.mount(mocked.data(1));
  registry.mount(mocked.data(2));
  registry.set(mocked.data(2), { files: [], truncated: false });
  const scheduler = createAtomCommandScheduler();
  mocked.execute.mockReset();
  mocked.command.mockReset();
  mocked.command.mockImplementation((value) =>
    scheduler.schedule(
      registry,
      { mode: "serial", key: ({ input }) => String(input.number) },
      value,
      () => mocked.execute(value),
    ),
  );
  mocked.execute.mockImplementation(async ({ input }) => {
    const current = new Map(
      registry.get(mocked.data(input.number)).files.map((file) => [file.path, file.state]),
    );
    for (const file of input.files) current.set(file.path, file.viewed ? "viewed" : "unviewed");
    registry.set(mocked.data(input.number), {
      files: [...current].map(([path, state]) => ({ path, state })),
      truncated: false,
    });
    return { _tag: "Success" };
  });
  const paths = Array.from({ length: count }, (_, n) => `${n}.test.ts`);
  let captured: ReturnType<typeof usePullRequestFilesViewed>;
  function Harness({
    number = 1,
    head = "head1",
    automaticReady = true,
  }: {
    number?: number;
    head?: string;
    automaticReady?: boolean;
  }) {
    const hooked = usePullRequestFilesViewed({
      environmentId: EnvironmentId.make("env"),
      reference: { ...reference, number },
      enabled: true,
      automaticScopeKey: head,
      isAutomaticEligible: () => automaticReady,
    });
    useEffect(() => {
      captured = hooked;
    });
    const view = hooked;
    const [result, setResult] = useState<BulkViewedResult | null>(null);
    const [receipt, setReceipt] = useState<ViewedUndoReceipt | null>(null);
    return (
      <>
        <button
          disabled={!view.ready}
          onClick={() =>
            void view.setManyViewed(paths.map((path) => ({ path, viewed: true }))).then((next) => {
              setResult(next);
              setReceipt(next.undo);
            })
          }
        >
          Mark
        </button>
        <button onClick={() => view.setViewed(paths[0] ?? "missing", true)}>Manual same</button>
        <button onClick={() => receipt && void view.undo(receipt).then(setResult)}>Undo</button>
        <output>
          {result
            ? JSON.stringify({
                confirmed: result.confirmed,
                failed: result.failed,
                uncertain: result.uncertain,
                superseded: result.superseded,
              })
            : "waiting"}
        </output>
      </>
    );
  }
  return {
    registry,
    paths,
    get view() {
      return captured;
    },
    element: (number = 1, head = "head1", automaticReady = true) => (
      <RegistryContext.Provider value={registry}>
        <Harness number={number} head={head} automaticReady={automaticReady} />
      </RegistryContext.Provider>
    ),
    [Symbol.dispose]: () => registry.dispose(),
  };
}

it.each([501, 1001])("marks and undoes %i paths using bounded requests", async (count) => {
  using fixture = setup(count);
  await using screen = await render(fixture.element());
  await screen.getByRole("button", { name: "Mark", exact: true }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(
      JSON.stringify({ confirmed: count, failed: 0, uncertain: 0, superseded: 0 }),
    );
  expect(mocked.command.mock.calls.map(([value]) => value.input.files.length)).toEqual(
    count === 501 ? [500, 1] : [500, 500, 1],
  );
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  await vi.waitFor(() => expect(mocked.command.mock.calls.length).toBe(count === 501 ? 4 : 6));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(
      JSON.stringify({ confirmed: count, failed: 0, uncertain: 0, superseded: 0 }),
    );
  expect(
    fixture.registry.get(mocked.data(1)).files.every((file) => file.state === "unviewed"),
  ).toBe(true);
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(JSON.stringify({ confirmed: 0, failed: 0, uncertain: 0, superseded: 0 }));
});

it("keeps a same-value manual intent made after a bulk write", async () => {
  using fixture = setup(2);
  await using screen = await render(fixture.element());
  await screen.getByRole("button", { name: "Mark", exact: true }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(JSON.stringify({ confirmed: 2, failed: 0, uncertain: 0, superseded: 0 }));
  await act(() => fixture.view.setViewed("0.test.ts", true));

  await screen.rerender(fixture.element(2));
  await vi.waitFor(() => expect(mocked.command).toHaveBeenCalledTimes(2));
  expect(mocked.command.mock.calls[1]?.[0].input.number).toBe(1);
  expect(mocked.command.mock.calls[1]?.[0].input.files).toEqual([
    { path: "0.test.ts", viewed: true },
  ]);
});

it("reports partial failure without granting Undo for the failed batch", async () => {
  using fixture = setup(501);
  mocked.command.mockImplementationOnce(async () => ({
    _tag: "Failure",
    cause: Cause.fail(new Error("test failure")),
  }));
  await using screen = await render(fixture.element());
  await screen.getByRole("button", { name: "Mark", exact: true }).click();

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(JSON.stringify({ confirmed: 1, failed: 500, uncertain: 0, superseded: 0 }));
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  await vi.waitFor(() => expect(mocked.command).toHaveBeenCalledTimes(3));
  expect(mocked.command.mock.calls[2]?.[0].input.files).toEqual([
    { path: "500.test.ts", viewed: false },
  ]);
});

it("refuses automatic and bulk writes without permission or a complete read", async () => {
  using fixture = setup(1);
  fixture.registry.set(mocked.permission, false);
  await using screen = await render(fixture.element());
  await expect.element(screen.getByRole("button", { name: "Mark", exact: true })).toBeDisabled();
  await act(() => fixture.view.setAutomaticallyViewed(["README.md"]));
  expect(mocked.command).not.toHaveBeenCalled();
  await act(() => {
    fixture.registry.set(mocked.permission, true);
    fixture.registry.set(mocked.data(1), { files: [], truncated: true });
  });
  await expect.element(screen.getByRole("button", { name: "Mark", exact: true })).toBeDisabled();
});

it("preserves a later same-value manual intent through a late acknowledgement and Undo", async () => {
  using fixture = setup(2);
  const apply = mocked.command.getMockImplementation();
  if (!apply) throw new Error("Missing command fixture");
  let acknowledge = () => {};
  const acknowledgement = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  mocked.command.mockImplementationOnce(async (value) => {
    await acknowledgement;
    return apply(value);
  });
  await using screen = await render(fixture.element());
  await screen.getByRole("button", { name: "Mark", exact: true }).click();
  await act(() => fixture.view.setViewed("0.test.ts", true));
  await act(() => acknowledge());
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(JSON.stringify({ confirmed: 1, failed: 0, uncertain: 0, superseded: 1 }));
  await vi.waitFor(() => expect(fixture.view.ready).toBe(true));
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  await vi.waitFor(() => expect(mocked.command).toHaveBeenCalledTimes(3));
  expect(mocked.command.mock.calls[2]?.[0].input.files).toEqual([
    { path: "1.test.ts", viewed: false },
  ]);
  expect(
    fixture.registry.get(mocked.data(1)).files.find((file) => file.path === "0.test.ts")?.state,
  ).toBe("viewed");
});

it("does not retry an uncertain automatic write on rerender", async () => {
  using fixture = setup(1);
  mocked.command.mockResolvedValue({ _tag: "Success" });
  await using screen = await render(fixture.element());
  await act(() => fixture.view.setAutomaticallyViewed(["README.md"]));
  await vi.waitFor(() => expect(fixture.view.ready).toBe(true));
  await screen.rerender(fixture.element());
  await act(() => fixture.view.setAutomaticallyViewed(["README.md"]));
  expect(mocked.command).toHaveBeenCalledTimes(1);
  expect(fixture.view.isViewed("README.md")).toBe(false);
});

it.each(["manual", "automatic"])(
  "bounds 1001 %s intents and keeps the original PR target",
  async (kind) => {
    using fixture = setup(1001);
    await using screen = await render(fixture.element());
    await act(() => {
      if (kind === "automatic") fixture.view.setAutomaticallyViewed(fixture.paths);
      else for (const path of fixture.paths) fixture.view.setViewed(path, true);
    });
    if (kind === "manual") await screen.rerender(fixture.element(2));
    await vi.waitFor(() => expect(mocked.command).toHaveBeenCalledTimes(3));
    expect(mocked.command.mock.calls.map(([value]) => value.input.files.length)).toEqual([
      500, 500, 1,
    ]);
    expect(mocked.command.mock.calls.every(([value]) => value.input.number === 1)).toBe(true);
  },
);

it("refuses Undo after permission revocation", async () => {
  using fixture = setup(1);
  await using screen = await render(fixture.element());
  await screen.getByRole("button", { name: "Mark", exact: true }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(JSON.stringify({ confirmed: 1, failed: 0, uncertain: 0, superseded: 0 }));
  await act(() => fixture.registry.set(mocked.permission, false));
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  expect(mocked.command).toHaveBeenCalledTimes(1);
});

function deferredAcknowledgement() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps a later manual choice after A/B/A re-entry while an old bulk batch retires", async () => {
  using fixture = setup(501);
  const apply = mocked.execute.getMockImplementation();
  if (!apply) throw new Error("Missing command fixture");
  const acknowledgement = deferredAcknowledgement();
  mocked.execute.mockImplementationOnce(async (value) => {
    await acknowledgement.promise;
    return apply(value);
  });
  await using screen = await render(fixture.element());
  await screen.getByRole("button", { name: "Mark", exact: true }).click();
  await screen.rerender(fixture.element(2));
  await screen.rerender(fixture.element(1));
  {
    using _timers = fakeTimers();
    await act(() => fixture.view.setViewed("500.test.ts", false));
    await act(() => vi.advanceTimersByTimeAsync(400));
  }
  expect(mocked.command).toHaveBeenCalledTimes(2);
  await act(() => acknowledgement.resolve());
  await vi.waitFor(() => expect(fixture.view.ready).toBe(true));
  expect(mocked.execute).toHaveBeenCalledTimes(2);
  expect(
    fixture.registry.get(mocked.data(1)).files.find((file) => file.path === "500.test.ts")?.state,
  ).toBe("unviewed");
  expect(fixture.registry.get(mocked.data(2)).files).toEqual([]);
});

it("drops unsent automatic paths when the head changes before inventory is complete", async () => {
  using fixture = setup(501);
  const apply = mocked.execute.getMockImplementation();
  if (!apply) throw new Error("Missing command fixture");
  const acknowledgement = deferredAcknowledgement();
  mocked.execute.mockImplementationOnce(async (value) => {
    await acknowledgement.promise;
    return apply(value);
  });
  await using screen = await render(fixture.element());
  await act(() => fixture.view.setAutomaticallyViewed(fixture.paths));
  await screen.rerender(fixture.element(1, "head2", false));
  await act(() => acknowledgement.resolve());
  await vi.waitFor(() => expect(fixture.view.ready).toBe(true));
  expect(mocked.execute).toHaveBeenCalledTimes(1);
  expect(fixture.registry.get(mocked.data(1)).files).toHaveLength(500);
});

it("skips an unsent automatic path that becomes Changed after the preceding batch", async () => {
  using fixture = setup(501);
  const apply = mocked.execute.getMockImplementation();
  if (!apply) throw new Error("Missing command fixture");
  mocked.execute.mockImplementationOnce(async (value) => {
    const result = await apply(value);
    fixture.registry.set(mocked.data(1), {
      files: [
        ...fixture.registry.get(mocked.data(1)).files,
        { path: "500.test.ts", state: "dismissed" },
      ],
      truncated: false,
    });
    return result;
  });
  await using _screen = await render(fixture.element());
  await act(() => fixture.view.setAutomaticallyViewed(fixture.paths));
  await vi.waitFor(() => expect(fixture.view.ready).toBe(true));
  expect(mocked.execute).toHaveBeenCalledTimes(1);
  expect(fixture.view.isStale("500.test.ts")).toBe(true);
});

it("Undo restores the previous Viewed boolean of a Changed file", async () => {
  using fixture = setup(1);
  fixture.registry.set(mocked.data(1), {
    files: [{ path: "0.test.ts", state: "dismissed" }],
    truncated: false,
  });
  await using screen = await render(fixture.element());
  await screen.getByRole("button", { name: "Mark", exact: true }).click();
  await vi.waitFor(() => expect(fixture.view.ready).toBe(true));
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  await vi.waitFor(() => expect(mocked.execute).toHaveBeenCalledTimes(2));
  expect(fixture.registry.get(mocked.data(1)).files[0]?.state).toBe("unviewed");
});

it("Undo preserves a confirmed file that later becomes Changed", async () => {
  using fixture = setup(1);
  await using screen = await render(fixture.element());
  await screen.getByRole("button", { name: "Mark", exact: true }).click();
  await vi.waitFor(() => expect(fixture.view.ready).toBe(true));
  await act(() =>
    fixture.registry.set(mocked.data(1), {
      files: [{ path: "0.test.ts", state: "dismissed" }],
      truncated: false,
    }),
  );
  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(JSON.stringify({ confirmed: 0, failed: 0, uncertain: 0, superseded: 1 }));
  expect(mocked.execute).toHaveBeenCalledTimes(1);
});

it.each(["dismissed", "unviewed"] as const)(
  "Undo preserves a later %s state between its batches",
  async (state) => {
    using fixture = setup(501);
    await using screen = await render(fixture.element());
    await screen.getByRole("button", { name: "Mark", exact: true }).click();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent(
        JSON.stringify({ confirmed: 501, failed: 0, uncertain: 0, superseded: 0 }),
      );
    const apply = mocked.execute.getMockImplementation();
    if (!apply) throw new Error("Missing command fixture");
    const acknowledgement = deferredAcknowledgement();
    mocked.execute.mockImplementationOnce(async (value) => {
      await acknowledgement.promise;
      return apply(value);
    });
    await screen.getByRole("button", { name: "Undo", exact: true }).click();
    await act(() =>
      fixture.registry.set(mocked.data(1), {
        files: fixture.registry
          .get(mocked.data(1))
          .files.map((file) => (file.path === "500.test.ts" ? { ...file, state } : file)),
        truncated: false,
      }),
    );
    await act(() => acknowledgement.resolve());
    await vi.waitFor(() => expect(fixture.view.ready).toBe(true));
    expect(mocked.execute).toHaveBeenCalledTimes(3);
    expect(
      fixture.registry.get(mocked.data(1)).files.find((file) => file.path === "500.test.ts")?.state,
    ).toBe(state);
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent(
        JSON.stringify({ confirmed: 500, failed: 0, uncertain: 0, superseded: 1 }),
      );
  },
);
