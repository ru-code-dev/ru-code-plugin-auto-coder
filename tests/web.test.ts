import { makeFakeWebCtx } from "@smart-tools/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { OUTPUT_BUFFER_LINES, RUN_OUTPUT_STATE } from "../src/constants.ts";
import { createOutputBuffer } from "../src/server/outputBuffer.ts";
import type { AutoCoderOutputFrame, AutoCoderProjectSettings } from "../src/contracts.ts";
import { resetAutoCoderLocale } from "../src/localization.ts";
import {
  followProject,
  followRun,
  followSettings,
  resetAutoCoderActions,
  saveProject,
  saveSettings,
  startRun,
  stopRun,
} from "../src/web/actions.ts";
import { describeFailure } from "../src/web/failureText.ts";
import {
  EMPTY_OUTPUT_VIEW,
  applyFrame,
  applyProjectField,
  clearOutputView,
  resolveSelectedProject,
  runToggle,
  serverRun,
  statusLineRun,
} from "../src/web/formLogic.ts";
import autoCoderWebPlugin, { AUTO_CODER_PANEL_ID } from "../src/web/index.tsx";
import {
  rememberCtx,
  resetAutoCoderCtx,
  resetAutoCoderStore,
  useAutoCoderStore,
} from "../src/web/store.ts";

const PROJECTS = [
  { id: "p1", name: "Billing", cwd: "/w/billing-api" },
  { id: "p2", name: "Portal", cwd: "/w/portal" },
];

const DRAFT: AutoCoderProjectSettings = {
  bitbucketProjectKey: "",
  repoSlug: "billing-api",
  baseBranch: "develop",
  workspacePath: "/w/billing-api",
  jiraNamespace: "",
  jql: 'project =  AND component = billing-api AND status = "To Do"',
};

const status = (over: Partial<AutoCoderOutputFrame["status"]> = {}) => ({
  projectId: "p1",
  state: "running" as const,
  pid: 42,
  startedAt: "2026-09-19T10:00:00.000Z",
  stoppedAt: null,
  exitCode: null,
  lineCount: 0,
  ...over,
});

const line = (seq: number, text: string) => ({
  seq,
  ts: "2026-09-19T10:00:00.000Z",
  stream: "out" as const,
  text,
});

beforeEach(() => {
  resetAutoCoderLocale();
  resetAutoCoderStore();
  resetAutoCoderCtx();
  resetAutoCoderActions();
});

const gate = () => {
  let release = (): void => undefined;
  const waited = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return { waited, release: () => release() };
};

const projectView = (projectId: string, settings = DRAFT) => ({
  projectId,
  settings,
  defaults: DRAFT,
  platform: "linux",
  gigacodePathDefault: "/usr/local/bin/gigacode",
});

describe("the seam the host reads", () => {
  it("contributes ONE panel, in the global slot, at a width the host will accept", () => {
    const { ctx } = makeFakeWebCtx({ pluginId: "auto-coder", locale: "en" });
    const panels = autoCoderWebPlugin.panels?.(ctx) ?? [];
    expect(panels).toHaveLength(1);
    const panel = panels[0];
    expect(panel?.id).toBe(AUTO_CODER_PANEL_ID);
    expect(panel?.title).toBe("Auto Coder");
    expect(panel?.mount).toBe("panel");
    expect(panel?.width).toBeGreaterThanOrEqual(320);
    expect(panel?.width).toBeLessThanOrEqual(960);
    expect(panel?.nav).toEqual({ label: "Auto Coder", icon: "Bot" });
    expect(typeof panel?.icon).toBe("string");
  });

  it("exports the panels seam and the two lifecycle hooks, and nothing else", () => {
    expect(Object.keys(autoCoderWebPlugin).sort()).toEqual(["activate", "deactivate", "panels"]);
  });

  it("localizes its own title and description — the host localizes nothing", () => {
    const { ctx } = makeFakeWebCtx({ pluginId: "auto-coder", locale: "ru" });
    const panel = autoCoderWebPlugin.panels?.(ctx)[0];
    expect(panel?.title).toBe("Авто Кодер");
    expect(panel?.description).toBe("Настроить и запустить авто-кодер для проекта");
  });

  it("returns the SAME component identity every time — the panel must not remount", () => {
    const { ctx } = makeFakeWebCtx({ pluginId: "auto-coder" });
    expect(autoCoderWebPlugin.panels?.(ctx)[0]?.render).toBe(
      autoCoderWebPlugin.panels?.(ctx)[0]?.render,
    );
  });
});

describe("which project the panel shows", () => {
  it("follows the open thread until the user picks one, then it is theirs", () => {
    expect(resolveSelectedProject(null, "p2", PROJECTS)).toBe("p2");
    expect(resolveSelectedProject("p1", "p2", PROJECTS)).toBe("p1");
  });

  it("opens on the first project when there is no thread", () => {
    expect(resolveSelectedProject(null, null, PROJECTS)).toBe("p1");
  });

  it("falls back when the chosen or active project is gone, and answers null for none", () => {
    expect(resolveSelectedProject("gone", "also-gone", PROJECTS)).toBe("p1");
    expect(resolveSelectedProject("gone", null, [])).toBeNull();
    expect(resolveSelectedProject(null, null, [])).toBeNull();
  });
});

