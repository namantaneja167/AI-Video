import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {EpisodeSchema, TimelineSchema} from '../src/schema.ts';
import {FIXTURES, ROOT, fixture, plain, readJson, mkTmp} from './helpers.ts';

const base = () => fixture('join-fanout/episode.v1.json');

describe('episode schema (v1, legacy)', () => {
  test('real join-fanout episode normalises exactly to the golden', () => {
    assert.deepEqual(plain(EpisodeSchema.parse(base())), fixture('join-fanout/episode.normalized.json'));
  });

  test('every tracked episode, including the template, validates', () => {
    const dir = join(ROOT, 'episodes');
    const ids = readdirSync(dir, {withFileTypes: true}).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.ok(ids.includes('_template') && ids.includes('join-fanout'));
    for (const id of ids) {
      const r = EpisodeSchema.safeParse(readJson('episodes', id, 'episode.json'));
      assert.ok(r.success, `${id}: ${r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
  });

  // Each rule must reject a deliberately broken episode with the expected message.
  const cases: [string, (ep: any) => void, string][] = [
    ['duplicate segment ids', (ep) => (ep.narration.segments[1].id = ep.narration.segments[0].id), 'duplicate segment ids'],
    ['scene list misses a segment', (ep) => ep.scenes[0].segments.pop(), 'scenes must list every segment exactly once'],
    ['cue from another scene type', (ep) => (ep.events[0].cue = 'card-1'), 'is not valid for scene type'],
    ['event on an unknown segment', (ep) => (ep.events[0].segment = 'nope'), 'unknown segment'],
    ['word anchor beyond the segment', (ep) => (ep.events[0].at = {word: 999}), 'beyond the end'],
    ['caption phrases with a different word count', (ep) => (ep.narration.segments[0].captions = ['only one']), 'caption phrases have'],
    ['caption phrases that spell other words', (ep) => (ep.narration.segments[0].captions = ep.narration.segments[0].text.split(' ').map((_: string, i: number) => `w${i}`)), 'must spell exactly the same words'],
    ['chapter on an unknown segment', (ep) => (ep.chapters[0].segment = 'nope'), 'unknown segment'],
    ['non-consecutive preview', (ep) => (ep.previews.bad = {segments: ['s01', 's03']}), 'must be consecutive'],
    ['bad id characters', (ep) => (ep.id = 'Bad Id'), 'lowercase letters'],
    ['event with neither cue nor expression', (ep) => (ep.events[0] = {segment: 's01'}), 'needs a cue or an expression'],
    ['chapter label over 14 characters', (ep) => (ep.chapters[0].label = 'x'.repeat(15)), 'Too big'],
    ['wrong schemaVersion', (ep) => (ep.schemaVersion = 2), 'Invalid input'],
  ];
  for (const [name, mutate, expected] of cases) {
    test(`rejects: ${name}`, () => {
      const ep = base();
      mutate(ep);
      const r = EpisodeSchema.safeParse(ep);
      assert.equal(r.success, false);
      const messages = r.success ? '' : r.error.issues.map((i) => i.message).join(' | ');
      assert.match(messages, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    });
  }
});

describe('timeline contract: Python output must satisfy the TypeScript schema that Remotion uses', () => {
  for (const name of ['full', 'preview']) {
    test(`golden ${name} timeline parses`, () => {
      const r = TimelineSchema.safeParse(fixture(`join-fanout/timeline.${name}.json`));
      assert.ok(r.success, r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    });
  }
});

describe('scripts/validate.ts (the command the Python CLI calls)', () => {
  const run = (...args: string[]) => spawnSync('node', ['scripts/validate.ts', ...args], {cwd: ROOT, encoding: 'utf8'});

  test('valid episode: exit 0, summary line, normalised output matches the golden', () => {
    const out = join(mkTmp('studio-'), 'norm.json');
    const r = run(join(FIXTURES, 'join-fanout/episode.v1.json'), '--out', out);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^OK join-fanout: 22 segments, 5 scenes, 43 events, 1 previews/);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), fixture('join-fanout/episode.normalized.json'));
  });

  test('invalid episode: exit 1 and a readable path + reason', () => {
    const ep = base();
    ep.events[0].cue = 'card-1';
    const file = join(mkTmp('studio-'), 'bad.json');
    writeFileSync(file, JSON.stringify(ep));
    const r = run(file);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /events\.0\.cue: cue "card-1" is not valid for scene type "kpi-mismatch"/);
  });

  test('missing file: exit 1', () => {
    assert.equal(run('/nonexistent/episode.json').status, 1);
  });
});
