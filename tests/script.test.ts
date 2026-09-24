import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { SCRIPT_FILE, SCRIPT_HEARTBEAT_LIMIT_FILE } from "../src/constants.ts";

const SCRIPT = NodePath.resolve(
  NodePath.dirname(new URL(import.meta.url).pathname),
  "../src/assets/script",
  SCRIPT_FILE,
);

const temporaries: Array<string> = [];
const workDir = (files: Readonly<Record<string, string>>): string => {
  const dir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "auto-coder-script-"));
  temporaries.push(dir);
  for (const [name, text] of Object.entries(files)) {
    NodeFs.writeFileSync(NodePath.join(dir, name), text, "utf8");
  }
  return dir;
};

afterEach(() => {
  while (temporaries.length > 0) {
    NodeFs.rmSync(temporaries.pop() ?? "", { recursive: true, force: true });
  }
});

const run = (cwd: string) =>
  NodeChildProcess.spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });

const ENV_TEXT = "JIRA_HOST=https://jira.example.invalid\nJIRA_TOKEN=\n";
const REPOS_TEXT = '[\n  {\n    "repoSlug": "billing-api"\n  }\n]\n';

describe("the placeholder script", () => {
  it("dumps both files VERBATIM under their banners, then beats", () => {
    const cwd = workDir({
      ".env": ENV_TEXT,
      "local-repos.json": REPOS_TEXT,
      [SCRIPT_HEARTBEAT_LIMIT_FILE]: "1",
    });
    const result = run(cwd);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`=== .env ===\n${ENV_TEXT}`);
    expect(result.stdout).toContain(`=== local-repos.json ===\n${REPOS_TEXT}`);
    expect(result.stdout).toMatch(/heartbeat #1 \d{4}-\d{2}-\d{2}T[\d:.]+Z/);
  });

  it("exits 1 with ONE clear line when a file it needs is missing", () => {
    const missingRepos = run(workDir({ ".env": ENV_TEXT }));
    expect(missingRepos.status).toBe(1);
    expect(missingRepos.stderr.trim()).toBe(
      `auto-coder: cannot start — local-repos.json missing in ${
        missingRepos.stderr.trim().split(" in ")[1] ?? ""
      }`,
    );
    expect(missingRepos.stdout).toBe("");

    const empty = run(workDir({}));
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain(".env and local-repos.json missing");
  });

  it("counts its beats up to the limit file and then ends BY ITSELF", () => {
    const cwd = workDir({
      ".env": ENV_TEXT,
      "local-repos.json": REPOS_TEXT,
      [SCRIPT_HEARTBEAT_LIMIT_FILE]: "2",
    });
    const result = run(cwd);
    expect(result.status).toBe(0);
    expect(result.stdout.match(/heartbeat #/g)).toHaveLength(2);
  });
});

describe("the script's shape, which its two module systems force", () => {
  const source = NodeFs.readFileSync(SCRIPT, "utf8");

  it("names the limit file the constants name — the one duplication, checked", () => {
    expect(source).toContain(`const HEARTBEAT_LIMIT_FILE = "${SCRIPT_HEARTBEAT_LIMIT_FILE}"`);
  });

  it("has no `import` and no `require`: the same bytes run as ESM and as CommonJS", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).toContain("process.getBuiltinModule");
  });
});
