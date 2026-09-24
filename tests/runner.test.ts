import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { RUN_OUTPUT_STATE, SCRIPT_ENV } from "../src/constants.ts";
import type { AutoCoderRunsSummary } from "../src/contracts.ts";
import { decodeAutoCoderFailure } from "../src/failures.ts";
import { ENV_FILE_NAME, REPOS_FILE_NAME } from "../src/server/configFiles.ts";
import { RESTART_NOTE, createAutoCoderRuntime, exitLine } from "../src/server/runner.ts";
import { makeFakeSpawner } from "./helpers/fakeProcess.ts";
import { makeHarness, project, type Harness } from "./helpers/harness.ts";

const SCRIPT = NodePath.resolve(
  NodePath.dirname(new URL(import.meta.url).pathname),
  "../src/assets/script/auto-coder.js",
);

let open: Harness | null = null;

afterEach(() => {
  open?.close();
  open = null;
});

const setup = (options: { readonly scriptPath?: string } = {}) => {
  const harness = makeHarness([
    project("p1", "Billing", "/w/billing-api"),
    project("p2", "Portal", "/w/portal"),
  ]);
  open = harness;
  const spawner = makeFakeSpawner();
  const runtime = createAutoCoderRuntime({
    spawnRun: spawner.spawnRun,
    killGroup: spawner.killGroup,
    scriptPath: options.scriptPath ?? SCRIPT,
    platform: "linux",
    baseEnv: { PATH: "/usr/bin", NODE_TLS_REJECT_UNAUTHORIZED: "1" },
  });
  return { harness, spawner, runtime };
};

const failureOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return decodeAutoCoderFailure(error);
  }
  throw new Error("expected the call to be refused");
};

describe("start", () => {
  it("writes both files, spawns ONE process in that folder, and records it", async () => {
    const { harness, spawner, runtime } = setup();
    const status = await runtime.start(harness.ctx, "p1");

    expect(spawner.children).toHaveLength(1);
    const child = spawner.children[0];
    expect(child?.options.scriptPath).toBe(SCRIPT);
    expect(child?.options.cwd).toBe(NodePath.join(harness.dataDir, "projects", "p1"));
    expect(NodeFs.readdirSync(child?.options.cwd ?? "").sort()).toEqual([
      ENV_FILE_NAME,
      REPOS_FILE_NAME,
    ]);

    expect(child?.options.env["PATH"]).toBe("/usr/bin");
    expect(child?.options.env["NODE_TLS_REJECT_UNAUTHORIZED"]).toBe(
      SCRIPT_ENV["NODE_TLS_REJECT_UNAUTHORIZED"],
    );
    expect(child?.options.env["NODE_NO_WARNINGS"]).toBe("1");

    expect(status.state).toBe("running");
    expect(status.pid).toBe(child?.pid);
    expect(
      harness.db.prepare("SELECT state, pid FROM runs WHERE project_id = 'p1'").get(),
    ).toMatchObject({ state: "running", pid: child?.pid });
  });

  it("refuses a second start and answers with the status of the one that is running", async () => {
    const { harness, spawner, runtime } = setup();
    const first = await runtime.start(harness.ctx, "p1");
    const failure = await failureOf(runtime.start(harness.ctx, "p1"));
    expect(failure.kind).toBe("already-running");
    expect(failure.kind === "already-running" ? failure.status.pid : null).toBe(first.pid);
    expect(spawner.children).toHaveLength(1);
  });

  it("spawns ONCE for two starts issued in the SAME TICK", async () => {
    const { harness, spawner, runtime } = setup();
    const [a, b] = await Promise.allSettled([
      runtime.start(harness.ctx, "p1"),
      runtime.start(harness.ctx, "p1"),
    ]);
    expect(a?.status).toBe("fulfilled");
    expect(b?.status).toBe("rejected");
    expect(decodeAutoCoderFailure(b?.status === "rejected" ? b.reason : null).kind).toBe(
      "already-running",
    );
    expect(spawner.children).toHaveLength(1);
  });

  it("refuses a project the app does not have, and spawns nothing", async () => {
    const { harness, spawner, runtime } = setup();
    const failure = await failureOf(runtime.start(harness.ctx, "ghost"));
    expect(failure).toEqual({ kind: "unknown-project", projectId: "ghost" });
    expect(spawner.children).toHaveLength(0);
  });

  it("refuses when the shipped script is not in the folder", async () => {
    const { harness, spawner, runtime } = setup({ scriptPath: "/nowhere/auto-coder.js" });
    const failure = await failureOf(runtime.start(harness.ctx, "p1"));
    expect(failure).toEqual({ kind: "script-missing", path: "/nowhere/auto-coder.js" });
    expect(spawner.children).toHaveLength(0);
  });

  it("refuses with `write-failed` when the config folder cannot be made", async () => {
    const { harness, spawner, runtime } = setup();
    NodeFs.writeFileSync(NodePath.join(harness.dataDir, "projects"), "not a folder", "utf8");
    const failure = await failureOf(runtime.start(harness.ctx, "p1"));
    expect(failure.kind).toBe("write-failed");
    expect(spawner.children).toHaveLength(0);
  });

  it("runs two projects at once, each in its own folder", async () => {
    const { harness, spawner, runtime } = setup();
    await runtime.start(harness.ctx, "p1");
    await runtime.start(harness.ctx, "p2");
    expect(spawner.children.map((child) => child.options.cwd)).toEqual([
      NodePath.join(harness.dataDir, "projects", "p1"),
      NodePath.join(harness.dataDir, "projects", "p2"),
    ]);
    expect((await runtime.status(harness.ctx, "p1")).state).toBe("running");
    expect((await runtime.status(harness.ctx, "p2")).state).toBe("running");
  });
});

