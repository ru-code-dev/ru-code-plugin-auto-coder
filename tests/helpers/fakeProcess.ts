import type { KillGroup, RunExit, SpawnRun, SpawnRunOptions } from "../../src/server/process.ts";

export type FakeChild = {
  readonly pid: number;
  readonly options: SpawnRunOptions;
  out(chunk: string): void;
  err(chunk: string): void;
  exit(exit: Partial<RunExit>): void;
};

export type FakeSpawner = {
  readonly spawnRun: SpawnRun;
  readonly killGroup: KillGroup;
  readonly children: ReadonlyArray<FakeChild>;
  readonly killed: ReadonlyArray<number>;
  withoutPid(): void;
};

export const makeFakeSpawner = (firstPid = 4100): FakeSpawner => {
  const children: Array<FakeChild> = [];
  const killed: Array<number> = [];
  let nextPid = firstPid;
  let skipPid = false;

  const spawnRun: SpawnRun = (options) => {
    const pid = skipPid ? null : nextPid;
    skipPid = false;
    nextPid += 1;
    let onOutput: (stream: "out" | "err", chunk: string) => void = () => undefined;
    let onExit: (exit: RunExit) => void = () => undefined;
    let ended = false;
    children.push({
      pid: pid ?? -1,
      options,
      out: (chunk) => {
        onOutput("out", chunk);
      },
      err: (chunk) => {
        onOutput("err", chunk);
      },
      exit: (exit) => {
        if (ended) return;
        ended = true;
        onExit({ code: exit.code ?? null, signal: exit.signal ?? null, error: exit.error ?? null });
      },
    });
    return {
      pid,
      onOutput: (listener) => {
        onOutput = listener;
      },
      onExit: (listener) => {
        onExit = listener;
      },
    };
  };

  return {
    spawnRun,
    killGroup: (pid) => {
      killed.push(pid);
    },
    children,
    killed,
    withoutPid: () => {
      skipPid = true;
    },
  };
};
