import { defineServerPlugin } from "@smart-tools/plugin-sdk/host";
import type { Json, ServerCtx } from "@smart-tools/plugin-sdk/host";

import type { AutoCoderProjectSettings, AutoCoderSettings } from "../contracts.ts";
import { defaultGigacodePath } from "../defaults.ts";
import { autoCoderFailure } from "../failures.ts";
import { AUTO_CODER_MIGRATIONS } from "./migrations.ts";
import { killProcessGroup, spawnRunWithNode } from "./process.ts";
import { findProject, resolveProjectView } from "./projectView.ts";
import { createAutoCoderRuntime, resolveShippedScriptPath } from "./runner.ts";
import { readSettings, writeProjectSettings, writeSettings } from "./store.ts";

const runtime = createAutoCoderRuntime({
  spawnRun: spawnRunWithNode,
  killGroup: (pid) => {
    killProcessGroup(pid, process.platform);
  },
  scriptPath: resolveShippedScriptPath(),
  platform: process.platform,
  baseEnv: process.env,
});

const asRecord = (payload: unknown): Record<string, unknown> =>
  typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const cursor = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

const projectIdOf = (payload: unknown): string => {
  const projectId = text(asRecord(payload)["projectId"]).trim();
  if (projectId === "") {
    throw autoCoderFailure(
      { kind: "unknown-project", projectId: "" },
      "auto-coder: the call carried no projectId",
    );
  }
  return projectId;
};

const settingsOf = (payload: unknown): AutoCoderSettings => {
  const record = asRecord(asRecord(payload)["settings"]);
  return {
    jiraToken: text(record["jiraToken"]),
    bitbucketToken: text(record["bitbucketToken"]),
    login: text(record["login"]),
    gigacodePath: text(record["gigacodePath"]),
  };
};

const projectSettingsOf = (payload: unknown): AutoCoderProjectSettings => {
  const record = asRecord(asRecord(payload)["settings"]);
  return {
    bitbucketProjectKey: text(record["bitbucketProjectKey"]),
    repoSlug: text(record["repoSlug"]),
    baseBranch: text(record["baseBranch"]),
    workspacePath: text(record["workspacePath"]),
    jiraNamespace: text(record["jiraNamespace"]),
    jql: text(record["jql"]),
  };
};

const settingsView = async (ctx: ServerCtx): Promise<Json> => ({
  settings: await readSettings(ctx),
  platform: process.platform,
  gigacodePathDefault: defaultGigacodePath(process.platform),
});

const projectView = async (ctx: ServerCtx, projectId: string): Promise<Json> => {
  const project = await findProject(ctx, projectId);
  if (project === null) {
    throw autoCoderFailure(
      { kind: "unknown-project", projectId },
      `auto-coder: no project ${projectId}`,
    );
  }
  return await resolveProjectView(ctx, project, process.platform);
};

export default defineServerPlugin({
  migrations: AUTO_CODER_MIGRATIONS,

  rpc: {
    "settings.get": async (_payload, ctx) => await settingsView(ctx),
    "settings.set": async (payload, ctx) => {
      await writeSettings(ctx, settingsOf(payload));
      return await settingsView(ctx);
    },

    "project.get": async (payload, ctx) => await projectView(ctx, projectIdOf(payload)),
    "project.set": async (payload, ctx) => {
      const projectId = projectIdOf(payload);
      if ((await findProject(ctx, projectId)) === null) {
        throw autoCoderFailure(
          { kind: "unknown-project", projectId },
          `auto-coder: no project ${projectId}`,
        );
      }
      await writeProjectSettings(ctx, projectId, projectSettingsOf(payload));
      return await projectView(ctx, projectId);
    },

    "run.start": async (payload, ctx) => await runtime.start(ctx, projectIdOf(payload)),
    "run.stop": async (payload, ctx) => await runtime.stop(ctx, projectIdOf(payload)),
    "run.status": async (payload, ctx) => await runtime.status(ctx, projectIdOf(payload)),
    "run.output": async (payload, ctx) =>
      await runtime.output(ctx, projectIdOf(payload), cursor(asRecord(payload)["since"])),
  },

  async activate(ctx) {
    await runtime.activate(ctx);
    ctx.log.info("auto-coder server half activated", {
      dataDir: ctx.paths.dataDir,
      script: resolveShippedScriptPath(),
    });
  },

  async deactivate(ctx) {
    await runtime.deactivate(ctx);
    ctx.log.info("auto-coder server half deactivated");
  },
});