describe("the project form", () => {
  it("re-substitutes the JQL while it is still the pattern's output", () => {
    const withNamespace = applyProjectField(DRAFT, "jiraNamespace", "PAY");
    expect(withNamespace.jql).toBe(
      'project = PAY AND component = billing-api AND status = "To Do"',
    );
    const withRepo = applyProjectField(withNamespace, "repoSlug", "payments");
    expect(withRepo.jql).toBe('project = PAY AND component = payments AND status = "To Do"');
  });

  it("leaves a HAND-EDITED query alone for ever after", () => {
    const edited = applyProjectField(DRAFT, "jql", "assignee = currentUser()");
    const renamed = applyProjectField(edited, "jiraNamespace", "PAY");
    expect(renamed.jql).toBe("assignee = currentUser()");
    expect(applyProjectField(renamed, "repoSlug", "payments").jql).toBe("assignee = currentUser()");
  });

  it("does not touch the query for a field the query is not written from", () => {
    expect(applyProjectField(DRAFT, "baseBranch", "main").jql).toBe(DRAFT.jql);
    expect(applyProjectField(DRAFT, "workspacePath", "/elsewhere").workspacePath).toBe(
      "/elsewhere",
    );
  });
});

describe("the button's server state (S73 F1)", () => {
  const stale = status({ state: "running", pid: 42 });

  it("a summary that omits the project is NOT running, whatever the last frame said", () => {
    expect(serverRun({}, "p1", stale)).toBeNull();
    expect(runToggle(serverRun({}, "p1", stale), false)).toEqual({
      action: "start",
      disabled: false,
    });
    expect(serverRun({ p2: status({ projectId: "p2" }) }, "p1", stale)).toBeNull();
  });

  it("a summary that has the project is the state, over the frame", () => {
    const live = status({ state: "stopped", pid: null });
    expect(serverRun({ p1: live }, "p1", stale)).toBe(live);
  });

  it("no summary yet falls back to the frame's durable status", () => {
    expect(serverRun(undefined, "p1", stale)).toBe(stale);
    expect(runToggle(serverRun(undefined, "p1", stale), false).action).toBe("stop");
  });

  it("the status line keeps the frame's record when the summary omits the project", () => {
    expect(statusLineRun({}, "p1", stale)).toBe(stale);
    const live = status({ pid: 7 });
    expect(statusLineRun({ p1: live }, "p1", stale)).toBe(live);
  });
});

describe("catching up after a dropped read (S71 F2, V2-59 query)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const frame = (seqs: ReadonlyArray<number>, next: number): AutoCoderOutputFrame => ({
    status: status({ state: "stopped", lineCount: 2 }),
    lines: seqs.map((seq) => line(seq, `line ${String(seq)}`)),
    next,
    dropped: 0,
  });

  it("a read dropped under the socket is read again when the connection is back", async () => {
    const fake = makeFakeWebCtx({ pluginId: "auto-coder" });
    rememberCtx(fake.ctx);
    fake.setState(RUN_OUTPUT_STATE, { p1: status({ state: "stopped", lineCount: 2 }) });
    const unfollow = followRun("p1");
    expect(fake.queries.map((round) => round.cause)).toEqual(["subscribe"]);

    fake.connection.set("lost");
    fake.setState(RUN_OUTPUT_STATE, { p1: status({ state: "stopped", lineCount: 2 }) });
    await settle();
    expect(useAutoCoderStore.getState().runFailure).toEqual({ kind: "transport" });
    expect(fake.queries).toHaveLength(1);

    fake.connection.set("ready");
    expect(fake.queries.map((round) => [round.cause, round.input])).toEqual([
      ["subscribe", { projectId: "p1", since: 0 }],
      ["reconnect", { projectId: "p1", since: 0 }],
    ]);
    fake.answerQuery("run.output", frame([1, 2], 2));
    await settle();
    expect(useAutoCoderStore.getState().output.lines.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(useAutoCoderStore.getState().runFailure).toBeNull();

    fake.connection.set("lost");
    fake.connection.set("ready");
    expect(fake.queries.at(-1)?.input).toEqual({ projectId: "p1", since: 2 });
    fake.answerQuery("run.output", frame([], 2));
    await settle();
    expect(useAutoCoderStore.getState().output.lines.map((entry) => entry.seq)).toEqual([1, 2]);
    unfollow();
    expect(fake.activeQueries).toBe(0);
  });

  it("nothing is read while the connection is down, and the mount's read goes out ONCE (S69 F-6a)", async () => {
    const fake = makeFakeWebCtx({ pluginId: "auto-coder", connection: "lost" });
    rememberCtx(fake.ctx);
    const unfollow = followRun("p1");
    fake.setState(RUN_OUTPUT_STATE, { p1: status({ state: "stopped", lineCount: 2 }) });
    await settle();
    expect(fake.queries).toHaveLength(0);
    fake.connection.set("ready");
    await settle();
    expect(fake.queries.map((round) => round.cause)).toEqual(["subscribe"]);
    fake.answerQuery("run.output", frame([1, 2], 2));
    await settle();
    expect(useAutoCoderStore.getState().output.lines).toHaveLength(2);
    expect(fake.queries.map((round) => [round.cause, round.input])).toEqual([
      ["subscribe", { projectId: "p1", since: 0 }],
      ["refresh", { projectId: "p1", since: 2 }],
    ]);
    unfollow();
  });

  it("a good read EQUAL to the frame held still clears the failure line (S65 gap 1)", async () => {
    const fake = makeFakeWebCtx({ pluginId: "auto-coder" });
    rememberCtx(fake.ctx);
    const unfollow = followRun("p1");
    fake.answerQuery("run.output", frame([], 0));
    await settle();
    fake.connection.set("lost");
    fake.connection.set("ready");
    fake.failQuery("run.output");
    await settle();
    expect(useAutoCoderStore.getState().runFailure).not.toBeNull();
    fake.connection.set("lost");
    fake.connection.set("ready");
    fake.answerQuery("run.output", frame([], 0));
    await settle();
    expect(useAutoCoderStore.getState().runFailure).toBeNull();
    unfollow();
  });
});

