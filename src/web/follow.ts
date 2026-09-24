// FOLLOW A LOG AFTER A CURSOR (S81, V2-60) — the one piece of a live detail the host does not do
// for you, in one module another plugin takes by copy. It knows the detail QUERY (its `input` reads
// your view's cursor), the published SUMMARY (it says how far the log goes), and two functions of
// yours: `behind()`, pure over summary × cursor, and `show`, which puts one result on screen and is
// idempotent by cursor (the same frame twice changes nothing; a frame read from another cursor
// does not continue the view).
//
// THE LOOP IS "REFRESH WHILE BEHIND", and that is all of it: after every good result and on every
// summary change, one `refresh()` if the view is behind. It ends by itself — a frame that moves the
// cursor is a new result and asks once more; one that does not is EQUAL, tells nobody and asks
// nothing — so it is bounded by the lines the server holds, one read on the wire at a time (the
// host's rule). No flags, no timers, no identity checks: the last unsubscribe disposes the query,
// and a disposed query delivers nothing.
import type { QueryResult, QuerySignal, Signal } from "@smart-tools/plugin-sdk/host";

export type FollowLogOptions<Frame> = {
  readonly lines: QuerySignal<Frame>;
  readonly summary: Signal<unknown>;
  readonly behind: () => boolean;
  readonly show: (result: QueryResult<Frame>) => void;
};

export const followLog = <Frame>({
  lines,
  summary,
  behind,
  show,
}: FollowLogOptions<Frame>): (() => void) => {
  const catchUp = (): void => {
    if (behind()) void lines.refresh();
  };
  const stopLines = lines.subscribe(() => {
    const result = lines.get();
    show(result);
    if (result.phase === "ready") catchUp();
  });
  const stopSummary = summary.subscribe(catchUp);
  return () => {
    stopLines();
    stopSummary();
  };
};
