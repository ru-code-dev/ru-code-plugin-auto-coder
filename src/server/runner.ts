import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

import type { ServerCtx } from "@smart-tools/plugin-sdk/host";

import { RUN_OUTPUT_STATE, SCRIPT_ENV, SCRIPT_FILE } from "../constants.ts";
import type {
  AutoCoderOutputFrame,
  AutoCoderRunState,
  AutoCoderRunStatus,
  AutoCoderRunsSummary,
} from "../contracts.ts";
import { effectiveGigacodePath } from "../defaults.ts";
import { autoCoderFailure } from "../failures.ts";
import {
  ENV_FILE_NAME,
  REPOS_FILE_NAME,
  renderEnvFile,
  renderReposFile,
  writeProjectConfig,
} from "./configFiles.ts";
import { createOutputBuffer, type OutputBuffer } from "./outputBuffer.ts";
import type { KillGroup, SpawnRun } from "./process.ts";
import { findProject, resolveProjectView } from "./projectView.ts";
import { readRun, readRunningProjectIds, readSettings, writeRun, type StoredRun } from "./store.ts";

export const resolveShippedScriptPath = (): string =>
  NodePath.join(
    NodePath.dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    "script",
    SCRIPT_FILE,
  );

export const exitLine = (exit: {
  readonly code: number | null;
  readonly signal: string | null;
  readonly error: string | null;
}): string => {
  if (exit.error !== null) return `[auto-coder] could not start: ${exit.error}`;
  if (exit.code !== null) return `[auto-coder] exited with code ${String(exit.code)}`;
  return `[auto-coder] exited on signal ${exit.signal ?? "unknown"}`;
};

export const RESTART_NOTE = "[auto-coder] the server restarted — this run was not resumed";

type RunRecord = {
  readonly buffer: OutputBuffer;
  state: AutoCoderRunState;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  live: boolean;
  exited: boolean;
};

export type AutoCoderRuntimeOptions = {
  readonly spawnRun: SpawnRun;
  readonly killGroup: KillGroup;
  readonly scriptPath: string;
  readonly platform: string;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
};

export type AutoCoderRuntime = {
  status(ctx: ServerCtx, projectId: string): Promise<AutoCoderRunStatus>;
  output(ctx: ServerCtx, projectId: string, since: number): Promise<AutoCoderOutputFrame>;
  start(ctx: ServerCtx, projectId: string): Promise<AutoCoderRunStatus>;
  stop(ctx: ServerCtx, projectId: string): Promise<AutoCoderRunStatus>;
  activate(ctx: ServerCtx): Promise<void>;
  deactivate(ctx: ServerCtx): Promise<void>;
};

const nowIso = (): string => new Date().toISOString();

