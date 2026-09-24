import { OUTPUT_BUFFER_LINES, OUTPUT_LINE_MAX } from "../constants.ts";
import type { AutoCoderOutputLine } from "../contracts.ts";

export const truncateLine = (text: string): string =>
  text.length <= OUTPUT_LINE_MAX ? text : `${text.slice(0, OUTPUT_LINE_MAX - 1)}…`;

export type OutputRead = {
  readonly lines: ReadonlyArray<AutoCoderOutputLine>;
  readonly next: number;
  readonly dropped: number;
};

export type OutputStream = "out" | "err";

export type OutputBuffer = {
  push(stream: OutputStream, text: string, ts: string): void;
  write(stream: OutputStream, chunk: string, ts: string): void;
  flush(ts: string): void;
  read(since: number): OutputRead;
  readonly total: number;
};

export const createOutputBuffer = (): OutputBuffer => {
  const lines: Array<AutoCoderOutputLine> = [];
  const partial = new Map<OutputStream, string>();
  let total = 0;

  const push = (stream: OutputStream, text: string, ts: string): void => {
    total += 1;
    lines.push({ seq: total, ts, stream, text: truncateLine(text) });
    if (lines.length > OUTPUT_BUFFER_LINES) lines.splice(0, lines.length - OUTPUT_BUFFER_LINES);
  };

  return {
    push,
    write: (stream, chunk, ts) => {
      const pieces = `${partial.get(stream) ?? ""}${chunk}`.split("\n");
      const tail = pieces.pop() ?? "";
      for (const piece of pieces) push(stream, piece.replace(/\r$/, ""), ts);
      if (tail.length >= OUTPUT_LINE_MAX) {
        push(stream, tail, ts);
        partial.set(stream, "");
      } else {
        partial.set(stream, tail);
      }
    },
    flush: (ts) => {
      for (const [stream, tail] of partial) {
        if (tail !== "") push(stream, tail.replace(/\r$/, ""), ts);
      }
      partial.clear();
    },
    read: (since) => {
      const from = since < 0 ? 0 : Math.min(since, total);
      const oldest = lines[0]?.seq ?? total + 1;
      return {
        lines: lines.filter((line) => line.seq > from),
        next: total,
        dropped: from < oldest - 1 ? oldest - 1 - from : 0,
      };
    },
    get total() {
      return total;
    },
  };
};
