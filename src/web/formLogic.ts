import { OUTPUT_BUFFER_LINES } from "../constants.ts";
import type {
  AutoCoderOutputFrame,
  AutoCoderOutputLine,
  AutoCoderProjectSettings,
  AutoCoderRunStatus,
  AutoCoderRunsSummary,
} from "../contracts.ts";
import { deriveJql, isDerivedJql } from "../defaults.ts";

export type SelectableProject = {
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
};

export const resolveSelectedProject = (
  chosen: string | null,
  activeProject: string | null,
  projects: ReadonlyArray<SelectableProject>,
): string | null => {
  const exists = (id: string | null): boolean =>
    id !== null && projects.some((project) => project.id === id);
  if (exists(chosen)) return chosen;
  if (exists(activeProject)) return activeProject;
  return projects[0]?.id ?? null;
};

export type ProjectField = keyof AutoCoderProjectSettings;

export const applyProjectField = (
  draft: AutoCoderProjectSettings,
  field: ProjectField,
  value: string,
): AutoCoderProjectSettings => {
  const next: AutoCoderProjectSettings = { ...draft, [field]: value };
  if (field !== "jiraNamespace" && field !== "repoSlug") return next;
  const followed = isDerivedJql(draft.jql, {
    jiraNamespace: draft.jiraNamespace,
    repoSlug: draft.repoSlug,
  });
  return followed
    ? {
        ...next,
        jql: deriveJql({ jiraNamespace: next.jiraNamespace, repoSlug: next.repoSlug }),
      }
    : next;
};

export type OutputView = {
  readonly lines: ReadonlyArray<AutoCoderOutputLine>;
  readonly since: number;
  readonly dropped: number;
  readonly startedAt: string | null;
};

export const EMPTY_OUTPUT_VIEW: OutputView = {
  lines: [],
  since: 0,
  dropped: 0,
  startedAt: null,
};

/**
 * The cursor a frame was read after, as the server clamped it (`outputBuffer.ts` `read`): the seq
 * before its first line — or `next` when it has none — less the lines its ring no longer holds.
 */
const frameSince = (frame: AutoCoderOutputFrame): number =>
  (frame.lines[0]?.seq ?? frame.next + 1) - 1 - frame.dropped;

/**
 * CURSOR-IDEMPOTENT: a frame continues the view only from the view's own cursor, so applying the
 * same frame twice is applying it once. A frame of ANOTHER run starts the view over at cursor 0 and
 * is adopted when it was read from there; one read after the old run's cursor leaves the new, empty
 * view as it is (again on a second apply), and the summary says the pane is behind.
 */
export const applyFrame = (view: OutputView, frame: AutoCoderOutputFrame): OutputView => {
  const startedAt = frame.status.startedAt;
  const from =
    view.startedAt !== null && view.startedAt !== startedAt
      ? { ...EMPTY_OUTPUT_VIEW, startedAt }
      : view;
  if (frameSince(frame) > from.since) return from;
  if (from.startedAt !== null && frame.next <= from.since) return from;
  const fresh = frame.lines.filter((entry) => entry.seq > from.since);
  const lines = [...from.lines, ...fresh];
  return {
    lines: lines.length > OUTPUT_BUFFER_LINES ? lines.slice(-OUTPUT_BUFFER_LINES) : lines,
    since: frame.next,
    dropped: from.dropped + frame.dropped,
    startedAt,
  };
};

const sameRunStatus = (a: AutoCoderRunStatus, b: AutoCoderRunStatus): boolean =>
  a.projectId === b.projectId &&
  a.state === b.state &&
  a.pid === b.pid &&
  a.startedAt === b.startedAt &&
  a.stoppedAt === b.stoppedAt &&
  a.exitCode === b.exitCode &&
  a.lineCount === b.lineCount;

/**
 * Is the pane behind what the server published? Pure over the published summary's entry for the
 * project and the pane's cursor: a run the pane has not seen, or more lines of the one it shows.
 */
export const behind = (live: AutoCoderRunStatus | undefined, output: OutputView): boolean => {
  if (live === undefined || live.startedAt === null) return false;
  if (output.startedAt === null || live.startedAt > output.startedAt) return true;
  return live.startedAt === output.startedAt && live.lineCount > output.since;
};

export const frameChangesNothing = (
  current: { readonly run: AutoCoderRunStatus | null; readonly output: OutputView },
  frame: AutoCoderOutputFrame,
): boolean =>
  frame.lines.length === 0 &&
  frame.dropped === 0 &&
  frame.next === current.output.since &&
  current.output.startedAt === frame.status.startedAt &&
  current.run !== null &&
  sameRunStatus(current.run, frame.status);

export const serverRun = (
  runs: AutoCoderRunsSummary | undefined,
  projectId: string,
  stored: AutoCoderRunStatus | null,
): AutoCoderRunStatus | null => (runs === undefined ? stored : (runs[projectId] ?? null));

export const statusLineRun = (
  runs: AutoCoderRunsSummary | undefined,
  projectId: string,
  stored: AutoCoderRunStatus | null,
): AutoCoderRunStatus | null => runs?.[projectId] ?? stored;

export const runToggle = (
  run: AutoCoderRunStatus | null,
  busy: boolean,
): { readonly action: "start" | "stop"; readonly disabled: boolean } => ({
  action: run?.state === "running" ? "stop" : "start",
  disabled: busy,
});

export const clearOutputView = (view: OutputView): OutputView => ({ ...view, lines: [] });
