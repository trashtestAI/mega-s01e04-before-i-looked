import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('gives 5 rows sorted by job and counts 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night!.rows).toHaveLength(5);
    expect(night!.badLines).toBe(1);
    const jobs = night!.rows.map((r) => r.job);
    expect(jobs).toEqual([...jobs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('folds fixtures/refresh retries into one row', () => {
    const row = night!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
  });

  it('keeps the last status of notes/backup', () => {
    expect(night!.rows.find((r) => r.job === 'notes/backup')?.lastStatus).toBe('fail');
  });

  it('keeps a row whose owner is null', () => {
    const row = night!.rows.find((r) => r.job === 'digest/render');
    expect(row).toBeDefined();
    expect(row!.owner).toBeNull();
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns empty rows for an empty file', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight(dir, '../x')).toBeNull();
  });

  it('handles CRLF, blank lines and wrong-shape lines', () => {
    writeFileSync(
      join(dir, '2026-01-03.jsonl'),
      '{"at":"t1","job":"a","status":"ok","owner":"x"}\r\n' +
        '\r\n' +
        '{"at":"t2","job":"a","status":"maybe","owner":"x"}\r\n' +
        '{"at":"t3","job":"a","status":"fail","owner":"x","error":"boom"}\r\n',
    );
    const n = readNight(dir, '2026-01-03');
    expect(n?.badLines).toBe(1);
    expect(n?.rows).toEqual([
      { job: 'a', owner: 'x', runs: 2, retries: 0, lastStatus: 'fail', lastError: 'boom', first: 't1', last: 't3' },
    ]);
    expect(n?.counts).toEqual({ ok: 1, retry: 0, fail: 1 });
  });
});