describe("output", () => {
  it("collects both streams and serves them after a cursor", async () => {
    const { harness, spawner, runtime } = setup();
    await runtime.start(harness.ctx, "p1");
    spawner.children[0]?.out("=== .env ===\nJIRA_HOST=x\n");
    spawner.children[0]?.err("a warning\n");

    const first = await runtime.output(harness.ctx, "p1", 0);
    expect(first.lines.map((line) => [line.stream, line.text])).toEqual([
      ["out", "=== .env ==="],
      ["out", "JIRA_HOST=x"],
      ["err", "a warning"],
    ]);
    expect(first.status.lineCount).toBe(3);

    spawner.children[0]?.out("heartbeat #1\n");
    const second = await runtime.output(harness.ctx, "p1", first.next);
    expect(second.lines.map((line) => line.text)).toEqual(["heartbeat #1"]);
  });

  const summaries = (harness: {
    readonly published: ReadonlyArray<{ name: string; value: unknown }>;
  }) =>
    harness.published
      .filter((entry) => entry.name === RUN_OUTPUT_STATE)
      .map((entry) => entry.value as AutoCoderRunsSummary);

  it("publishes the run summary BEFORE Start answers, on every chunk, on stop and on the exit (V2-58)", async () => {
    const { harness, spawner, runtime } = setup();
    const started = await runtime.start(harness.ctx, "p1");
    expect(summaries(harness).at(-1)?.["p1"]).toEqual(started);
    expect(summaries(harness).at(-1)?.["p1"]?.state).toBe("running");

    spawner.children[0]?.out("=== .env ===\n");
    spawner.children[0]?.out("heartbeat #1\n");
    spawner.children[0]?.err("a warning\n");
    expect(summaries(harness).map((summary) => summary["p1"]?.lineCount)).toEqual([0, 1, 2, 3]);
    expect(JSON.stringify(summaries(harness).at(-1))).not.toContain("heartbeat");

    await runtime.stop(harness.ctx, "p1");
    expect(summaries(harness).at(-1)?.["p1"]?.state).toBe("stopped");
    expect(summaries(harness).at(-1)?.["p1"]?.lineCount).toBe(3);
    spawner.children[0]?.exit({ code: null, signal: "SIGKILL" });
    expect(summaries(harness).at(-1)?.["p1"]?.lineCount).toBe(4);
  });

  it("publishes the EXIT of a run that ends by itself — state and the exit line's count", async () => {
    const { harness, spawner, runtime } = setup();
    await runtime.start(harness.ctx, "p1");
    spawner.children[0]?.out("heartbeat #1\n");
    spawner.children[0]?.exit({ code: 0 });
    const last = summaries(harness).at(-1)?.["p1"];
    expect(last?.state).toBe("stopped");
    expect(last?.exitCode).toBe(0);
    expect(last?.lineCount).toBe(2);
  });

  it("serves a status with no output for a project this process never ran", async () => {
    const { harness, runtime } = setup();
    const frame = await runtime.output(harness.ctx, "p2", 0);
    expect(frame).toEqual({
      status: {
        projectId: "p2",
        state: "stopped",
        pid: null,
        startedAt: null,
        stoppedAt: null,
        exitCode: null,
        lineCount: 0,
      },
      lines: [],
      next: 0,
      dropped: 0,
    });
  });
});

