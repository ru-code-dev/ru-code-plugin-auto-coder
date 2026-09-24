import * as NodeChildProcess from "node:child_process";

export type RunExit = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly error: string | null;
};

export type SpawnedRun = {
  readonly pid: number | null;
  onOutput(listener: (stream: "out" | "err", chunk: string) => void): void;
  onExit(listener: (exit: RunExit) => void): void;
};

export type SpawnRunOptions = {
  readonly scriptPath: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

export type SpawnRun = (options: SpawnRunOptions) => SpawnedRun;

export type KillGroup = (pid: number) => void;

export const spawnRunWithNode: SpawnRun = ({ scriptPath, cwd, env }) => {
  const child = NodeChildProcess.spawn(process.execPath, [scriptPath], {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  let ended = false;
  return {
    pid: child.pid ?? null,
    onOutput: (listener) => {
      child.stdout?.on("data", (chunk: string) => {
        listener("out", String(chunk));
      });
      child.stderr?.on("data", (chunk: string) => {
        listener("err", String(chunk));
      });
    },
    onExit: (listener) => {
      const once = (exit: RunExit): void => {
        if (ended) return;
        ended = true;
        listener(exit);
      };
      child.on("exit", (code, signal) => {
        once({ code, signal, error: null });
      });
      child.on("error", (error: Error) => {
        once({ code: null, signal: null, error: error.message });
      });
    },
  };
};

export const killProcessGroup = (pid: number, platform: string): void => {
  if (platform === "win32") {
    NodeChildProcess.spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  process.kill(-pid, "SIGKILL");
};