describe("a new run's first line reaches the pane (S78 F2)", () => {
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("the pane shows the first line of a run that prints once and then stays quiet", async () => {
    const OLD = "2026-09-19T09:00:00.000Z";
    const NEW = "2026-09-19T12:00:00.000Z";
    let record: { readonly buffer: ReturnType<typeof createOutputBuffer> } | null = null;
    const statusNow = () =>
      record === null
        ? status({ state: "stopped", pid: null, startedAt: OLD, stoppedAt: OLD, exitCode: 0 })
        : status({ startedAt: NEW, lineCount: record.buffer.total });
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "run.output": (payload) => {
          const { since } = payload as { readonly since: number };
          if (record === null) return { status: statusNow(), lines: [], next: 0, dropped: 0 };
          return { status: statusNow(), ...record.buffer.read(since) };
        },
      },
    });
    rememberCtx(fake.ctx);
    useAutoCoderStore.setState({
      output: { lines: [], since: 0, dropped: 0, startedAt: OLD },
    });
    const unfollow = followRun("p1");
    await settle();
    expect(useAutoCoderStore.getState().output).toMatchObject({ since: 0, startedAt: OLD });

    record = { buffer: createOutputBuffer() };
    record.buffer.push("out", "starting the job", NEW);
    fake.setState(RUN_OUTPUT_STATE, { p1: statusNow() });
    await settle();

    expect(
      useAutoCoderStore.getState().output.lines.map((entry) => entry.text),
      "the run's first line, which the summary says exists",
    ).toEqual(["starting the job"]);
    unfollow();
  });
});

describe("the forms' reads are queries (S79)", () => {
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const settingsView = (jiraToken: string) => ({
    settings: { jiraToken, bitbucketToken: "", login: "", gigacodePath: "" },
    platform: "linux",
    gigacodePathDefault: "/usr/local/bin/gigacode",
  });

  it("settings: nothing while down, one read on open, a reconnect re-read that never re-types the form", async () => {
    let server = settingsView("from-server");
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      connection: "lost",
      rpc: { "settings.get": () => server },
    });
    rememberCtx(fake.ctx);
    const stop = followSettings();
    await settle();
    expect(fake.queries, "no read while the connection is down").toEqual([]);
    fake.connection.set("ready");
    await settle();
    expect(fake.queries.map((round) => round.cause)).toEqual(["subscribe"]);
    expect(useAutoCoderStore.getState().settings?.jiraToken).toBe("from-server");

    useAutoCoderStore.getState().settingsDraftChanged("jiraToken", "typing…");
    server = settingsView("another-tab");
    fake.connection.set("lost");
    fake.connection.set("ready");
    await settle();
    expect(fake.queries.map((round) => round.cause)).toEqual(["subscribe", "reconnect"]);
    expect(useAutoCoderStore.getState().settings?.jiraToken, "the form is the user's").toBe(
      "typing…",
    );
    stop();
  });

  it("project: one read on open, re-read on reconnect, the draft kept", async () => {
    let repoSlug = "billing-api";
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: { "project.get": () => projectView("p1", { ...DRAFT, repoSlug }) },
    });
    rememberCtx(fake.ctx);
    const stop = followProject("p1");
    await settle();
    expect(useAutoCoderStore.getState().projectDraft?.repoSlug).toBe("billing-api");
    useAutoCoderStore.getState().projectDraftChanged("baseBranch", "feature");
    repoSlug = "renamed-elsewhere";
    fake.connection.set("lost");
    fake.connection.set("ready");
    await settle();
    expect(fake.queries.map((round) => round.cause)).toEqual(["subscribe", "reconnect"]);
    expect(useAutoCoderStore.getState().project?.settings.repoSlug, "the server's view").toBe(
      "renamed-elsewhere",
    );
    expect(useAutoCoderStore.getState().projectDraft?.baseBranch, "the user's draft").toBe(
      "feature",
    );
    stop();
  });
});

