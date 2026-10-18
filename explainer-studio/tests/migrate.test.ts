import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {EpisodeSchema} from '../src/schema.ts';
import {EpisodeSchemaV2, type EpisodeV2} from '../src/schema2.ts';
import {
  BLOCK_MAX_WORDS, LossyDowngradeError, UnsupportedVoiceConversionError, checkAnchors, downgradeV2ToV1, losslessV1, migrateV1ToV2, planBlocks, stableStringify, validateEpisodeV2,
} from '../src/migrate.ts';
import {ROOT, fixture, plain, readJson, mkTmp} from './helpers.ts';

const joinFanout = () => fixture('join-fanout/episode.v1.json');
const allEpisodes = (): [string, unknown][] =>
  readdirSync(join(ROOT, 'episodes'), {withFileTypes: true})
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, readJson('episodes', d.name, 'episode.json')]);

describe('v1 -> v2 migration', () => {
  test('produces a valid v2 episode for every tracked episode', () => {
    for (const [name, raw] of allEpisodes()) {
      const v2 = migrateV1ToV2(raw);
      const check = validateEpisodeV2(v2);
      assert.ok(check.ok, `${name}: ${check.ok ? '' : check.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    }
  });

  test('round trip v1 -> v2 -> v1 reproduces the normalised episode with nothing lost', () => {
    const cases: [string, unknown][] = [...allEpisodes(), ['fixture', joinFanout()]];
    for (const [name, raw] of cases) {
      const original = EpisodeSchema.parse(raw);
      const back = downgradeV2ToV1(migrateV1ToV2(raw));
      assert.deepEqual(back.warnings, [], name);
      assert.deepEqual(plain(back.episode), plain(original), name);
    }
  });

  test('legacy-faithful: scenes keep the fixed stage, the mascot is hidden, voice stays Kokoro', () => {
    const v2 = migrateV1ToV2(joinFanout());
    assert.equal(v2.voice.engine, 'kokoro');
    for (const s of v2.scenes) {
      assert.equal(s.layout.template, 'legacy-stage');
      assert.equal(s.layout.mascot.mode, 'hidden');
    }
    assert.equal(v2.schemaVersion, 2);
  });

  test('events become beats with stable ids; word-anchored beats remember their anchor word', () => {
    const raw = joinFanout();
    const v2 = migrateV1ToV2(raw);
    assert.equal(v2.beats.length, raw.events.length);
    assert.equal(new Set(v2.beats.map((b) => b.id)).size, v2.beats.length);
    const wordBeats = v2.beats.filter((b) => typeof b.at === 'object' && 'word' in b.at);
    assert.ok(wordBeats.length > 0);
    for (const b of wordBeats) {
      const seg = v2.narration.segments.find((s) => s.id === b.segment)!;
      assert.equal(b.anchorText, seg.text.split(/\s+/).filter(Boolean)[(b.at as {word: number}).word]);
    }
  });

  test('blocks partition the segments in order and respect the word cap', () => {
    const v2 = migrateV1ToV2(joinFanout());
    assert.deepEqual(v2.narration.blocks.flatMap((b) => b.segments), v2.narration.segments.map((s) => s.id));
    const text = new Map(v2.narration.segments.map((s) => [s.id, s.text.split(/\s+/).filter(Boolean).length]));
    for (const b of v2.narration.blocks) {
      const n = b.segments.reduce((a, s) => a + text.get(s)!, 0);
      assert.ok(n <= BLOCK_MAX_WORDS || b.segments.length === 1, `${b.id} has ${n} words`);
    }
  });

  test('planBlocks: an over-long segment is its own block; short ones are grouped', () => {
    const long = Array.from({length: 80}, () => 'w').join(' ');
    const blocks = planBlocks([{id: 'a', text: 'one two'}, {id: 'b', text: 'three'}, {id: 'c', text: long}, {id: 'd', text: 'four'}]);
    assert.deepEqual(blocks.map((b) => b.segments), [['a', 'b'], ['c'], ['d']]);
  });

  test('migration records where it came from; same input always hashes the same', () => {
    const a = migrateV1ToV2(joinFanout());
    const b = migrateV1ToV2(joinFanout());
    assert.equal(a.migration?.from, 1);
    assert.match(a.migration!.sourceSha256, /^[0-9a-f]{64}$/);
    assert.equal(a.migration!.sourceSha256, b.migration!.sourceSha256);
    const changed = joinFanout();
    changed.title += '!';
    assert.notEqual(migrateV1ToV2(changed).migration!.sourceSha256, a.migration!.sourceSha256);
  });

  test('review notes map to open/resolved with generated ids', () => {
    const raw = joinFanout();
    raw.reviewNotes = [{text: 'a'}, {text: 'b', resolved: true}];
    const v2 = migrateV1ToV2(raw);
    assert.deepEqual(v2.reviewNotes.map((n) => [n.id, n.status, n.type]), [['note01', 'open', 'general'], ['note02', 'resolved', 'general']]);
  });

  test('invalid v1 input is rejected, not guessed at', () => {
    const bad = joinFanout();
    bad.scenes[0].segments.pop();
    assert.throws(() => migrateV1ToV2(bad));
  });

  test('stableStringify ignores key order and undefined', () => {
    assert.equal(stableStringify({b: 1, a: [2, {d: 1, c: undefined}]}), stableStringify({a: [2, {d: 1}], b: 1}));
  });
});

describe('v2 -> v1 downgrade: loss needs acknowledgement, production never swaps the voice', () => {
  const v2 = (): EpisodeV2 => plain(migrateV1ToV2(joinFanout()));
  const qwen = (): EpisodeV2 => {
    const ep = v2() as any;
    ep.voice = {engine: 'qwen3-tts', profile: 'pip-voice-v1'};
    return EpisodeSchemaV2.parse(ep);
  };

  test('a lossy conversion throws unless acknowledged, and lists everything lost', () => {
    const ep = v2();
    ep.scenes[1].layout = {template: 'split-dense', captionZone: 'bottom', mascot: {mode: 'docked', position: 'bottom-left', scale: 0.55}};
    ep.narration.blocks[0].gapAfterSec = 0.8;
    ep.reviewNotes = [{id: 'n1', text: 'x', type: 'timing', status: 'wont-fix', anchor: {segment: 's01'}}];
    const parsed = EpisodeSchemaV2.parse(ep);
    assert.throws(() => downgradeV2ToV1(parsed), (e: Error) => e instanceof LossyDowngradeError && e.warnings.length === 3);
    const {warnings, episode} = downgradeV2ToV1(parsed, {acknowledgeLoss: true});
    assert.match(warnings.join(' | '), /layout "split-dense"/);
    assert.match(warnings.join(' | '), /block gap/);
    assert.match(warnings.join(' | '), /review note/);
    assert.ok(EpisodeSchema.safeParse(episode).success);
  });

  test('custom block boundaries count as loss (v1 would re-plan them)', () => {
    const ep = v2();
    ep.narration.blocks = [{id: 'blk01', segments: ep.narration.segments.map((s) => s.id)}];
    assert.equal(losslessV1(EpisodeSchemaV2.parse(ep)), null);
    assert.throws(() => downgradeV2ToV1(EpisodeSchemaV2.parse(ep)), LossyDowngradeError);
  });

  test('REGRESSION: production never substitutes Kokoro for a Qwen episode, even when loss is acknowledged', () => {
    for (const acknowledgeLoss of [false, true]) {
      assert.throws(
        () => downgradeV2ToV1(qwen(), {purpose: 'production', acknowledgeLoss}),
        (e: Error) => e instanceof UnsupportedVoiceConversionError && /Refusing to substitute a Kokoro voice/.test(e.message) && /qwen3-tts/.test(e.message),
      );
    }
  });

  test('an export of a Qwen episode needs acknowledgement and then carries a visible warning note', () => {
    assert.throws(() => downgradeV2ToV1(qwen()), LossyDowngradeError);
    const {episode, warnings} = downgradeV2ToV1(qwen(), {acknowledgeLoss: true});
    assert.match(warnings[0], /qwen3-tts/);
    assert.match(episode.reviewNotes.at(-1)!.text, /^LOSSY EXPORT from v2: .*Not for production\.$/);
    assert.equal(episode.reviewNotes.at(-1)!.resolved, false);
  });

  test('a Kokoro v2 episode with nothing v2-only converts silently for production', () => {
    const {episode, warnings} = downgradeV2ToV1(EpisodeSchemaV2.parse(v2()), {purpose: 'production'});
    assert.deepEqual(warnings, []);
    assert.equal(episode.voice.voice, 'af_heart');
  });

  test('losslessV1 returns null instead of throwing', () => {
    assert.ok(losslessV1(EpisodeSchemaV2.parse(v2())));
    assert.equal(losslessV1(qwen()), null);
  });
});

describe('legacy commands refuse unsupported v2 episodes (end to end)', () => {
  const dir = mkTmp('studio-compat-');
  const write = (name: string, ep: unknown) => {
    const f = join(dir, name);
    writeFileSync(f, JSON.stringify(ep));
    return f;
  };
  const validate = (f: string) => spawnSync('node', ['scripts/validate.ts', f], {cwd: ROOT, encoding: 'utf8'});
  const studioCheck = (f: string) => spawnSync(join(ROOT, 'studio'), ['check', f], {cwd: ROOT, encoding: 'utf8'});

  test('REGRESSION: a Qwen v2 episode is rejected by validate.ts and by ./studio check with a clear reason', () => {
    const ep: any = plain(migrateV1ToV2(joinFanout()));
    ep.voice = {engine: 'qwen3-tts', profile: 'pip-voice-v1'};
    const f = write('qwen.json', ep);
    for (const r of [validate(f), studioCheck(f)]) {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /cannot run in the legacy commands/);
      assert.match(r.stderr, /Refusing to substitute a Kokoro voice/);
    }
  });

  test('a v2 episode that would lose layout is rejected for production, not silently flattened', () => {
    const ep: any = plain(migrateV1ToV2(joinFanout()));
    ep.scenes[1].layout.template = 'split-dense';
    const r = validate(write('layout.json', ep));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /without losing information/);
    assert.match(r.stderr, /layout "split-dense"/);
  });

  test('a lossless Kokoro v2 episode is accepted and normalises to the same v1 episode as the original', () => {
    const f = write('kokoro.json', plain(migrateV1ToV2(joinFanout())));
    const out = join(dir, 'norm.json');
    const r = spawnSync('node', ['scripts/validate.ts', f, '--out', out], {cwd: ROOT, encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), plain(EpisodeSchema.parse(joinFanout())));
  });
});

describe('v2 validation', () => {
  const base = (): any => plain(migrateV1ToV2(joinFanout()));
  const issues = (ep: unknown) => {
    const r = validateEpisodeV2(ep);
    return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
  };

  test('the migrated episode is valid', () => assert.deepEqual(issues(base()), []));

  const cases: [string, (ep: any) => void, RegExp][] = [
    ['blocks missing a segment', (ep) => ep.narration.blocks[0].segments.pop(), /blocks must list every segment exactly once/],
    ['blocks out of order', (ep) => ep.narration.blocks.reverse(), /blocks must list every segment exactly once/],
    ['duplicate beat ids', (ep) => (ep.beats[1].id = ep.beats[0].id), /duplicate beats ids/],
    ['beat on an unknown segment (v1 rule, reported as beats)', (ep) => (ep.beats[0].segment = 'nope'), /^beats\.0\.segment: .*unknown segment/],
    ['cue from another scene type (v1 rule)', (ep) => (ep.beats[0].cue = 'card-1'), /^beats\.0\.cue: .*not valid for scene type/],
    ['scene list does not tile the narration (v1 rule)', (ep) => ep.scenes[0].segments.pop(), /scenes must list every segment/],
    ['legacy stage with a visible mascot', (ep) => (ep.scenes[0].layout.mascot.mode = 'docked'), /legacy-stage layout has no mascot slot/],
    ['note anchored to an unknown segment', (ep) => ep.reviewNotes.push({id: 'n9', text: 'x', anchor: {segment: 'nope'}}), /anchors to unknown segment/],
    ['unknown layout template', (ep) => (ep.scenes[0].layout.template = 'wide'), /Invalid option/],
    ['mascot scale out of range', (ep) => (ep.scenes[0].layout.mascot.scale = 9), /Too big/],
    ['a v1 document is not v2', (ep) => (ep.schemaVersion = 1), /Invalid input/],
  ];
  for (const [name, mutate, re] of cases) {
    test(`rejects: ${name}`, () => {
      const ep = base();
      mutate(ep);
      assert.match(issues(ep).join('\n'), re);
    });
  }
});

describe('anchor tracking (foundation for "anchor edited" warnings)', () => {
  test('an edited anchor word is noticed; an untouched one is not', () => {
    const ep = migrateV1ToV2(joinFanout());
    assert.ok(checkAnchors(ep).every((a) => a.status === 'ok'));
    const beat = ep.beats.find((b) => typeof b.at === 'object' && 'word' in b.at)!;
    const seg = ep.narration.segments.find((s) => s.id === beat.segment)!;
    const w = seg.text.split(/\s+/).filter(Boolean);
    w[(beat.at as {word: number}).word] = 'CHANGED';
    seg.text = w.join(' ');
    assert.equal(checkAnchors(ep).find((a) => a.beatId === beat.id)!.status, 'edited');
    seg.text = w.slice(0, (beat.at as {word: number}).word).join(' ') || 'x';
    assert.equal(checkAnchors(ep).find((a) => a.beatId === beat.id)!.status, 'out-of-range');
  });
});

describe('scripts/migrate.ts', () => {
  const run = (...args: string[]) => spawnSync('node', ['scripts/migrate.ts', ...args], {cwd: ROOT, encoding: 'utf8'});
  const dir = mkTmp('studio-mig-');

  test('--check proves the round trip and writes nothing without --out', () => {
    const r = run('episodes/join-fanout/episode.json', '--check');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /round trip ok/);
    assert.match(r.stdout, /nothing written/);
  });

  test('--out then --down restores the original v1 episode', () => {
    const v2 = join(dir, 'v2.json');
    const v1 = join(dir, 'v1.json');
    assert.equal(run('episodes/join-fanout/episode.json', '--out', v2).status, 0);
    const down = run(v2, '--down', '--out', v1);
    assert.equal(down.status, 0, down.stderr);
    assert.match(down.stdout, /nothing lost/);
    assert.deepEqual(plain(EpisodeSchema.parse(JSON.parse(readFileSync(v1, 'utf8')))), plain(EpisodeSchema.parse(joinFanout())));
  });

  test('--down refuses a lossy conversion without --accept-loss and writes nothing', () => {
    const ep: any = plain(migrateV1ToV2(joinFanout()));
    ep.voice = {engine: 'qwen3-tts', profile: 'pip-voice-v1'};
    const src = join(dir, 'qwen-v2.json');
    const out = join(dir, 'qwen-v1.json');
    writeFileSync(src, JSON.stringify(ep));
    const refused = run(src, '--down', '--out', out);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--accept-loss/);
    assert.equal(existsSync(out), false);
    const accepted = run(src, '--down', '--out', out, '--accept-loss');
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /not representable/);
    assert.match(readFileSync(out, 'utf8'), /LOSSY EXPORT/);
  });

  test('an invalid input exits 1 with the problem listed', () => {
    const bad = join(dir, 'bad.json');
    const ep = joinFanout();
    ep.events[0].cue = 'card-1';
    writeFileSync(bad, JSON.stringify(ep));
    const r = run(bad);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /events\.0\.cue/);
  });
});
