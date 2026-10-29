// Plan morning-digest § 1. Types only — the reader (readNight) lands separately; the page,
// the JSON route and the board link all build against these.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One parsed line of runs/<night>.jsonl. `at` is ISO with offset, kept as written.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night. `owner` null is kept (views render `—`).
// `first`/`last` are `at` strings as written in the log — never converted to UTC.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus;
  lastError: string | null; // most recent `error` seen for the job that night, null if none
  first: string;
  last: string;
};

// A whole night. `rows` are sorted by job; the page and the JSON both use this order.
export type DigestNight = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[];
  badLines: number; // lines that didn't parse: counted, never thrown
  counts: { ok: number; retry: number; fail: number }; // lines by status, for the board link
};

// null = no file for that night (routes return 404). An empty file gives `rows: []`.
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;

// Routes accept only this as :night — anything else is rejected (no path traversal).
export const NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
