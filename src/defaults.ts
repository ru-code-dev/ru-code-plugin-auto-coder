import {
  DEFAULT_BASE_BRANCH,
  DEFAULT_JQL,
  JQL_NAMESPACE_PLACEHOLDER,
  JQL_REPO_PLACEHOLDER,
  PLATFORM_DEFAULT_GIGACODE_PATH,
} from "./constants.ts";
import type { AutoCoderProjectSettings, AutoCoderSettings } from "./contracts.ts";

export const baseNameOf = (path: string): string => {
  const trimmed = path.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
};

export type JqlValues = {
  readonly jiraNamespace: string;
  readonly repoSlug: string;
};

export const substituteJql = (pattern: string, values: JqlValues): string =>
  pattern
    .replaceAll(JQL_NAMESPACE_PLACEHOLDER, values.jiraNamespace)
    .replaceAll(JQL_REPO_PLACEHOLDER, values.repoSlug);

export const deriveJql = (values: JqlValues): string => substituteJql(DEFAULT_JQL, values);

export const isDerivedJql = (jql: string, values: JqlValues): boolean => jql === deriveJql(values);

export const projectDefaults = (cwd: string): AutoCoderProjectSettings => {
  const repoSlug = baseNameOf(cwd);
  const jiraNamespace = "";
  return {
    bitbucketProjectKey: "",
    repoSlug,
    baseBranch: DEFAULT_BASE_BRANCH,
    workspacePath: cwd,
    jiraNamespace,
    jql: deriveJql({ jiraNamespace, repoSlug }),
  };
};

export const mergeProjectSettings = (
  saved: AutoCoderProjectSettings | null,
  defaults: AutoCoderProjectSettings,
): AutoCoderProjectSettings => {
  if (saved === null) return defaults;
  const pick = (value: string, fallback: string): string =>
    value.trim() === "" ? fallback : value;
  const repoSlug = pick(saved.repoSlug, defaults.repoSlug);
  const jiraNamespace = pick(saved.jiraNamespace, defaults.jiraNamespace);
  return {
    bitbucketProjectKey: pick(saved.bitbucketProjectKey, defaults.bitbucketProjectKey),
    repoSlug,
    baseBranch: pick(saved.baseBranch, defaults.baseBranch),
    workspacePath: pick(saved.workspacePath, defaults.workspacePath),
    jiraNamespace,
    jql: saved.jql.trim() === "" ? deriveJql({ jiraNamespace, repoSlug }) : saved.jql,
  };
};

export const defaultGigacodePath = (platform: string): string =>
  platform === "darwin" || platform === "win32"
    ? PLATFORM_DEFAULT_GIGACODE_PATH[platform]
    : PLATFORM_DEFAULT_GIGACODE_PATH.linux;

export const effectiveGigacodePath = (settings: AutoCoderSettings, platform: string): string =>
  settings.gigacodePath.trim() === ""
    ? defaultGigacodePath(platform)
    : settings.gigacodePath.trim();
