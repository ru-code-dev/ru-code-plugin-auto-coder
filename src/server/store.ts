import type { ServerCtx } from "@smart-tools/plugin-sdk/host";

import type {
  AutoCoderProjectSettings,
  AutoCoderRunState,
  AutoCoderSettings,
} from "../contracts.ts";

type SettingsRow = {
  readonly jira_token: string;
  readonly bitbucket_token: string;
  readonly login: string;
  readonly gigacode_path: string;
};

type ProjectRow = {
  readonly bitbucket_project_key: string;
  readonly repo_slug: string;
  readonly base_branch: string;
  readonly workspace_path: string;
  readonly jira_namespace: string;
  readonly jql: string;
};

type RunRow = {
  readonly state: string;
  readonly pid: number | null;
  readonly started_at: string | null;
  readonly stopped_at: string | null;
  readonly exit_code: number | null;
};

export const EMPTY_SETTINGS: AutoCoderSettings = {
  jiraToken: "",
  bitbucketToken: "",
  login: "",
  gigacodePath: "",
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export const readSettings = async (ctx: ServerCtx): Promise<AutoCoderSettings> => {
  const rows = await ctx.storage.query<SettingsRow>(
    "SELECT jira_token, bitbucket_token, login, gigacode_path FROM settings WHERE id = 1",
  );
  const row = rows[0];
  if (row === undefined) return EMPTY_SETTINGS;
  return {
    jiraToken: text(row.jira_token),
    bitbucketToken: text(row.bitbucket_token),
    login: text(row.login),
    gigacodePath: text(row.gigacode_path),
  };
};

export const writeSettings = async (ctx: ServerCtx, next: AutoCoderSettings): Promise<void> => {
  await ctx.storage.exec(
    `INSERT INTO settings(id, jira_token, bitbucket_token, login, gigacode_path)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       jira_token = excluded.jira_token,
       bitbucket_token = excluded.bitbucket_token,
       login = excluded.login,
       gigacode_path = excluded.gigacode_path`,
    [next.jiraToken, next.bitbucketToken, next.login, next.gigacodePath],
  );
};

export const readProjectSettings = async (
  ctx: ServerCtx,
  projectId: string,
): Promise<AutoCoderProjectSettings | null> => {
  const rows = await ctx.storage.query<ProjectRow>(
    `SELECT bitbucket_project_key, repo_slug, base_branch, workspace_path, jira_namespace, jql
       FROM project_settings WHERE project_id = ?`,
    [projectId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    bitbucketProjectKey: text(row.bitbucket_project_key),
    repoSlug: text(row.repo_slug),
    baseBranch: text(row.base_branch),
    workspacePath: text(row.workspace_path),
    jiraNamespace: text(row.jira_namespace),
    jql: text(row.jql),
  };
};

export const writeProjectSettings = async (
  ctx: ServerCtx,
  projectId: string,
  next: AutoCoderProjectSettings,
): Promise<void> => {
  await ctx.storage.exec(
    `INSERT INTO project_settings(
       project_id, bitbucket_project_key, repo_slug, base_branch, workspace_path, jira_namespace, jql)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       bitbucket_project_key = excluded.bitbucket_project_key,
       repo_slug = excluded.repo_slug,
       base_branch = excluded.base_branch,
       workspace_path = excluded.workspace_path,
       jira_namespace = excluded.jira_namespace,
       jql = excluded.jql`,
    [
      projectId,
      next.bitbucketProjectKey,
      next.repoSlug,
      next.baseBranch,
      next.workspacePath,
      next.jiraNamespace,
      next.jql,
    ],
  );
};

export type StoredRun = {
  readonly state: AutoCoderRunState;
  readonly pid: number | null;
  readonly startedAt: string | null;
  readonly stoppedAt: string | null;
  readonly exitCode: number | null;
};

export const STOPPED_RUN: StoredRun = {
  state: "stopped",
  pid: null,
  startedAt: null,
  stoppedAt: null,
  exitCode: null,
};

const number_ = (value: unknown): number | null => (typeof value === "number" ? value : null);

export const readRun = async (ctx: ServerCtx, projectId: string): Promise<StoredRun> => {
  const rows = await ctx.storage.query<RunRow>(
    "SELECT state, pid, started_at, stopped_at, exit_code FROM runs WHERE project_id = ?",
    [projectId],
  );
  const row = rows[0];
  if (row === undefined) return STOPPED_RUN;
  return {
    state: row.state === "running" ? "running" : "stopped",
    pid: number_(row.pid),
    startedAt: typeof row.started_at === "string" ? row.started_at : null,
    stoppedAt: typeof row.stopped_at === "string" ? row.stopped_at : null,
    exitCode: number_(row.exit_code),
  };
};

export const writeRun = async (
  ctx: ServerCtx,
  projectId: string,
  run: StoredRun,
): Promise<void> => {
  await ctx.storage.exec(
    `INSERT INTO runs(project_id, state, pid, started_at, stopped_at, exit_code)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       state = excluded.state,
       pid = excluded.pid,
       started_at = excluded.started_at,
       stopped_at = excluded.stopped_at,
       exit_code = excluded.exit_code`,
    [projectId, run.state, run.pid, run.startedAt, run.stoppedAt, run.exitCode],
  );
};

export const readRunningProjectIds = async (ctx: ServerCtx): Promise<ReadonlyArray<string>> => {
  const rows = await ctx.storage.query<{ readonly project_id: string }>(
    "SELECT project_id FROM runs WHERE state = 'running'",
  );
  return rows.map((row) => text(row.project_id)).filter((id) => id !== "");
};
