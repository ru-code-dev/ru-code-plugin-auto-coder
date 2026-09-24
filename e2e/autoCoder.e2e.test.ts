import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { expect, PluginHarness, test } from "@smart-tools/plugin-dev/e2e";

import { SCRIPT_FILE, SCRIPT_HEARTBEAT_LIMIT_FILE } from "../src/constants.ts";

const PANEL_ID = "auto-coder";

const BILLING = { id: "proj-billing", name: "Billing", cwd: "/w/billing-api" };
const PORTAL = { id: "proj-portal", name: "Portal", cwd: "/w/portal" };
const LEDGER = { id: "proj-ledger", name: "Ledger", cwd: "/w/ledger" };
const PROJECTS = [BILLING, PORTAL];

const withProjects = async (
  plugin: PluginHarness,
  projects: ReadonlyArray<{ id: string; name: string; cwd: string }> = PROJECTS,
): Promise<void> => {
  await plugin.setProjects(projects);
  await plugin.setSignal("projects", projects);
};

const configDir = (plugin: PluginHarness, projectId: string): string =>
  NodePath.join(plugin.handshake.dataDir, "projects", projectId);

const liveScriptPids = (): ReadonlyArray<number> => {
  const found = NodeChildProcess.spawnSync(
    "pgrep",
    ["-af", `assets/script/${SCRIPT_FILE.replace(".js", "[.]js")}`],
    { encoding: "utf8" },
  );
  return (found.stdout ?? "")
    .split("\n")
    .filter((row) => row.trim() !== "")
    .map((row) => Number.parseInt(row.trim().split(" ")[0] ?? "", 10))
    .filter((pid) => Number.isFinite(pid));
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("the panel opens with the app's panel header, a selector and two tabs — both gated on a project", async ({
  plugin,
}) => {
  await withProjects(plugin, []);
  const column = await plugin.openPanel(PANEL_ID);

  await expect(column.getByRole("heading", { name: "Auto Coder" })).toBeVisible();
  await expect(column.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(column.getByRole("button", { name: "Close Auto Coder" })).toBeVisible();

  await expect(column.getByRole("tab", { name: "Project" })).toBeDisabled();
  await expect(column.getByRole("tab", { name: "Run" })).toBeDisabled();
  await expect(column.locator('[data-testid="ac-no-projects"]')).toBeVisible();
  await expect(column.getByText("No projects")).toBeVisible();

  await withProjects(plugin);
  await expect(column.getByRole("tab", { name: "Project" })).toBeEnabled();
  await expect(column.locator('[data-testid="ac-project-form"]')).toBeVisible();
});

test("the header's close icon closes the panel (V2-15)", async ({ plugin }) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);
  await expect(column.getByRole("heading", { name: "Auto Coder" })).toBeVisible();

  await column.getByRole("button", { name: "Close Auto Coder" }).click();
  await expect(plugin.page.locator('[data-testid="pg-panel-column"]')).toBeHidden();
});

test("the gear opens the settings as a SECOND VIEW, and Back returns to the tabs", async ({
  plugin,
}) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);
  await expect(column.locator('[data-testid="ac-project-form"]')).toBeVisible();

  await column.getByRole("button", { name: "Settings" }).click();
  await expect(column.locator('[data-testid="ac-settings-view"]')).toBeVisible();
  await expect(column.getByRole("tab", { name: "Project" })).toBeHidden();
  await expect(column.getByRole("heading", { name: "Auto Coder" })).toBeVisible();

  await column.getByRole("button", { name: "Back" }).click();
  await expect(column.locator('[data-testid="ac-settings-view"]')).toBeHidden();
  await expect(column.getByRole("tab", { name: "Project" })).toBeVisible();
});

