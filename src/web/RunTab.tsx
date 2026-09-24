import { useEffect, useRef } from "react";
import { PlayIcon, SquareIcon } from "lucide-react";
import { useSignal } from "@smart-tools/plugin-sdk/react";

import { RUN_OUTPUT_STATE } from "../constants.ts";
import type { AutoCoderRunsSummary } from "../contracts.ts";
import { L, LT } from "../localization.ts";
import { followRun, startRun, stopRun } from "./actions.ts";
import { Button } from "./components/button.tsx";
import { cn } from "./components/cn.ts";
import { Spinner } from "./components/spinner.tsx";
import { describeFailure } from "./failureText.ts";
import { runToggle, serverRun, statusLineRun } from "./formLogic.ts";
import { PanelFieldError } from "./PanelField.tsx";
import { autoCoderCtx, useAutoCoderStore } from "./store.ts";

const atTime = (iso: string | null): string =>
  iso === null ? "" : new Date(iso).toLocaleTimeString();

export function RunTab(props: { readonly projectId: string }) {
  const { projectId } = props;
  const runs = useSignal(autoCoderCtx().state(RUN_OUTPUT_STATE)) as
    | AutoCoderRunsSummary
    | undefined;
  const storedRun = useAutoCoderStore((state) => state.run);
  const run = serverRun(runs, projectId, storedRun);
  const lineRun = statusLineRun(runs, projectId, storedRun);
  const output = useAutoCoderStore((state) => state.output);
  const failure = useAutoCoderStore((state) => state.runFailure);
  const busy = useAutoCoderStore((state) => state.runBusy);

  const toggle = runToggle(run, busy);
  const running = toggle.action === "stop";

  useEffect(() => followRun(projectId), [projectId]);

  const paneRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true);
  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null || !stickRef.current) return;
    pane.scrollTop = pane.scrollHeight;
  }, [output.lines]);

  const detail =
    lineRun === null || lineRun.startedAt === null
      ? L("not started yet", "ещё не запускалось")
      : running
        ? LT("pid {0} · started {1}", "pid {0} · запущено в {1}", [
            lineRun.pid ?? "?",
            atTime(lineRun.startedAt),
          ])
        : lineRun.exitCode === null
          ? LT("was started at {0}", "запускалось в {0}", [atTime(lineRun.startedAt)])
          : LT("exit code {0}", "код выхода {0}", [lineRun.exitCode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ac-run">
      {}
      <div className="flex items-center gap-2 border-border border-b px-3 py-2.5">
        <Button
          data-testid="ac-run-toggle"
          disabled={toggle.disabled}
          onClick={() => {
            void (running ? stopRun(projectId) : startRun(projectId));
          }}
          size="sm"
          variant={running ? "outline" : "default"}
        >
          {running ? <SquareIcon className="size-4" /> : <PlayIcon className="size-4" />}
          {running ? L("Stop", "Остановить") : L("Start", "Запустить")}
        </Button>
        {busy ? <Spinner className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        <span
          className="min-w-0 flex-1 truncate text-right text-muted-foreground text-xs"
          data-testid="ac-run-status"
        >
          {detail}
        </span>
      </div>

      {failure === null && output.dropped === 0 ? null : (
        <div className="flex items-center gap-2 border-border border-b px-3 py-2" role="status">
          {failure === null ? null : <PanelFieldError>{describeFailure(failure)}</PanelFieldError>}
          {output.dropped === 0 ? null : (
            <span className="text-[11px] text-muted-foreground" data-testid="ac-run-dropped">
              {LT("{0} older line(s) were dropped.", "Старых строк отброшено: {0}.", [
                output.dropped,
              ])}
            </span>
          )}
        </div>
      )}

      {}
      <pre
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap wrap-break-word p-3 font-mono text-[11px] text-muted-foreground/90 leading-relaxed"
        data-testid="ac-run-output"
        onScroll={(event) => {
          const pane = event.currentTarget;
          stickRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24;
        }}
        ref={paneRef}
      >
        {output.lines.length === 0 ? (
          <span data-testid="ac-run-empty">
            {L(
              "No output yet. Output is kept in memory only — a server restart loses it.",
              "Вывода пока нет. Вывод хранится только в памяти — перезапуск сервера его теряет.",
            )}
          </span>
        ) : (
          output.lines.map((line) => (
            <div
              className={cn(line.stream === "err" && "text-destructive-foreground")}
              data-stream={line.stream}
              key={line.seq}
            >
              {line.text}
            </div>
          ))
        )}
      </pre>
    </div>
  );
}