describe("each line once, whichever road a frame takes (S79)", () => {
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const frameOf = (seqs: ReadonlyArray<number>, next: number): AutoCoderOutputFrame => ({
    status: status({ lineCount: next }),
    lines: seqs.map((seq) => line(seq, `line ${String(seq)}`)),
    next,
    dropped: 0,
  });

  it("applyFrame: the same frame twice appends nothing; an older frame after a newer one changes nothing", () => {
    const once = applyFrame(EMPTY_OUTPUT_VIEW, frameOf([1, 2], 2));
    expect(applyFrame(once, frameOf([1, 2], 2))).toBe(once);
    const later = applyFrame(once, frameOf([3], 3));
    expect(applyFrame(later, frameOf([1, 2], 2))).toBe(later);
    expect(later.lines.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it("a round that CHANGED the value reaches the listener and the refresh() answer — appended once", async () => {
    let printed = 2;
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "run.output": (payload) => {
          const since = (payload as { readonly since: number }).since;
          const seqs = Array.from({ length: printed - since }, (_, index) => since + index + 1);
          return frameOf(seqs, printed);
        },
      },
    });
    rememberCtx(fake.ctx);
    const unfollow = followRun("p1");
    await settle();
    printed = 4;
    fake.setState(RUN_OUTPUT_STATE, { p1: status({ lineCount: 4 }) });
    await settle();
    expect(useAutoCoderStore.getState().output.lines.map((entry) => entry.seq)).toEqual([
      1, 2, 3, 4,
    ]);
    unfollow();
  });

  it("the panel closed and reopened: the lines are kept and the reopen reads ONCE", async () => {
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: { "run.output": () => frameOf([1, 2], 2) },
    });
    rememberCtx(fake.ctx);
    const first = followRun("p1");
    await settle();
    first();
    expect(useAutoCoderStore.getState().output.lines).toHaveLength(2);
    const before = fake.queries.length;
    const again = followRun("p1");
    await settle();
    expect(fake.queries.length - before, "one history read on reopen").toBe(1);
    expect(fake.queries.at(-1)?.input).toEqual({ projectId: "p1", since: 2 });
    expect(useAutoCoderStore.getState().output.lines.map((entry) => entry.seq)).toEqual([1, 2]);
    again();
  });
});

describe("the output pane", () => {
  it("appends a frame and moves the cursor", () => {
    const view = applyFrame(EMPTY_OUTPUT_VIEW, {
      status: status(),
      lines: [line(1, "a"), line(2, "b")],
      next: 2,
      dropped: 0,
    });
    expect(view.lines.map((row) => row.text)).toEqual(["a", "b"]);
    expect(view.since).toBe(2);
    expect(view.startedAt).toBe("2026-09-19T10:00:00.000Z");
  });

  it("adopts the FIRST frame it sees rather than treating it as a different run", () => {
    expect(
      applyFrame(EMPTY_OUTPUT_VIEW, {
        status: status(),
        lines: [line(1, "a")],
        next: 1,
        dropped: 0,
      }).lines,
    ).toHaveLength(1);
  });

  it("starts over when the frame belongs to ANOTHER run", () => {
    const first = applyFrame(EMPTY_OUTPUT_VIEW, {
      status: status(),
      lines: [line(1, "a")],
      next: 1,
      dropped: 0,
    });
    const second = applyFrame(first, {
      status: status({ startedAt: "2026-09-19T11:00:00.000Z" }),
      lines: [line(4, "stale")],
      next: 4,
      dropped: 0,
    });
    expect(second.lines).toEqual([]);
    expect(second.since).toBe(0);
    expect(second.startedAt).toBe("2026-09-19T11:00:00.000Z");
  });

  it("counts what the server's ring dropped, and never holds more than the ring does", () => {
    const flooded = applyFrame(EMPTY_OUTPUT_VIEW, {
      status: status(),
      lines: Array.from({ length: OUTPUT_BUFFER_LINES + 10 }, (_value, index) =>
        line(index + 1, `line ${String(index)}`),
      ),
      next: OUTPUT_BUFFER_LINES + 10,
      dropped: 7,
    });
    expect(flooded.lines).toHaveLength(OUTPUT_BUFFER_LINES);
    expect(flooded.lines[0]?.text).toBe("line 10");
    expect(flooded.dropped).toBe(7);
  });

  it("«Очистить вид» forgets the lines and keeps the cursor — the server keeps its buffer", () => {
    const view = applyFrame(EMPTY_OUTPUT_VIEW, {
      status: status(),
      lines: [line(1, "a")],
      next: 1,
      dropped: 0,
    });
    expect(clearOutputView(view)).toEqual({ ...view, lines: [] });
  });
});

