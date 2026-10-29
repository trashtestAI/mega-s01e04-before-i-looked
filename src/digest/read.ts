// Plan morning-digest § 1. Reads runs/<night>.jsonl into one row per job.
// Lines are parsed at the edge: anything that isn't a valid RunLine is counted in `badLines`,
// never thrown, so the night still renders.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NIGHT_PATTERN, type DigestNight, type DigestRow, type ReadNight, type RunLine, type RunStatus } from './types.js';

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

// One line of JSONL → RunLine, or null if it isn't one (bad JSON, wrong shape, truncated).
export function parseRunLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.at !== 'string' || typeof o.job !== 'string' || !isStatus(o.status)) return null;
  if (!(typeof o.owner === 'string' || o.owner === null)) return null;
  if (o.error !== undefined && typeof o.error !== 'string') return null;
  const line: RunLine = { at: o.at, job: o.job, status: o.status, owner: o.owner };
  if (typeof o.error === 'string') line.error = o.error;
  return line;
}

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT_PATTERN.test(night)) return null;
  const text = readFile(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const rows = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseRunLine(raw);
    if (line === null) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const row = rows.get(line.job);
    if (row === undefined) {
      rows.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error ?? null,
        first: line.at,
        last: line.at,
      });
      continue;
    }
    row.owner = line.owner;
    row.runs++;
    if (line.status === 'retry') row.retries++;
    row.lastStatus = line.status;
    if (line.error !== undefined) row.lastError = line.error;
    row.last = line.at;
  }

  const sorted = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows: sorted, badLines, counts };
};