test("the gear form saves each field as it is left, and an empty path means the default", async ({
  plugin,
}) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("button", { name: "Settings" }).click();

  await expect(column.getByLabel("Jira host")).toHaveValue("https://jira.example.invalid");
  await expect(column.getByLabel("Jira host")).toHaveAttribute("readonly");
  await expect(column.locator('[data-testid="ac-settings-view"] [inert]')).toHaveClass(
    /opacity-50/,
  );

  await column.getByLabel("Jira token").fill("jira-secret");
  await column.getByLabel("Bitbucket token").fill("bb-secret");
  await column.getByLabel("Login").fill("z.shterenberg");
  await column.getByLabel("GigaCode path").fill("/custom/gigacode");
  await column.getByLabel("Jira token").click();

  await expect
    .poll(async () => (await plugin.invoke<{ settings: unknown }>("settings.get")).settings)
    .toEqual({
      jiraToken: "jira-secret",
      bitbucketToken: "bb-secret",
      login: "z.shterenberg",
      gigacodePath: "/custom/gigacode",
    });

  const view = await plugin.invoke<{ gigacodePathDefault: string }>("settings.get");
  await expect(column.getByLabel("GigaCode path")).toHaveAttribute(
    "placeholder",
    view.gigacodePathDefault,
  );
  await expect(column.getByRole("button", { name: "Use default" })).toHaveCount(0);
  await column.getByLabel("GigaCode path").fill("");
  await column.getByLabel("Jira token").click();
  await expect
    .poll(
      async () =>
        (await plugin.invoke<{ settings: { gigacodePath: string } }>("settings.get")).settings
          .gigacodePath,
    )
    .toBe("");
});

test("tab 1 shows the defaults computed from the project row, and the JQL follows the names", async ({
  plugin,
}) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);

  await expect(column.getByLabel("Repository")).toHaveValue("billing-api");
  await expect(column.getByLabel("Base branch")).toHaveValue("develop");
  await expect(column.getByLabel("Workspace folder")).toHaveValue("/w/billing-api");
  await expect(column.getByLabel("JQL")).toHaveValue(
    'project =  AND component = billing-api AND status = "To Do"',
  );

  await column.getByLabel("Jira namespace").fill("PAY");
  await expect(column.getByLabel("JQL")).toHaveValue(
    'project = PAY AND component = billing-api AND status = "To Do"',
  );
  await column.getByLabel("JQL").fill("assignee = currentUser()");
  await column.getByLabel("Jira namespace").fill("OPS");
  await expect(column.getByLabel("JQL")).toHaveValue("assignee = currentUser()");
});

test("«Выбрать…» opens the HOST's folder picker and saves what it answers (V2-33)", async ({
  plugin,
}) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);
  await column.locator('[data-testid="ac-project-select"]').click();
  await plugin.page.getByRole("option", { name: PORTAL.name }).click();
  await expect(column.getByLabel("Repository")).toHaveValue("portal");

  await column.getByRole("button", { name: "Choose a folder" }).click();
  const picker = plugin.page.locator('[data-testid="pg-picker"]');
  await expect(picker).toBeVisible();
  await picker.locator('[data-testid="pg-picker-entry-projects"]').click();
  await picker.locator('[data-testid="pg-picker-add"]').click();
  await expect(picker).toBeHidden();

  await expect(column.getByLabel("Workspace folder")).toHaveValue("/Users/me/projects");
  await expect
    .poll(
      async () =>
        (
          await plugin.invoke<{ settings: { workspacePath: string } }>("project.get", {
            projectId: PORTAL.id,
          })
        ).settings.workspacePath,
    )
    .toBe("/Users/me/projects");

  await column.getByRole("button", { name: "Choose a folder" }).click();
  await picker.locator('[data-testid="pg-picker-cancel"]').click();
  await expect(picker).toBeHidden();
  await expect(column.getByLabel("Workspace folder")).toHaveValue("/Users/me/projects");
});

test("the selector switches BOTH tabs' data", async ({ plugin }) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);

  await expect(column.getByLabel("Repository")).toHaveValue("billing-api");
  await column.locator('[data-testid="ac-project-select"]').click();
  await plugin.page.getByRole("option", { name: PORTAL.name }).click();
  await expect(column.getByLabel("Repository")).toHaveValue("portal");

  await column.getByRole("tab", { name: "Run" }).click();
  await expect(column.locator('[data-testid="ac-run-status"]')).toBeVisible();
  await column.locator('[data-testid="ac-project-select"]').click();
  await plugin.page.getByRole("option", { name: BILLING.name }).click();
  await expect(column.locator('[data-testid="ac-run-empty"]')).toBeVisible();
});

