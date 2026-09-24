import { describe, expect, it } from "vite-plus/test";

import { OUTPUT_BUFFER_LINES, OUTPUT_LINE_MAX } from "../src/constants.ts";
import { createOutputBuffer, truncateLine } from "../src/server/outputBuffer.ts";

const TS = "2026-09-19T10:00:00.000Z";

describe("lines", () => {
  it("numbers them from 1, monotonically, and keeps the stream they came from", () => {
    const buffer = createOutputBuffer();
    buffer.push("out", "first", TS);
    buffer.push("err", "second", TS);
    expect(buffer.read(0).lines).toEqual([
      { seq: 1, ts: TS, stream: "out", text: "first" },
      { seq: 2, ts: TS, stream: "err", text: "second" },
    ]);
    expect(buffer.total).toBe(2);
  });

  it("cuts a line longer than the cap and marks the cut", () => {
    const long = "x".repeat(OUTPUT_LINE_MAX + 500);
    expect(truncateLine(long)).toHaveLength(OUTPUT_LINE_MAX);
    expect(truncateLine(long).endsWith("…")).toBe(true);
    expect(truncateLine("short")).toBe("short");
  });
});

describe("splitting a pipe's bytes", () => {
  it("keeps a tail without a newline until its newline arrives", () => {
    const buffer = createOutputBuffer();
    buffer.write("out", "one\ntw", TS);
    expect(buffer.read(0).lines.map((line) => line.text)).toEqual(["one"]);
    buffer.write("out", "o\nthree\n", TS);
    expect(buffer.read(0).lines.map((line) => line.text)).toEqual(["one", "two", "three"]);
  });

  it("drops a CR before the newline — a script on Windows prints CRLF", () => {
    const buffer = createOutputBuffer();
    buffer.write("out", "one\r\ntwo\r\n", TS);
    expect(buffer.read(0).lines.map((line) => line.text)).toEqual(["one", "two"]);
  });

  it("keeps the two streams' tails apart", () => {
    const buffer = createOutputBuffer();
    buffer.write("out", "out-part", TS);
    buffer.write("err", "err-part", TS);
    buffer.flush(TS);
    expect(buffer.read(0).lines).toEqual([
      { seq: 1, ts: TS, stream: "out", text: "out-part" },
      { seq: 2, ts: TS, stream: "err", text: "err-part" },
    ]);
  });

  it("does not hold an unbounded tail for a script that never prints a newline", () => {
    const buffer = createOutputBuffer();
    buffer.write("out", "y".repeat(OUTPUT_LINE_MAX + 10), TS);
    expect(buffer.total).toBe(1);
    expect(buffer.read(0).lines[0]?.text).toHaveLength(OUTPUT_LINE_MAX);
  });
});

describe("the cap and the cursor", () => {
  it("holds no more than the cap, and says how many the caller missed", () => {
    const buffer = createOutputBuffer();
    for (let index = 1; index <= OUTPUT_BUFFER_LINES + 5; index += 1) {
      buffer.push("out", `line ${String(index)}`, TS);
    }
    const all = buffer.read(0);
    expect(all.lines).toHaveLength(OUTPUT_BUFFER_LINES);
    expect(all.lines[0]?.seq).toBe(6);
    expect(all.dropped).toBe(5);
    expect(all.next).toBe(OUTPUT_BUFFER_LINES + 5);
    expect(buffer.total).toBe(OUTPUT_BUFFER_LINES + 5);
  });

  it("answers only what is new, and drops nothing for a caller that kept up", () => {
    const buffer = createOutputBuffer();
    buffer.push("out", "a", TS);
    const first = buffer.read(0);
    buffer.push("out", "b", TS);
    const second = buffer.read(first.next);
    expect(second.lines.map((line) => line.text)).toEqual(["b"]);
    expect(second.dropped).toBe(0);
    expect(second.next).toBe(2);
  });

  it("answers nothing for a cursor from a LONGER run instead of inventing lines", () => {
    const buffer = createOutputBuffer();
    buffer.push("out", "a", TS);
    const read = buffer.read(9999);
    expect(read.lines).toEqual([]);
    expect(read.next).toBe(1);
    expect(read.dropped).toBe(0);
  });
});
