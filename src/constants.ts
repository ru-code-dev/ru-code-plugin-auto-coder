export const SCRIPT_FILE = "auto-coder.js";

export const JIRA_HOST = "https://jira.example.invalid";

export const DEFAULT_BASE_BRANCH = "develop";

export const JQL_NAMESPACE_PLACEHOLDER = "%JIRA_NAMESPACE%";

export const JQL_REPO_PLACEHOLDER = "%REPO_SLUG%";

export const DEFAULT_JQL = `project = ${JQL_NAMESPACE_PLACEHOLDER} AND component = ${JQL_REPO_PLACEHOLDER} AND status = "To Do"`;

export const PLATFORM_DEFAULT_GIGACODE_PATH: Record<"darwin" | "linux" | "win32", string> = {
  darwin: "/opt/gigacode/bin/gigacode",
  linux: "/usr/local/bin/gigacode",
  win32: "C:\\Program Files\\GigaCode\\gigacode.exe",
};

export const RUN_OUTPUT_STATE = "run.output";

export const OUTPUT_BUFFER_LINES = 2000;

export const OUTPUT_LINE_MAX = 4000;

export const SCRIPT_ENV: Readonly<Record<string, string>> = {
  NODE_TLS_REJECT_UNAUTHORIZED: "0",
  NODE_NO_WARNINGS: "1",
};

export const SCRIPT_HEARTBEAT_LIMIT_FILE = "heartbeat-limit";
