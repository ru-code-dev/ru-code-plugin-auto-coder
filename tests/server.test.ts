import * as NodeFs from "node:fs";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_BASE_BRANCH, PLATFORM_DEFAULT_GIGACODE_PATH } from "../src/constants.ts";
import type { AutoCoderProjectView, AutoCoderSettingsView } from "../src/contracts.ts";
import { decodeAutoCoderFailure } from "../src/failures.ts";
import { defaultGigacodePath } from "../src/defaults.ts";
import autoCoderServerPlugin from "../src/server/index.ts";
import { AUTO_CODER_MIGRATIONS } from "../src/server/migrations.ts";
import { makeHarness, project, type Harness } from "./helpers/harness.ts";

const manifest = JSON.parse(
  NodeFs.readFileSync(new URL("../src/plugin.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const packageJson = JSON.parse(
  NodeFs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

let open: Harness | null = null;

afterEach(() => {
  open?.close();
  open = null;
});

const harness = (): Harness => {
  const made = makeHarness([project("p1", "Billing", "/w/billing-api")]);
  open = made;
  return made;
};

const call = async <Result>(method: string, payload: unknown, made: Harness): Promise<Result> => {
  const handler = autoCoderServerPlugin.rpc?.[method];
  if (handler === undefined) throw new Error(`no handler for ${method}`);
  return (await handler(payload, made.ctx)) as Result;
};

const refusal = async (method: string, payload: unknown, made: Harness) => {
  try {
    await call(method, payload, made);
  } catch (error) {
    return decodeAutoCoderFailure(error);
  }
  throw new Error(`expected ${method} to be refused`);
};

describe("the plugin the host loads", () => {
  it("exports exactly the seams it needs and nothing else", () => {
    expect(Object.keys(autoCoderServerPlugin).sort()).toEqual([
      "activate",
      "deactivate",
      "migrations",
      "rpc",
    ]);
    expect(Object.keys(autoCoderServerPlugin.rpc ?? {})).toEqual([
      "settings.get",
      "settings.set",
      "project.get",
      "project.set",
      "run.start",
      "run.stop",
      "run.status",
      "run.output",
    ]);
  });

  it("has a manifest that matches the package, at the api version the host implements", () => {
    expect(manifest["id"]).toBe("auto-coder");
    expect(manifest["apiVersion"]).toBe(2);
    expect(manifest["version"]).toBe(packageJson["version"]);
    expect(AUTO_CODER_MIGRATIONS.map((migration) => migration.id)).toEqual([
      "001-settings",
      "002-project-settings",
      "003-runs",
    ]);
  });
});

describe("settings", () => {
  it("starts empty, with the platform's default offered as the placeholder", async () => {
    const made = harness();
    const view = await call<AutoCoderSettingsView>("settings.get", {}, made);
    expect(view.settings).toEqual({
      jiraToken: "",
      bitbucketToken: "",
      login: "",
      gigacodePath: "",
    });
    expect(view.gigacodePathDefault).toBe(defaultGigacodePath(view.platform));
    expect(Object.values(PLATFORM_DEFAULT_GIGACODE_PATH)).toContain(view.gigacodePathDefault);
  });

  it("writes all four fields and reads them back — one row, whatever the order of calls", async () => {
    const made = harness();
    await call("settings.set", { settings: { jiraToken: "jt", login: "me" } }, made);
    const view = await call<AutoCoderSettingsView>("settings.get", {}, made);
    expect(view.settings).toEqual({
      jiraToken: "jt",
      bitbucketToken: "",
      login: "me",
      gigacodePath: "",
    });
    expect(made.db.prepare("SELECT COUNT(*) AS n FROM settings").get()).toEqual({ n: 1 });
  });

  it("keeps an empty token EMPTY — a blank value is a legal answer, not a missing one", async () => {
    const made = harness();
    await call("settings.set", { settings: { jiraToken: "jt" } }, made);
    await call("settings.set", { settings: { jiraToken: "   " } }, made);
    const view = await call<AutoCoderSettingsView>("settings.get", {}, made);
    expect(view.settings.jiraToken).toBe("   ");
  });
});

describe("project", () => {
  it("answers the defaults computed from the project row", async () => {
    const made = harness();
    const view = await call<AutoCoderProjectView>("project.get", { projectId: "p1" }, made);
    expect(view.defaults).toEqual({
      bitbucketProjectKey: "",
      repoSlug: "billing-api",
      baseBranch: DEFAULT_BASE_BRANCH,
      workspacePath: "/w/billing-api",
      jiraNamespace: "",
      jql: 'project =  AND component = billing-api AND status = "To Do"',
    });
    expect(view.settings).toEqual(view.defaults);
    expect(view.projectId).toBe("p1");
  });

  it("saves a row and merges it over the defaults on the way back", async () => {
    const made = harness();
    await call(
      "project.set",
      {
        projectId: "p1",
        settings: {
          bitbucketProjectKey: "OPS",
          jiraNamespace: "PAY",
          jql: "assignee = currentUser()",
        },
      },
      made,
    );
    const view = await call<AutoCoderProjectView>("project.get", { projectId: "p1" }, made);
    expect(view.settings).toEqual({
      bitbucketProjectKey: "OPS",
      repoSlug: "billing-api",
      baseBranch: DEFAULT_BASE_BRANCH,
      workspacePath: "/w/billing-api",
      jiraNamespace: "PAY",
      jql: "assignee = currentUser()",
    });
  });

  it("refuses a project the app does not have, on both read and write", async () => {
    const made = harness();
    expect(await refusal("project.get", { projectId: "ghost" }, made)).toEqual({
      kind: "unknown-project",
      projectId: "ghost",
    });
    expect(await refusal("project.set", { projectId: "ghost", settings: {} }, made)).toEqual({
      kind: "unknown-project",
      projectId: "ghost",
    });
    expect(made.db.prepare("SELECT COUNT(*) AS n FROM project_settings").get()).toEqual({ n: 0 });
  });

  it("reads a call with no projectId as a call about a project that is not there", async () => {
    const made = harness();
    expect((await refusal("project.get", {}, made)).kind).toBe("unknown-project");
    expect((await refusal("run.status", undefined, made)).kind).toBe("unknown-project");
  });
});

describe("runs, where they refuse", () => {
  it("has nothing to stop before anything started", async () => {
    const made = harness();
    expect(await refusal("run.stop", { projectId: "p1" }, made)).toEqual({ kind: "not-running" });
  });

  it("serves a stopped status and an empty frame for a project that never ran", async () => {
    const made = harness();
    expect(await call("run.status", { projectId: "p1" }, made)).toMatchObject({
      state: "stopped",
      pid: null,
      lineCount: 0,
    });
    expect(await call("run.output", { projectId: "p1", since: 12 }, made)).toMatchObject({
      lines: [],
      next: 0,
      dropped: 0,
    });
  });

  it("refuses to start a project the app does not have — before it touches the disk", async () => {
    const made = harness();
    expect((await refusal("run.start", { projectId: "ghost" }, made)).kind).toBe("unknown-project");
    expect(NodeFs.existsSync(`${made.dataDir}/projects`)).toBe(false);
  });
});