describe("the calls the panel makes", () => {
  it("loads a project and keeps the draft the form edits", async () => {
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "project.get": () => ({
          projectId: "p1",
          settings: DRAFT,
          defaults: DRAFT,
          platform: "linux",
          gigacodePathDefault: "/usr/local/bin/gigacode",
        }),
      },
    });
    rememberCtx(fake.ctx);
    const stop = followProject("p1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useAutoCoderStore.getState().projectDraft).toEqual(DRAFT);
    expect(useAutoCoderStore.getState().gigacodePathDefault).toBe("/usr/local/bin/gigacode");
    expect(fake.queries.map((round) => [round.method, round.input])).toEqual([
      ["project.get", { projectId: "p1" }],
    ]);
    stop();
  });

  it("saves the draft the user edited, not the one the server last sent", async () => {
    const saved: Array<unknown> = [];
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "project.get": () => ({
          projectId: "p1",
          settings: DRAFT,
          defaults: DRAFT,
          platform: "linux",
          gigacodePathDefault: "",
        }),
        "project.set": (payload) => {
          saved.push(payload);
          return {
            projectId: "p1",
            settings: DRAFT,
            defaults: DRAFT,
            platform: "linux",
            gigacodePathDefault: "",
          };
        },
      },
    });
    rememberCtx(fake.ctx);
    const stop = followProject("p1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    useAutoCoderStore.getState().projectDraftChanged("baseBranch", "main");
    await saveProject();
    expect(saved).toEqual([{ projectId: "p1", settings: { ...DRAFT, baseBranch: "main" } }]);
  });

  it("turns a rejection into a TYPED failure with the plugin's own sentence", async () => {
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "run.start": () => {
          throw Object.assign(new Error("boom"), {
            _tag: "PluginRpcError",
            reason: "plugin-failed",
            data: { kind: "script-missing", path: "/x/auto-coder.js" },
          });
        },
      },
    });
    rememberCtx(fake.ctx);
    await startRun("p1");
    const failure = useAutoCoderStore.getState().runFailure;
    expect(failure).toEqual({ kind: "script-missing", path: "/x/auto-coder.js" });
    expect(failure === null ? "" : describeFailure(failure)).toContain("/x/auto-coder.js");
    expect(useAutoCoderStore.getState().runBusy).toBe(false);
  });

  it("reads a dropped socket as 'no connection', never as a plugin fault", async () => {
    const fake = makeFakeWebCtx({ pluginId: "auto-coder", rpc: {} });
    rememberCtx(fake.ctx);
    await stopRun("p1");
    expect(useAutoCoderStore.getState().runFailure).toEqual({
      kind: "unavailable",
      detail: "auto-coder.run.stop",
    });
    expect(describeFailure({ kind: "transport" })).toBe("No connection to the server.");
  });

  it("a fetch that brings nothing new changes no state and renders nothing", async () => {
    let answer: AutoCoderOutputFrame = {
      status: status({ lineCount: 2 }),
      lines: [line(1, "one"), line(2, "two")],
      next: 2,
      dropped: 0,
    };
    const fake = makeFakeWebCtx({ pluginId: "auto-coder", rpc: { "run.output": () => answer } });
    rememberCtx(fake.ctx);
    const unfollow = followRun("p1");
    const readAgain = async (): Promise<void> => {
      fake.connection.set("lost");
      fake.connection.set("ready");
      for (let turn = 0; turn < 3; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useAutoCoderStore.getState().output.lines).toHaveLength(2);

    answer = { status: status({ lineCount: 2 }), lines: [], next: 2, dropped: 0 };
    const before = useAutoCoderStore.getState();
    let renders = 0;
    const stop = useAutoCoderStore.subscribe(() => {
      renders += 1;
    });
    await readAgain();
    stop();
    expect(useAutoCoderStore.getState()).toBe(before);
    expect(renders).toBe(0);

    answer = { status: status({ lineCount: 3 }), lines: [line(3, "three")], next: 3, dropped: 0 };
    await readAgain();
    expect(useAutoCoderStore.getState().output.lines.map((entry) => entry.text)).toEqual([
      "one",
      "two",
      "three",
    ]);
    unfollow();
  });

  it("two summary moves while a fetch is in flight append each line ONCE (S65 F4)", async () => {
    const printed = [line(1, "one"), line(2, "two"), line(3, "three")];
    const onTheWire = gate();
    let fetches = 0;
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "run.output": async (payload) => {
          fetches += 1;
          const since = (payload as { readonly since: number }).since;
          await onTheWire.waited;
          const lines = printed.filter((entry) => entry.seq > since);
          return {
            status: status({ lineCount: printed.length }),
            lines,
            next: printed.length,
            dropped: 0,
          } satisfies AutoCoderOutputFrame;
        },
      },
    });
    rememberCtx(fake.ctx);
    const unfollow = followRun("p1");

    fake.setState(RUN_OUTPUT_STATE, { p1: status({ lineCount: 2 }) });
    fake.setState(RUN_OUTPUT_STATE, { p1: status({ lineCount: 3 }) });
    expect(fetches).toBe(1);
    onTheWire.release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAutoCoderStore.getState().output.lines.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(fetches).toBe(2);
    unfollow();
  });

  it("a good fetch after a FAILED one clears the failure even when it brings nothing new", async () => {
    let answer: "first" | "fail" | "same" = "first";
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "run.output": () => {
          if (answer === "fail") {
            throw Object.assign(new Error("down"), { _tag: "PluginRpcError", reason: "transport" });
          }
          return {
            status: status({ lineCount: 1 }),
            lines: answer === "first" ? [line(1, "one")] : [],
            next: 1,
            dropped: 0,
          } satisfies AutoCoderOutputFrame;
        },
      },
    });
    rememberCtx(fake.ctx);
    const unfollow = followRun("p1");
    const readAgain = async (): Promise<void> => {
      fake.connection.set("lost");
      fake.connection.set("ready");
      for (let turn = 0; turn < 3; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useAutoCoderStore.getState().output.lines).toHaveLength(1);

    answer = "fail";
    await readAgain();
    expect(useAutoCoderStore.getState().runFailure).not.toBeNull();

    answer = "same";
    await readAgain();
    expect(useAutoCoderStore.getState().runFailure).toBeNull();
    expect(useAutoCoderStore.getState().output.lines).toHaveLength(1);
    unfollow();
  });

  it("a daemon that publishes on every round: Stop is clickable, sends the stop rpc, and Start returns when the server reports stopped (S68 F1)", async () => {
    let printed = 0;
    let stopped = false;
    const stopCalls: Array<unknown> = [];
    const stopOnTheWire = gate();
    const flush = async (): Promise<void> => {
      for (let turn = 0; turn < 10; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "run.start": () => {
          fake.setState(RUN_OUTPUT_STATE, { p1: status({ lineCount: 0 }) });
          return status({ lineCount: 0 });
        },
        "run.output": async (payload) => {
          const since = (payload as { readonly since: number }).since;
          await new Promise((resolve) => setTimeout(resolve, 0));
          printed += 1;
          const lines = Array.from({ length: printed - since }, (_, index) =>
            line(since + index + 1, `chunk ${String(since + index + 1)}`),
          );
          if (!stopped) fake.setState(RUN_OUTPUT_STATE, { p1: status({ lineCount: printed + 1 }) });
          return {
            status: status({ lineCount: printed }),
            lines,
            next: printed,
            dropped: 0,
          } satisfies AutoCoderOutputFrame;
        },
        "run.stop": async (payload) => {
          stopCalls.push(payload);
          await stopOnTheWire.waited;
          stopped = true;
          const done = status({ state: "stopped", pid: null, lineCount: printed });
          fake.setState(RUN_OUTPUT_STATE, { p1: done });
          return done;
        },
      },
    });
    rememberCtx(fake.ctx);
    const unfollow = followRun("p1");
    const button = () =>
      runToggle(
        serverRun(
          fake.ctx.state(RUN_OUTPUT_STATE).get() as never,
          "p1",
          useAutoCoderStore.getState().run,
        ),
        useAutoCoderStore.getState().runBusy,
      );
    try {
      expect(button()).toEqual({ action: "start", disabled: false });
      await startRun("p1");
      await flush();
      expect(printed).toBeGreaterThan(2);
      expect(button()).toEqual({ action: "stop", disabled: false });

      const stopping = stopRun("p1");
      await flush();
      expect(stopCalls).toEqual([{ projectId: "p1" }]);
      expect(button()).toEqual({ action: "stop", disabled: true });

      stopOnTheWire.release();
      await stopping;
      await flush();
      expect(button()).toEqual({ action: "start", disabled: false });
    } finally {
      stopped = true;
      stopOnTheWire.release();
      unfollow();
      await flush();
    }
  });

  it("a NEW run empties the pane — the lines belong to the process that just ended", async () => {
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "run.output": () =>
          ({
            status: status({ startedAt: "2026-09-19T12:00:00.000Z", lineCount: 0 }),
            lines: [],
            next: 0,
            dropped: 0,
          }) satisfies AutoCoderOutputFrame,
      },
    });
    rememberCtx(fake.ctx);
    useAutoCoderStore.setState({
      output: {
        lines: [line(1, "old")],
        since: 1,
        dropped: 2,
        startedAt: "2026-09-19T10:00:00.000Z",
      },
    });
    const unfollow = followRun("p1");
    fake.setState(RUN_OUTPUT_STATE, {
      p1: status({ startedAt: "2026-09-19T12:00:00.000Z", lineCount: 0 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useAutoCoderStore.getState().output).toEqual({
      lines: [],
      since: 0,
      dropped: 0,
      startedAt: "2026-09-19T12:00:00.000Z",
    });
    unfollow();
  });

  it("a save's answer never TYPES into the form the user is still using", async () => {
    const held = gate();
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "settings.set": async () => {
          await held.waited;
          return {
            settings: { jiraToken: "jira", bitbucketToken: "", login: "", gigacodePath: "" },
            platform: "linux",
            gigacodePathDefault: "/usr/local/bin/gigacode",
          };
        },
      },
    });
    rememberCtx(fake.ctx);
    useAutoCoderStore.setState({
      settings: { jiraToken: "jira", bitbucketToken: "", login: "", gigacodePath: "" },
    });

    const saving = saveSettings();
    useAutoCoderStore.getState().settingsDraftChanged("bitbucketToken", "bb-secret");
    useAutoCoderStore.getState().settingsDraftChanged("login", "me");
    held.release();
    await saving;

    expect(useAutoCoderStore.getState().settings).toEqual({
      jiraToken: "jira",
      bitbucketToken: "bb-secret",
      login: "me",
      gigacodePath: "",
    });
    expect(useAutoCoderStore.getState().gigacodePathDefault).toBe("/usr/local/bin/gigacode");
  });

  it("drops an answer for a project the panel has already left", async () => {
    const held = gate();
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "project.get": async (payload) => {
          const projectId = (payload as { readonly projectId: string }).projectId;
          if (projectId === "p1") await held.waited;
          return projectView(projectId, { ...DRAFT, repoSlug: projectId });
        },
      },
    });
    rememberCtx(fake.ctx);

    const leaveP1 = followProject("p1");
    leaveP1();
    const stopP2 = followProject("p2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    held.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopP2();

    expect(useAutoCoderStore.getState().loadedProjectId).toBe("p2");
    expect(useAutoCoderStore.getState().projectDraft?.repoSlug).toBe("p2");
  });

  it("switching project drops the other project's data at once", () => {
    useAutoCoderStore.setState({
      loadedProjectId: "p1",
      projectDraft: DRAFT,
      run: status(),
      output: { lines: [line(1, "a")], since: 1, dropped: 0, startedAt: "x" },
    });
    useAutoCoderStore.getState().chooseProject("p2");
    const state = useAutoCoderStore.getState();
    expect(state.chosenProjectId).toBe("p2");
    expect(state.loadedProjectId).toBeNull();
    expect(state.projectDraft).toBeNull();
    expect(state.run).toBeNull();
    expect(state.output).toEqual(EMPTY_OUTPUT_VIEW);
  });
});

