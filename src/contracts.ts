export type AutoCoderSettings = {
  readonly jiraToken: string;
  readonly bitbucketToken: string;
  readonly login: string;
  readonly gigacodePath: string;
};

export type AutoCoderProjectSettings = {
  readonly bitbucketProjectKey: string;
  readonly repoSlug: string;
  readonly baseBranch: string;
  readonly workspacePath: string;
  readonly jiraNamespace: string;
  readonly jql: string;
};

export type AutoCoderSettingsView = {
  readonly settings: AutoCoderSettings;
  readonly platform: string;
  readonly gigacodePathDefault: string;
};

export type AutoCoderProjectView = {
  readonly projectId: string;
  readonly settings: AutoCoderProjectSettings;
  readonly defaults: AutoCoderProjectSettings;
  readonly platform: string;
  readonly gigacodePathDefault: string;
};

export type AutoCoderRunState = "stopped" | "running";

export type AutoCoderRunStatus = {
  readonly projectId: string;
  readonly state: AutoCoderRunState;
  readonly pid: number | null;
  readonly startedAt: string | null;
  readonly stoppedAt: string | null;
  readonly exitCode: number | null;
  readonly lineCount: number;
};

export type AutoCoderOutputLine = {
  readonly seq: number;
  readonly ts: string;
  readonly stream: "out" | "err";
  readonly text: string;
};

export type AutoCoderRunsSummary = { readonly [projectId: string]: AutoCoderRunStatus };

export type AutoCoderOutputFrame = {
  readonly status: AutoCoderRunStatus;
  readonly lines: ReadonlyArray<AutoCoderOutputLine>;
  readonly next: number;
  readonly dropped: number;
};