test("Start writes the two files, runs the script, and the pane fills with its output", async ({
  plugin,
}) => {
  await withProjects(plugin);
  await plugin.invoke("settings.set", {
    settings: {
      jiraToken: "jira-secret",
      bitbucketToken: "bb-secret",
      login: "z.shterenberg",
      gigacodePath: "/custom/gigacode",
    },
  });
  await plugin.invoke("project.set", {
    projectId: BILLING.id,
    settings: {
      bitbucketProjectKey: "OPS",
      repoSlug: "billing-api",
      baseBranch: "develop",
      workspacePath: "/w/billing-api",
      jiraNamespace: "PAY",
      jql: 'project = %JIRA_NAMESPACE% AND component = %REPO_SLUG% AND status = "To Do"',
    },
  });

  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();
  await expect(column.getByRole("button", { name: "Start" })).toBeEnabled();
  await column.getByRole("button", { name: "Start" }).click();

  await expect(column.locator('[data-testid="ac-run-toggle"]')).toHaveText("Stop");

  const dir = configDir(plugin, BILLING.id);
  expect(NodeFs.readFileSync(NodePath.join(dir, ".env"), "utf8")).toBe(
    "JIRA_HOST=https://jira.example.invalid\n" +
      "JIRA_TOKEN=jira-secret\n" +
      "BITBUCKET_TOKEN=bb-secret\n" +
      "LOGIN_USERNAME=z.shterenberg\n" +
      "GIGACODE_PATH=/custom/gigacode\n" +
      "ASSIGNED_REPO_SLUG=billing-api\n",
  );
  expect(NodeFs.readFileSync(NodePath.join(dir, "local-repos.json"), "utf8")).toBe(
    `${JSON.stringify(
      [
        {
          projectKey: "OPS",
          repoSlug: "billing-api",
          baseBranch: "develop",
          workspacePath: "/w/billing-api",
          jql: 'project = PAY AND component = billing-api AND status = "To Do"',
        },
      ],
      null,
      2,
    )}\n`,
  );

  const output = column.locator('[data-testid="ac-run-output"]');
  await expect(output).toContainText("=== .env ===", { timeout: 20_000 });
  await expect(output).toContainText("=== local-repos.json ===");
  await expect(output).toContainText("JIRA_TOKEN=jira-secret");
  await expect(output).toContainText("heartbeat #1", { timeout: 20_000 });
  await expect(output).toContainText("heartbeat #3", { timeout: 20_000 });

  await column.getByRole("button", { name: "Stop" }).click();
  await expect(column.locator('[data-testid="ac-run-toggle"]')).toHaveText("Start");
});

test("Stop takes the process GROUP down — the pid is gone from the machine", async ({ plugin }) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();
  await column.getByRole("button", { name: "Start" }).click();
  await expect(column.locator('[data-testid="ac-run-toggle"]')).toHaveText("Stop");

  const running = await plugin.invoke<{ pid: number }>("run.status", { projectId: BILLING.id });
  expect(running.pid).toBeGreaterThan(0);
  expect(alive(running.pid)).toBe(true);

  await column.getByRole("button", { name: "Stop" }).click();
  await expect(column.locator('[data-testid="ac-run-toggle"]')).toHaveText("Start");
  await expect.poll(() => alive(running.pid), { timeout: 10_000 }).toBe(false);
  await expect(column.getByRole("button", { name: "Start" })).toBeEnabled();
});

test("two Starts make ONE process, and the second is told why", async ({ plugin }) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();

  const [first, second] = await Promise.allSettled([
    plugin.invoke<{ pid: number }>("run.start", { projectId: BILLING.id }),
    plugin.invoke<{ pid: number }>("run.start", { projectId: BILLING.id }),
  ]);
  const started = first.status === "fulfilled" ? first.value : null;
  expect(started?.pid).toBeGreaterThan(0);
  expect(second.status).toBe("rejected");

  expect(liveScriptPids()).toHaveLength(1);
  await plugin.invoke("run.stop", { projectId: BILLING.id });
  await expect.poll(() => liveScriptPids().length, { timeout: 10_000 }).toBe(0);
});

test("the reads run only while the Run tab is mounted", async ({ plugin }) => {
  let frames = 0;
  plugin.page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : "";
      if (payload.includes('"run.output"')) frames += 1;
    });
  });
  await plugin.open();
  await withProjects(plugin);

  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();
  await column.getByRole("button", { name: "Start" }).click();
  await expect(column.locator('[data-testid="ac-run-toggle"]')).toHaveText("Stop");
  await expect.poll(() => frames, { timeout: 20_000 }).toBeGreaterThan(2);

  await column.getByRole("tab", { name: "Project" }).click();
  await expect(column.locator('[data-testid="ac-project-form"]')).toBeVisible();
  await plugin.page.waitForTimeout(1500);
  const settled = frames;
  await plugin.page.waitForTimeout(3000);
  expect(frames).toBe(settled);

  await column.getByRole("tab", { name: "Run" }).click();
  await expect.poll(() => frames, { timeout: 20_000 }).toBeGreaterThan(settled);
  await plugin.invoke("run.stop", { projectId: BILLING.id });
});