// S80 F1: the forms' reads became queries (S79 item 8), so a reconnect now re-reads them. When the
// socket drops under that re-read (the round rejects `transport`, V2-35) the status listener shows
// the failure line under a form whose values are fine; the NEXT reconnect's read is good and EQUAL
// to what the form holds, so the host tells no value listener — and nothing else clears the line.
// The Run tab clears its line on a good read (S65 gap 1): a changed `ready` result reaches
// `frameLoaded`, which clears `runFailure` (`store.ts` `frameLoaded`).
describe("a good re-read after a failed one clears the form's failure line (S80 F1)", () => {
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const settingsView = {
    settings: { jiraToken: "t", bitbucketToken: "", login: "", gigacodePath: "" },
    platform: "linux",
    gigacodePathDefault: "/usr/local/bin/gigacode",
  };

  it("settings: a failed reconnect re-read, then a good EQUAL one — no failure line left", async () => {
    const fake = makeFakeWebCtx({ pluginId: "auto-coder" });
    rememberCtx(fake.ctx);
    const stop = followSettings();
    fake.answerQuery("settings.get", settingsView);
    await settle();
    expect(useAutoCoderStore.getState().settings?.jiraToken).toBe("t");

    // A reconnect; the socket drops under its re-read.
    fake.connection.set("lost");
    fake.connection.set("ready");
    fake.failQuery("settings.get");
    await settle();
    expect(useAutoCoderStore.getState().settingsFailure).not.toBeNull();

    // The next reconnect reads again, and the server's answer is the one the form holds.
    fake.connection.set("lost");
    fake.connection.set("ready");
    fake.answerQuery("settings.get", settingsView);
    await settle();
    expect(fake.queries.map((round) => round.cause)).toEqual([
      "subscribe",
      "reconnect",
      "reconnect",
    ]);
    expect(
      useAutoCoderStore.getState().settingsFailure,
      "the read succeeded: the gear form shows no failure line",
    ).toBeNull();
    stop();
  });

  it("project: a failed reconnect re-read, then a good EQUAL one — no failure line left", async () => {
    const fake = makeFakeWebCtx({ pluginId: "auto-coder" });
    rememberCtx(fake.ctx);
    const stop = followProject("p1");
    fake.answerQuery("project.get", projectView("p1"));
    await settle();
    expect(useAutoCoderStore.getState().loadedProjectId).toBe("p1");

    fake.connection.set("lost");
    fake.connection.set("ready");
    fake.failQuery("project.get");
    await settle();
    expect(useAutoCoderStore.getState().projectFailure).not.toBeNull();

    fake.connection.set("lost");
    fake.connection.set("ready");
    fake.answerQuery("project.get", projectView("p1"));
    await settle();
    expect(
      useAutoCoderStore.getState().projectFailure,
      "the read succeeded: the project tab shows no failure line",
    ).toBeNull();
    stop();
  });
});