export const createAutoCoderRuntime = (options: AutoCoderRuntimeOptions): AutoCoderRuntime => {
  const records = new Map<string, RunRecord>();
  const startQueue = new Map<string, Promise<unknown>>();
  let settling: Promise<void> = Promise.resolve();

  const queueWrite = (work: () => Promise<void>): void => {
    settling = settling.then(work).then(
      () => undefined,
      () => undefined,
    );
  };

  const statusOf = (projectId: string, record: RunRecord): AutoCoderRunStatus => ({
    projectId,
    state: record.state,
    pid: record.pid,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    exitCode: record.exitCode,
    lineCount: record.buffer.total,
  });

  const publishRuns = (ctx: ServerCtx): void => {
    const summary: { [projectId: string]: AutoCoderRunStatus } = {};
    for (const [projectId, record] of records) summary[projectId] = statusOf(projectId, record);
    ctx.publish(RUN_OUTPUT_STATE, summary satisfies AutoCoderRunsSummary);
  };

  const storedStatus = (projectId: string, run: StoredRun): AutoCoderRunStatus => ({
    projectId,
    state: run.state,
    pid: run.pid,
    startedAt: run.startedAt,
    stoppedAt: run.stoppedAt,
    exitCode: run.exitCode,
    lineCount: 0,
  });

  const statusFromStore = async (ctx: ServerCtx, projectId: string): Promise<AutoCoderRunStatus> =>
    storedStatus(projectId, await readRun(ctx, projectId));

  const markStopped = (record: RunRecord, at: string): void => {
    record.state = "stopped";
    record.live = false;
    record.pid = null;
    record.stoppedAt = at;
  };

  const persist = (ctx: ServerCtx, projectId: string, record: RunRecord): void => {
    const snapshot: StoredRun = {
      state: record.state,
      pid: record.pid,
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt,
      exitCode: record.exitCode,
    };
    queueWrite(() => writeRun(ctx, projectId, snapshot));
  };

  const startOnce = async (ctx: ServerCtx, projectId: string): Promise<AutoCoderRunStatus> => {
    const existing = records.get(projectId);
    if (existing !== undefined && existing.live) {
      throw autoCoderFailure(
        { kind: "already-running", status: statusOf(projectId, existing) },
        `auto-coder: ${projectId} is already running`,
      );
    }

    const project = await findProject(ctx, projectId);
    if (project === null) {
      throw autoCoderFailure(
        { kind: "unknown-project", projectId },
        `auto-coder: no project ${projectId}`,
      );
    }

    if (!NodeFs.existsSync(options.scriptPath)) {
      throw autoCoderFailure(
        { kind: "script-missing", path: options.scriptPath },
        `auto-coder: the shipped script is missing at ${options.scriptPath}`,
      );
    }

    const settings = await readSettings(ctx);
    const view = await resolveProjectView(ctx, project, options.platform);
    const envText = renderEnvFile({
      jiraToken: settings.jiraToken,
      bitbucketToken: settings.bitbucketToken,
      login: settings.login,
      gigacodePath: effectiveGigacodePath(settings, options.platform),
      repoSlug: view.settings.repoSlug,
    });
    const reposText = renderReposFile(view.settings);

    let cwd: string;
    try {
      cwd = writeProjectConfig(ctx.paths.dataDir, projectId, { envText, reposText });
    } catch (cause) {
      throw autoCoderFailure(
        {
          kind: "write-failed",
          file: `${ENV_FILE_NAME} / ${REPOS_FILE_NAME}`,
          detail: cause instanceof Error ? cause.message : String(cause),
        },
        `auto-coder: could not write the config files for ${projectId}`,
      );
    }

    const startedAt = nowIso();
    const spawned = options.spawnRun({
      scriptPath: options.scriptPath,
      cwd,
      env: { ...options.baseEnv, ...SCRIPT_ENV },
    });

    const record: RunRecord = {
      buffer: createOutputBuffer(),
      state: "running",
      pid: spawned.pid,
      startedAt,
      stoppedAt: null,
      exitCode: null,
      live: true,
      exited: false,
    };
    records.set(projectId, record);
    publishRuns(ctx);

    spawned.onOutput((stream, chunk) => {
      record.buffer.write(stream, chunk, nowIso());
      publishRuns(ctx);
    });
    spawned.onExit((exit) => {
      if (record.exited) return;
      record.exited = true;
      const at = nowIso();
      record.buffer.flush(at);
      record.buffer.push("err", exitLine(exit), at);
      record.exitCode = exit.code;
      markStopped(record, at);
      publishRuns(ctx);
      ctx.log.info("auto-coder run ended", {
        projectId,
        code: exit.code,
        signal: exit.signal,
        ...(exit.error === null ? {} : { error: exit.error }),
      });
      persist(ctx, projectId, record);
    });

    await writeRun(ctx, projectId, {
      state: "running",
      pid: record.pid,
      startedAt,
      stoppedAt: null,
      exitCode: null,
    });
    ctx.log.info("auto-coder run started", { projectId, pid: record.pid, cwd });
    return statusOf(projectId, record);
  };

  const start = (ctx: ServerCtx, projectId: string): Promise<AutoCoderRunStatus> => {
    const previous = startQueue.get(projectId) ?? Promise.resolve();
    const settled = previous.then(
      () => undefined,
      () => undefined,
    );
    const next = settled.then(() => startOnce(ctx, projectId));
    startQueue.set(
      projectId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  };

  const killOwned = (ctx: ServerCtx, projectId: string, record: RunRecord): void => {
    if (record.pid === null) return;
    try {
      options.killGroup(record.pid);
    } catch (cause) {
      ctx.log.info("auto-coder group was already gone", {
        projectId,
        pid: record.pid,
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const stop = async (ctx: ServerCtx, projectId: string): Promise<AutoCoderRunStatus> => {
    const record = records.get(projectId);
    if (record === undefined || !record.live) {
      throw autoCoderFailure({ kind: "not-running" }, `auto-coder: ${projectId} is not running`);
    }
    killOwned(ctx, projectId, record);
    markStopped(record, nowIso());
    publishRuns(ctx);
    ctx.log.info("auto-coder run stopped", { projectId });
    await writeRun(ctx, projectId, {
      state: "stopped",
      pid: null,
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt,
      exitCode: record.exitCode,
    });
    return statusOf(projectId, record);
  };

  return {
    start,
    stop,
    status: async (ctx, projectId) => {
      const record = records.get(projectId);
      return record === undefined
        ? await statusFromStore(ctx, projectId)
        : statusOf(projectId, record);
    },
    output: async (ctx, projectId, since) => {
      const record = records.get(projectId);
      if (record === undefined) {
        return {
          status: await statusFromStore(ctx, projectId),
          lines: [],
          next: 0,
          dropped: 0,
        };
      }
      const read = record.buffer.read(since);
      return { status: statusOf(projectId, record), ...read };
    },
    activate: async (ctx) => {
      const at = nowIso();
      for (const projectId of await readRunningProjectIds(ctx)) {
        const previous = await readRun(ctx, projectId);
        const buffer = createOutputBuffer();
        buffer.push("err", RESTART_NOTE, at);
        records.set(projectId, {
          buffer,
          state: "stopped",
          pid: null,
          startedAt: previous.startedAt,
          stoppedAt: at,
          exitCode: null,
          live: false,
          exited: true,
        });
        await writeRun(ctx, projectId, {
          state: "stopped",
          pid: null,
          startedAt: previous.startedAt,
          stoppedAt: at,
          exitCode: null,
        });
        ctx.log.info("auto-coder run was not resumed after a restart", { projectId });
      }
      publishRuns(ctx);
    },
    deactivate: async (ctx) => {
      const at = nowIso();
      const stopped: Array<string> = [];
      for (const [projectId, record] of records) {
        if (!record.live) continue;
        killOwned(ctx, projectId, record);
        markStopped(record, at);
        stopped.push(projectId);
        persist(ctx, projectId, record);
      }
      if (stopped.length > 0) {
        publishRuns(ctx);
        ctx.log.info("auto-coder stopped every run", { projects: stopped });
      }
      await settling;
    },
  };
};