test("a script that ends BY ITSELF is recorded as stopped, with the exit line", async ({
  plugin,
}) => {
  await withProjects(plugin);
  await plugin.seedDataDir({
    [`projects/${BILLING.id}/${SCRIPT_HEARTBEAT_LIMIT_FILE}`]: "2",
  });

  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();
  await column.getByRole("button", { name: "Start" }).click();

  const output = column.locator('[data-testid="ac-run-output"]');
  await expect(output).toContainText("heartbeat #2", { timeout: 20_000 });
  await expect(output).toContainText("[auto-coder] exited with code 0", { timeout: 20_000 });
  await expect(column.locator('[data-testid="ac-run-status"]')).toContainText("exit code 0");
  await expect(column.getByRole("button", { name: "Start" })).toBeEnabled();
  await expect(column.getByRole("button", { name: "Stop" })).toHaveCount(0);

  await plugin.seedDataDir({ [`projects/${BILLING.id}/${SCRIPT_HEARTBEAT_LIMIT_FILE}`]: null });
});

test("while the connection is not ready, the tab asks for nothing and the button still follows the server", async ({
  plugin,
}) => {
  let frames = 0;
  plugin.page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : "";
      if (payload.includes('"run.output"')) frames += 1;
    });
  });
  await plugin.open();
  await withProjects(plugin);
  await plugin.setSignal("connection", "lost");

  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();
  await expect(column.locator('[data-testid="ac-run-output"]')).toBeVisible();
  await plugin.page.waitForTimeout(1500);
  expect(frames).toBe(0);
  await expect(column.getByRole("button", { name: "Start" })).toBeEnabled();

  await plugin.setSignal("connection", "ready");
  await expect.poll(() => frames, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(column.getByRole("button", { name: "Start" })).toBeEnabled();
});

test("closing the panel mid-run costs nothing — the pane is there when it opens again", async ({
  plugin,
}) => {
  const pageErrors: Array<string> = [];
  plugin.page.on("pageerror", (error) => pageErrors.push(error.message));
  await withProjects(plugin);

  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();
  await column.getByRole("button", { name: "Start" }).click();
  await expect(column.locator('[data-testid="ac-run-output"]')).toContainText("=== .env ===", {
    timeout: 20_000,
  });

  await plugin.closePanel();
  await expect(plugin.page.locator('[data-testid="pg-panel-column"]')).toBeHidden();
  await plugin.page.waitForTimeout(3000);

  const again = await plugin.openPanel(PANEL_ID);
  await expect(again.locator('[data-testid="ac-run-output"]')).toContainText("=== .env ===");
  await expect(again.locator('[data-testid="ac-run-toggle"]')).toHaveText("Stop");
  await again.getByRole("button", { name: "Stop" }).click();
  await expect(again.locator('[data-testid="ac-run-toggle"]')).toHaveText("Start");
  expect(pageErrors).toEqual([]);
});

test("two projects run AT ONCE, each in its own folder", async ({ plugin }) => {
  await withProjects(plugin);
  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();
  await column.getByRole("button", { name: "Start" }).click();
  await expect(column.locator('[data-testid="ac-run-toggle"]')).toHaveText("Stop");

  await column.locator('[data-testid="ac-project-select"]').click();
  await plugin.page.getByRole("option", { name: PORTAL.name }).click();
  await expect(column.getByRole("button", { name: "Start" })).toBeEnabled();
  await column.getByRole("button", { name: "Start" }).click();
  await expect(column.locator('[data-testid="ac-run-toggle"]')).toHaveText("Stop");

  expect(liveScriptPids()).toHaveLength(2);
  expect(NodeFs.existsSync(NodePath.join(configDir(plugin, BILLING.id), ".env"))).toBe(true);
  expect(NodeFs.existsSync(NodePath.join(configDir(plugin, PORTAL.id), ".env"))).toBe(true);

  await plugin.invoke("run.stop", { projectId: BILLING.id });
  await plugin.invoke("run.stop", { projectId: PORTAL.id });
  await expect.poll(() => liveScriptPids().length, { timeout: 10_000 }).toBe(0);
});

