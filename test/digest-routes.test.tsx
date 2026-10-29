import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestNight } from '../src/digest/types.js';

const line = (at: string, job: string, status: string, owner: string | null, error?: string): string =>
  JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });

const NORMAL = '2030-01-01';
const EMPTY = '2030-01-02';
const BAD = '2030-01-03';
const MISSING = '2030-01-04';
const JOBS = ['alpha/build', 'mid/sync', 'zeta/clean'];

let dir = '';
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-'));
  const normal = [
    line('2030-01-01T02:00:00+01:00', 'zeta/clean', 'ok', null),
    line('2030-01-01T01:00:00+01:00', 'alpha/build', 'retry', 'ann', 'boom 1'),
    line('2030-01-01T01:05:00+01:00', 'alpha/build', 'retry', 'ann', 'boom 2'),
    line('2030-01-01T01:10:00+01:00', 'alpha/build', 'retry', 'ann', 'boom 3'),
    line('2030-01-01T01:15:00+01:00', 'alpha/build', 'fail', 'ann', 'boom 4'),
    line('2030-01-01T03:00:00+01:00', 'mid/sync', 'ok', 'rook'),
  ];
  fs.writeFileSync(path.join(dir, `${NORMAL}.jsonl`), normal.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, `${EMPTY}.jsonl`), '');
  const bad = [
    line('2030-01-03T01:00:00+01:00', 'mid/sync', 'ok', 'rook'),
    '{this is not json',
    line('2030-01-03T02:00:00+01:00', 'alpha/build', 'ok', 'ann'),
  ];
  fs.writeFileSync(path.join(dir, `${BAD}.jsonl`), bad.join('\n') + '\n');
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: dir });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const getJson = async (night: string): Promise<DigestNight> => {
  const res = await app.request(`/api/digest/${night}`);
  return (await res.json()) as DigestNight;
};

describe('GET /digest/:night', () => {
  it('200: heading, rows sorted by job, null owner as a dash', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`digest · ${NORMAL}`);
    const pos = JOBS.map((j) => html.indexOf(j));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(html).toContain('—');
    expect(html).toContain('<table');
  });

  it('404 for a night with no file', async () => {
    expect((await app.request(`/digest/${MISSING}`)).status).toBe(404);
  });

  it('404 for a night that is not YYYY-MM-DD', async () => {
    expect((await app.request('/digest/not-a-night')).status).toBe(404);
    expect((await app.request('/digest/..%2Fpackage')).status).toBe(404);
  });

  it('empty night says nothing ran', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('bad line is counted, not fatal', async () => {
    const res = await app.request(`/digest/${BAD}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('1 line could not be read');
  });
});

describe('GET /api/digest/:night', () => {
  it('200: rows sorted by job with run, retry and error summaries', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.night).toBe(NORMAL);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS);
    const alpha = body.rows[0]!;
    expect(alpha).toMatchObject({ runs: 4, retries: 3, lastStatus: 'fail', lastError: 'boom 4', owner: 'ann' });
    const mid = body.rows[1]!;
    expect(mid).toMatchObject({ runs: 1, retries: 0, lastStatus: 'ok', lastError: null });
    expect(body.rows[2]!.owner).toBeNull();
    expect(body.counts).toEqual({ ok: 2, retry: 3, fail: 1 });
  });

  it('404 JSON for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('empty night has no rows', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: EMPTY,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('bad-line night reports badLines and keeps the good rows', async () => {
    const body = await getJson(BAD);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/build', 'mid/sync']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const jobs = (await getJson(NORMAL)).rows.map((r) => r.job);
    const pos = jobs.map((j) => html.indexOf(j));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
});