describe("exit", () => {
  it("records the code, flushes the tail and adds ONE line saying so", async () => {
    const { harness, spawner, runtime } = setup();
    await runtime.start(harness.ctx, "p1");
    spawner.children[0]?.out("half a line with no newline");
    spawner.children[0]?.exit({ code: 1 });

    const frame = await runtime.output(harness.ctx, "p1", 0);
    expect(frame.lines.map((line) => line.text)).toEqual([
      "half a line with no newline",
      "[auto-coder] exited with code 1",
    ]);
    expect(frame.status).toMatchObject({ state: "stopped", exitCode: 1, pid: null });
  });

  it("says what happened when the spawn itself failed", () => {
    expect(exitLine({ code: null, signal: null, error: "EACCES" })).toBe(
      "[auto-coder] could not start: EACCES",
    );
    expect(exitLine({ code: null, signal: "SIGKILL", error: null })).toBe(
      "[auto-coder] exited on signal SIGKILL",
    );
  });
});

describe("stop", () => {
  it("kills the GROUP — the negative pid — and records the run as stopped", async () => {
    const { harness, spawner, runtime } = setup();
    const started = await runtime.start(harness.ctx, "p1");
    const status = await runtime.stop(harness.ctx, "p1");

    expect(spawner.killed).toEqual([started.pid]);
    expect(status).toMatchObject({ state: "stopped", pid: null });
    expect(harness.db.prepare("SELECT state FROM runs WHERE project_id = 'p1'").get()).toEqual({
      state: "stopped",
    });
  });

  it("refuses when there is nothing to stop", async () => {
    const { harness, runtime } = setup();
    expect(await failureOf(runtime.stop(harness.ctx, "p1"))).toEqual({ kind: "not-running" });
    await runtime.start(harness.ctx, "p1");
    await runtime.stop(harness.ctx, "p1");
    expect(await failureOf(runtime.stop(harness.ctx, "p1"))).toEqual({ kind: "not-running" });
  });

  it("is still the answer for a project the app has deleted mid-run", async () => {
    const { harness, spawner, runtime } = setup();
    const started = await runtime.start(harness.ctx, "p1");
    harness.setProjects([project("p2", "Portal", "/w/portal")]);
    expect((await runtime.status(harness.ctx, "p1")).state).toBe("running");
    await runtime.stop(harness.ctx, "p1");
    expect(spawner.killed).toEqual([started.pid]);
    expect((await failureOf(runtime.start(harness.ctx, "p1"))).kind).toBe("unknown-project");
  });
});

describe("activate", () => {
  it("turns a run a dead server left behind into a stopped one, and says why", async () => {
    const { harness, runtime } = setup();
    harness.db
      .prepare("INSERT INTO runs(project_id, state, pid, started_at) VALUES (?, 'running', ?, ?)")
      .run("p1", 777, "2026-09-19T09:00:00.000Z");

    await runtime.activate(harness.ctx);

    expect(harness.db.prepare("SELECT state, pid FROM runs WHERE project_id = 'p1'").get()).toEqual(
      { state: "stopped", pid: null },
    );
    const frame = await runtime.output(harness.ctx, "p1", 0);
    expect(frame.status.state).toBe("stopped");
    expect(frame.status.startedAt).toBe("2026-09-19T09:00:00.000Z");
    expect(frame.lines.map((line) => line.text)).toEqual([RESTART_NOTE]);
    const published = harness.published.filter((entry) => entry.name === RUN_OUTPUT_STATE);
    expect(published.at(-1)?.value).toEqual({ p1: frame.status });
  });

  it("publishes an EMPTY summary on a clean start — the value exists from activate on (V2-58)", async () => {
    const { harness, runtime } = setup();
    await runtime.activate(harness.ctx);
    expect(harness.published).toEqual([{ name: RUN_OUTPUT_STATE, value: {} }]);
  });

  it("leaves a stopped row alone", async () => {
    const { harness, runtime } = setup();
    harness.db
      .prepare("INSERT INTO runs(project_id, state, exit_code) VALUES ('p1', 'stopped', 3)")
      .run();
    await runtime.activate(harness.ctx);
    expect((await runtime.status(harness.ctx, "p1")).exitCode).toBe(3);
  });
});

describe("deactivate", () => {
  it("kills every group it owns and leaves the database consistent", async () => {
    const { harness, spawner, runtime } = setup();
    const first = await runtime.start(harness.ctx, "p1");
    const second = await runtime.start(harness.ctx, "p2");

    await runtime.deactivate(harness.ctx);

    expect([...spawner.killed].sort()).toEqual([first.pid, second.pid].sort());
    expect(harness.db.prepare("SELECT project_id FROM runs WHERE state = 'running'").all()).toEqual(
      [],
    );
  });

  it("kills nothing when a run has already ended", async () => {
    const { harness, spawner, runtime } = setup();
    await runtime.start(harness.ctx, "p1");
    spawner.children[0]?.exit({ code: 0 });
    await runtime.deactivate(harness.ctx);
    expect(spawner.killed).toEqual([]);
  });
});
