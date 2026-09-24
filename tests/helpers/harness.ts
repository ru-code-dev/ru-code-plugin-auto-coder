import type { DatabaseSync } from "node:sqlite";

import type { PluginProject, ServerCtx } from "@smart-tools/plugin-sdk/host";
import { makeSqliteServerCtx, type SqliteLogLine } from "@smart-tools/plugin-sdk/testing/node";

import { AUTO_CODER_MIGRATIONS } from "../../src/server/migrations.ts";

export type LogLine = SqliteLogLine;

export type Harness = {
  readonly ctx: ServerCtx;
  readonly db: DatabaseSync;
  readonly logs: ReadonlyArray<LogLine>;
  readonly published: ReadonlyArray<{ readonly name: string; readonly value: unknown }>;
  readonly dataDir: string;
  setProjects(projects: ReadonlyArray<PluginProject>): void;
  close(): void;
};

export const makeHarness = (projects: ReadonlyArray<PluginProject> = []): Harness => {
  let rows = projects;
  const sqlite = makeSqliteServerCtx({
    pluginId: "auto-coder",
    dataDir: "temp",
    cliConfigDir: null,
  });
  const ctx: ServerCtx = { ...sqlite.ctx, projects: { list: async () => rows } };
  sqlite.runMigrations(AUTO_CODER_MIGRATIONS);
  return {
    ctx,
    db: sqlite.db,
    logs: sqlite.logs,
    published: sqlite.published,
    dataDir: sqlite.dataDir,
    setProjects: (next) => {
      rows = next;
    },
    close: () => sqlite.close(),
  };
};

export const project = (id: string, name: string, cwd: string): PluginProject => ({
  id,
  name,
  cwd,
});