// S80 F2: `followRun`'s contract — "an answer that lands after [the unsubscribe] is the query's to
// hold, never the pane's (a frame selected for one project's cursor never lands in another's
// pane)". S79 made `catchUp` apply a `refresh()` answer itself, and the promise it waits on does not
// know the tab stopped following. The real path: Start on p1 (a project whose pane holds its last
// run at cursor 0), the new run prints one line, the pane starts over and reads again from 0 — and
// the user switches the selector to p2 while that read is on the wire. p1's answer is EQUAL to the
// frame p1's query holds, so `catchUp` applies it: into p2's pane, which `chooseProject` had
// just emptied so that "no pane ever shows one project's run under another's name".
describe("an answer that lands after the Run tab left the project stays out of the pane (S80 F2)", () => {
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("p1's catch-up answer, landing after the switch to p2, never reaches p2's pane", async () => {
    const OLD = "2026-09-19T09:00:00.000Z";
    const NEW = "2026-09-19T12:00:00.000Z";
    const fake = makeFakeWebCtx({ pluginId: "auto-coder" });
    rememberCtx(fake.ctx);
    useAutoCoderStore.getState().chooseProject("p1");
    useAutoCoderStore.setState({ output: { lines: [], since: 0, dropped: 0, startedAt: OLD } });
    const leaveP1 = followRun("p1");
    // p1's history: its last run, stopped, no lines (what `runner.ts` answers with no record).
    fake.answerQuery("run.output", {
      status: status({ state: "stopped", pid: null, startedAt: OLD, stoppedAt: OLD, exitCode: 0 }),
      lines: [],
      next: 0,
      dropped: 0,
    });
    await settle();

    // Start on p1: the new run prints one line; the pane reads from its cursor (0). S81: that read
    // IS the pane's read from the new run's start — `applyFrame` adopts a frame read from the view's
    // cursor — so it is the one on the wire when the user switches (the S79 road took a second).
    const firstLine = {
      status: status({ startedAt: NEW, lineCount: 1 }),
      lines: [line(1, "p1: starting")],
      next: 1,
      dropped: 0,
    };
    fake.setState(RUN_OUTPUT_STATE, { p1: status({ startedAt: NEW, lineCount: 1 }) });
    await settle();

    // The user switches to p2 while p1's read from 0 is on the wire.
    useAutoCoderStore.getState().chooseProject("p2");
    leaveP1();
    const leaveP2 = followRun("p2");
    // p1's read lands.
    expect(fake.answerQuery("run.output", firstLine), "p1's read was on the wire").toBe(true);
    expect(fake.queries.map((round) => round.input)).toEqual([
      { projectId: "p1", since: 0 },
      { projectId: "p1", since: 0 },
      { projectId: "p2", since: 0 },
    ]);
    await settle();

    const { output, run } = useAutoCoderStore.getState();
    expect(
      output.lines.map((entry) => entry.text),
      "p2's pane holds none of p1's lines",
    ).toEqual([]);
    expect(run?.projectId ?? null, "p2's status line is not p1's run").not.toBe("p1");
    leaveP2();
  });
});

