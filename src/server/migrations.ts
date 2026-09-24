import type { Migration } from "@smart-tools/plugin-sdk/host";

export const AUTO_CODER_MIGRATIONS: ReadonlyArray<Migration> = [
  {
    id: "001-settings",
    sql: [
      `CREATE TABLE settings(
         id INTEGER PRIMARY KEY CHECK (id = 1),
         jira_token TEXT NOT NULL DEFAULT '',
         bitbucket_token TEXT NOT NULL DEFAULT '',
         login TEXT NOT NULL DEFAULT '',
         gigacode_path TEXT NOT NULL DEFAULT ''
       )`,
      "INSERT INTO settings(id) VALUES (1)",
    ],
  },
  {
    id: "002-project-settings",
    sql: `CREATE TABLE project_settings(
            project_id TEXT PRIMARY KEY,
            bitbucket_project_key TEXT NOT NULL DEFAULT '',
            repo_slug TEXT NOT NULL DEFAULT '',
            base_branch TEXT NOT NULL DEFAULT '',
            workspace_path TEXT NOT NULL DEFAULT '',
            jira_namespace TEXT NOT NULL DEFAULT '',
            jql TEXT NOT NULL DEFAULT ''
          )`,
  },
  {
    id: "003-runs",
    sql: `CREATE TABLE runs(
            project_id TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'stopped',
            pid INTEGER,
            started_at TEXT,
            stopped_at TEXT,
            exit_code INTEGER
          )`,
  },
];
