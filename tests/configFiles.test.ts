import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { JIRA_HOST } from "../src/constants.ts";
import {
  ENV_FILE_NAME,
  REPOS_FILE_NAME,
  projectConfigDir,
  renderEnvFile,
  renderReposFile,
  writeFileAtomic,
  writeProjectConfig,
} from "../src/server/configFiles.ts";

const temporaries: Array<string> = [];
const tempDir = (): string => {
  const dir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "auto-coder-files-"));
  temporaries.push(dir);
  return dir;
};

afterEach(() => {
  while (temporaries.length > 0) {
    NodeFs.rmSync(temporaries.pop() ?? "", { recursive: true, force: true });
  }
});

const SETTINGS = {
  jiraToken: "jira-token",
  bitbucketToken: "bb-token",
  login: "z.shterenberg",
  gigacodePath: "/opt/gigacode/bin/gigacode",
  repoSlug: "billing-api",
};

const PROJECT = {
  bitbucketProjectKey: "OPS",
  repoSlug: "billing-api",
  baseBranch: "develop",
  workspacePath: "/Users/me/projects/billing-api",
  jiraNamespace: "PAY",
  jql: 'project = %JIRA_NAMESPACE% AND component = %REPO_SLUG% AND status = "To Do"',
};

describe("renderEnvFile", () => {
  it("is six KEY=VALUE lines in this order, with one trailing newline", () => {
    expect(renderEnvFile(SETTINGS)).toBe(
      `JIRA_HOST=${JIRA_HOST}\n` +
        "JIRA_TOKEN=jira-token\n" +
        "BITBUCKET_TOKEN=bb-token\n" +
        "LOGIN_USERNAME=z.shterenberg\n" +
        "GIGACODE_PATH=/opt/gigacode/bin/gigacode\n" +
        "ASSIGNED_REPO_SLUG=billing-api\n",
    );
  });

  it("writes an empty value for an empty setting — the keys are always all six", () => {
    const text = renderEnvFile({
      jiraToken: "",
      bitbucketToken: "   ",
      login: "",
      gigacodePath: "",
      repoSlug: "",
    });
    expect(text.split("\n")).toHaveLength(7);
    expect(text).toContain("JIRA_TOKEN=\n");
    expect(text).toContain("BITBUCKET_TOKEN=   \n");
  });

  it("removes CR and LF from a value — a newline would forge a second key", () => {
    const text = renderEnvFile({ ...SETTINGS, jiraToken: "abc\nEVIL=1\r\nmore" });
    expect(text).toContain("JIRA_TOKEN=abcEVIL=1more\n");
    expect(text.split("\n")).toHaveLength(7);
  });
});

describe("renderReposFile", () => {
  it("is a one-entry array, pretty-printed, with the JQL substituted", () => {
    expect(renderReposFile(PROJECT)).toBe(
      `${JSON.stringify(
        [
          {
            projectKey: "OPS",
            repoSlug: "billing-api",
            baseBranch: "develop",
            workspacePath: "/Users/me/projects/billing-api",
            jql: 'project = PAY AND component = billing-api AND status = "To Do"',
          },
        ],
        null,
        2,
      )}\n`,
    );
  });

  it("never hands the script a surviving placeholder", () => {
    expect(renderReposFile({ ...PROJECT, jiraNamespace: "" })).not.toContain("%JIRA_NAMESPACE%");
  });
});

describe("writing", () => {
  it("leaves no temp file behind and replaces the old content whole", () => {
    const dir = tempDir();
    const file = NodePath.join(dir, "thing.txt");
    writeFileAtomic(file, "one\n");
    writeFileAtomic(file, "two\n");
    expect(NodeFs.readFileSync(file, "utf8")).toBe("two\n");
    expect(NodeFs.readdirSync(dir)).toEqual(["thing.txt"]);
  });

  it("writes both files into <dataDir>/projects/<id> and answers with that folder", () => {
    const dataDir = tempDir();
    const cwd = writeProjectConfig(dataDir, "proj-1", {
      envText: renderEnvFile(SETTINGS),
      reposText: renderReposFile(PROJECT),
    });
    expect(cwd).toBe(projectConfigDir(dataDir, "proj-1"));
    expect(NodeFs.readdirSync(cwd).sort()).toEqual([ENV_FILE_NAME, REPOS_FILE_NAME]);
    expect(NodeFs.readFileSync(NodePath.join(cwd, ENV_FILE_NAME), "utf8")).toBe(
      renderEnvFile(SETTINGS),
    );
  });

  it("gives each project its own folder", () => {
    const dataDir = tempDir();
    const a = writeProjectConfig(dataDir, "a", { envText: "A=1\n", reposText: "[]\n" });
    const b = writeProjectConfig(dataDir, "b", { envText: "B=1\n", reposText: "[]\n" });
    expect(a).not.toBe(b);
    expect(NodeFs.readFileSync(NodePath.join(a, ENV_FILE_NAME), "utf8")).toBe("A=1\n");
    expect(NodeFs.readFileSync(NodePath.join(b, ENV_FILE_NAME), "utf8")).toBe("B=1\n");
  });
});