// S80 gap 1: `applyFrame` is cursor-idempotent for frames of the SAME run only. A frame of ANOTHER
// run makes the pane start over at cursor 0; the same frame applied AGAIN after that would then be
// adopted — its lines were selected for the OLD run's cursor, so the new run's first lines would be
// skipped for good. A catch-up round that meets a new run reaches `followRun` twice (the listener,
// then the `refresh()` answer, the same object), and only `catchUp`'s "a listener already delivered
// it" check keeps the second one out. Nothing pinned that check (S80 mutation log 15).
describe("a new run's frame reached by two roads is applied once (S80 gap 1)", () => {
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("a run started while the pane held three lines of the last one: the pane shows the new run from line 1", async () => {
    const OLD = "2026-09-19T09:00:00.000Z";
    const NEW = "2026-09-19T12:00:00.000Z";
    const fake = makeFakeWebCtx({ pluginId: "auto-coder" });
    rememberCtx(fake.ctx);
    const unfollow = followRun("p1");
    fake.answerQuery("run.output", {
      status: status({
        state: "stopped",
        startedAt: OLD,
        stoppedAt: OLD,
        exitCode: 0,
        lineCount: 3,
      }),
      lines: [line(1, "old 1"), line(2, "old 2"), line(3, "old 3")],
      next: 3,
      dropped: 0,
    });
    await settle();
    expect(useAutoCoderStore.getState().output.since).toBe(3);

    // A new run has printed five lines by the time the pane reads after its cursor (3): the server
    // answers the NEW run's lines after seq 3 — the pane starts over and reads again from 0.
    fake.setState(RUN_OUTPUT_STATE, { p1: status({ startedAt: NEW, lineCount: 5 }) });
    await settle();
    const newLines = [1, 2, 3, 4, 5].map((seq) => line(seq, `new ${String(seq)}`));
    fake.answerQuery("run.output", {
      status: status({ startedAt: NEW, lineCount: 5 }),
      lines: newLines.slice(3),
      next: 5,
      dropped: 0,
    });
    await settle();
    expect(fake.queries.at(-1)?.input, "read again from the new run's start").toEqual({
      projectId: "p1",
      since: 0,
    });
    fake.answerQuery("run.output", {
      status: status({ startedAt: NEW, lineCount: 5 }),
      lines: newLines,
      next: 5,
      dropped: 0,
    });
    await settle();
    expect(useAutoCoderStore.getState().output.lines.map((entry) => entry.text)).toEqual([
      "new 1",
      "new 2",
      "new 3",
      "new 4",
      "new 5",
    ]);
    unfollow();
  });
});

// S81 (V2-60): the pane's follow loop is exactly "refresh while behind". It must end by itself:
// every round that moves the cursor asks once more, and the first round whose frame is EQUAL to the
// one held tells nobody and asks nothing — even when the summary claims a line the server never
// serves. Bounded by the server's lines, one read on the wire at a time.
describe("the pane's catch-up loop is bounded by the server's lines (S81)", () => {
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("one read per cursor move, and an EQUAL frame ends it — no spin", async () => {
    const total = 5;
    let reads = 0;
    const fake = makeFakeWebCtx({
      pluginId: "auto-coder",
      rpc: {
        "run.output": (payload) => {
          reads += 1;
          const since = (payload as { readonly since: number }).since;
          // The server answers at most two lines a round.
          const upTo = Math.min(since + 2, total);
          const lines = Array.from({ length: upTo - since }, (_, index) =>
            line(since + index + 1, `line ${String(since + index + 1)}`),
          );
          return {
            status: status({ lineCount: total }),
            lines,
            next: upTo,
            dropped: 0,
          } satisfies AutoCoderOutputFrame;
        },
      },
    });
    rememberCtx(fake.ctx);
    // The summary claims one line more than the server will ever serve.
    fake.setState(RUN_OUTPUT_STATE, { p1: status({ lineCount: total + 1 }) });
    const unfollow = followRun("p1");
    await settle();
    expect(useAutoCoderStore.getState().output.lines.map((entry) => entry.seq)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    // 0→2, 2→4, 4→5, 5→5 (a new, empty frame: a change), 5→5 (EQUAL: nobody told, nothing asked).
    expect(reads).toBe(5);
    await settle();
    await settle();
    expect(reads, "nothing is read after the equal frame").toBe(5);
    unfollow();
  });
});