type Column = Awaited<ReturnType<PluginHarness["openPanel"]>>;

/** The pane's lines, as the user reads them. */
const paneLines = (column: Column): Promise<ReadonlyArray<string>> =>
  column.locator('[data-testid="ac-run-output"] > div').allInnerTexts();

const beats = (lines: ReadonlyArray<string>): ReadonlyArray<number> =>
  lines
    .filter((text) => text.startsWith("heartbeat #"))
    .map((text) => Number.parseInt(text.slice("heartbeat #".length), 10));

/** The `.env` line that names the project's repository — what tells one run's output from another. */
const slugLine = (plugin: PluginHarness, projectId: string): string =>
  NodeFs.readFileSync(NodePath.join(configDir(plugin, projectId), ".env"), "utf8")
    .split("\n")
    .find((text) => text.startsWith("ASSIGNED_REPO_SLUG=")) ?? "";

/**
 * The pane shows ONE project's run, while it prints: its own `.env` line and no other's, every line
 * once, and every heartbeat from #1 with none missing — after at least one more heartbeat landed.
 */
const expectOwnPane = async (column: Column, own: string, others: ReadonlyArray<string>) => {
  await expect.poll(async () => (await paneLines(column)).includes(own)).toBe(true);
  const seen = Math.max(0, ...beats(await paneLines(column)));
  await expect
    .poll(async () => Math.max(0, ...beats(await paneLines(column))), { timeout: 10_000 })
    .toBeGreaterThan(seen);
  const lines = await paneLines(column);
  expect(lines.filter((text) => text === own)).toHaveLength(1);
  for (const other of others) expect(lines).not.toContain(other);
  expect(lines.filter((text) => text === "=== .env ===")).toHaveLength(1);
  const numbers = beats(lines);
  expect(numbers).toEqual(numbers.map((_, index) => index + 1));
};

test("THREE projects print at once: switching A→B→C→A shows each pane only its own lines, each once (S81)", async ({
  plugin,
}) => {
  const three = [BILLING, PORTAL, LEDGER];
  await withProjects(plugin, three);
  for (const project of three) await plugin.invoke("run.start", { projectId: project.id });
  expect(liveScriptPids()).toHaveLength(3);
  const slugs = three.map((project) => slugLine(plugin, project.id));
  expect(new Set(slugs).size, "three different repositories").toBe(3);

  const column = await plugin.openPanel(PANEL_ID);
  await column.getByRole("tab", { name: "Run" }).click();
  const showsOnly = (index: number) =>
    expectOwnPane(
      column,
      slugs[index] ?? "",
      slugs.filter((_, other) => other !== index),
    );
  await showsOnly(0);
  for (const index of [1, 2, 0]) {
    await column.locator('[data-testid="ac-project-select"]').click();
    await plugin.page.getByRole("option", { name: three[index]?.name ?? "" }).click();
    await showsOnly(index);
  }

  for (const project of three) await plugin.invoke("run.stop", { projectId: project.id });
  await expect.poll(() => liveScriptPids().length, { timeout: 10_000 }).toBe(0);
});

test("two tabs on one project: both panes show every line once (S81)", async ({ plugin }) => {
  await withProjects(plugin);
  await plugin.invoke("run.start", { projectId: BILLING.id });
  const own = slugLine(plugin, BILLING.id);

  const first = await plugin.openPanel(PANEL_ID);
  await first.getByRole("tab", { name: "Run" }).click();
  const tabB = new PluginHarness(await plugin.page.context().newPage(), plugin.handshake);
  try {
    await tabB.open();
    await withProjects(tabB);
    const second = await tabB.openPanel(PANEL_ID);
    await second.getByRole("tab", { name: "Run" }).click();

    await expectOwnPane(first, own, []);
    await expectOwnPane(second, own, []);
  } finally {
    await tabB.page.close();
    await plugin.invoke("run.stop", { projectId: BILLING.id });
  }
  await expect.poll(() => liveScriptPids().length, { timeout: 10_000 }).toBe(0);
});

test("nothing of ours is left running", async ({ plugin }) => {
  expect(await plugin.status()).toMatchObject({ state: "loaded" });
  expect(liveScriptPids()).toEqual([]);
});
