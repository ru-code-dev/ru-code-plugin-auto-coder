import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { JIRA_HOST } from "../constants.ts";
import type { AutoCoderProjectSettings } from "../contracts.ts";
import { substituteJql } from "../defaults.ts";

export const ENV_FILE_NAME = ".env";
export const REPOS_FILE_NAME = "local-repos.json";

export const projectConfigDir = (dataDir: string, projectId: string): string =>
  NodePath.join(dataDir, "projects", projectId);

const envValue = (value: string): string => value.replaceAll("\r", "").replaceAll("\n", "");

export const renderEnvFile = (values: {
  readonly jiraToken: string;
  readonly bitbucketToken: string;
  readonly login: string;
  readonly gigacodePath: string;
  readonly repoSlug: string;
}): string => {
  const lines: ReadonlyArray<readonly [string, string]> = [
    ["JIRA_HOST", JIRA_HOST],
    ["JIRA_TOKEN", values.jiraToken],
    ["BITBUCKET_TOKEN", values.bitbucketToken],
    ["LOGIN_USERNAME", values.login],
    ["GIGACODE_PATH", values.gigacodePath],
    ["ASSIGNED_REPO_SLUG", values.repoSlug],
  ];
  return `${lines.map(([key, value]) => `${key}=${envValue(value)}`).join("\n")}\n`;
};

export const renderReposFile = (project: AutoCoderProjectSettings): string =>
  `${JSON.stringify(
    [
      {
        projectKey: project.bitbucketProjectKey,
        repoSlug: project.repoSlug,
        baseBranch: project.baseBranch,
        workspacePath: project.workspacePath,
        jql: substituteJql(project.jql, {
          jiraNamespace: project.jiraNamespace,
          repoSlug: project.repoSlug,
        }),
      },
    ],
    null,
    2,
  )}\n`;

export const writeFileAtomic = (file: string, text: string): void => {
  const temporary = `${file}.tmp`;
  NodeFs.writeFileSync(temporary, text, "utf8");
  NodeFs.renameSync(temporary, file);
};

export const writeProjectConfig = (
  dataDir: string,
  projectId: string,
  content: { readonly envText: string; readonly reposText: string },
): string => {
  const dir = projectConfigDir(dataDir, projectId);
  NodeFs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(NodePath.join(dir, ENV_FILE_NAME), content.envText);
  writeFileAtomic(NodePath.join(dir, REPOS_FILE_NAME), content.reposText);
  return dir;
};
