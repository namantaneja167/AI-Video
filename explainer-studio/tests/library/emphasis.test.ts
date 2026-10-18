import assert from 'node:assert/strict';
import {cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {annotateTimeline} from '../../core/timeline.ts';
import {checkFonts} from '../../src/library/fontCheck.ts';
import {migrateV1ToV2} from '../../src/migrate.ts';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {ROOT} from '../helpers.ts';

const v1 = JSON.parse(readFileSync(join(ROOT, 'episodes/join-fanout/episode.json'), 'utf8'));
const base = () => migrateV1ToV2(v1) as any;
const withEmphasis = (emphasis: unknown) => {
  const d = base();
  d.narration.segments[0].text = 'Faster at what, exactly?';
  d.narration.segments[0].emphasis = emphasis;
  return d;
};

describe('caption emphasis ranges', () => {
  test('a range that matches the words is accepted', () => {
    assert.ok(EpisodeSchemaV2.safeParse(withEmphasis([{from: 1, to: 3, text: 'at what,'}])).success);
  });
  test('a range outside the sentence, overlapping, empty or with the wrong words is rejected with a specific message', () => {
    const msg = (e: unknown) => (EpisodeSchemaV2.safeParse(withEmphasis(e)).error?.issues.map((i) => i.message) ?? ['accepted']).join(' | ');
    assert.match(msg([{from: 2, to: 9, text: 'x'}]), /outside the 4 words/);
    assert.match(msg([{from: 1, to: 3, text: 'at what,'}, {from: 2, to: 4, text: 'what, exactly?'}]), /in order and must not overlap/);
    assert.match(msg([{from: 2, to: 2, text: 'x'}]), /outside|\bfrom\b|must/i);
    assert.match(msg([{from: 0, to: 1, text: 'Slower'}]), /the emphasised words are now "Faster"/);
  });
  test('editing the sentence after writing the range is noticed instead of emphasising other words', () => {
    const d = withEmphasis([{from: 1, to: 3, text: 'at what,'}]);
    d.narration.segments[0].text = 'Faster than what, exactly?';
    assert.match(EpisodeSchemaV2.safeParse(d).error!.issues.map((i) => i.message).join(' | '), /are now "than what,", not "at what,"/);
  });
  test('the timeline gets the ranges per caption phrase, relative to each phrase', () => {
    const doc = EpisodeSchemaV2.parse(withEmphasis([{from: 1, to: 3, text: 'at what,'}]));
    const seg = doc.narration.segments[0].id;
    const w = (text: string, i: number) => ({text, start: i, end: i + 1});
    // The sentence is shown as two phrases of two words each; the range covers the 2nd and 3rd words.
    const tl: any = {captions: [{segment: seg, text: 'Faster at', words: [w('Faster', 0), w('at', 1)]}, {segment: seg, text: 'what, exactly?', words: [w('what,', 2), w('exactly?', 3)]}], segments: []};
    annotateTimeline(tl, doc);
    assert.deepEqual(tl.captions[0].emphasis, [[1, 2]]);
    assert.deepEqual(tl.captions[1].emphasis, [[0, 1]]);
  });
});

describe('bundled fonts', () => {
  const dir = join(ROOT, 'public/library/fonts');
  test('the project font folder passes its own check, with a licence beside each font', () => {
    assert.deepEqual(checkFonts(dir), []);
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    for (const f of m.files) assert.equal(f.license, 'OFL-1.1');
  });
  test('removing a font file, or changing it, makes the check fail instead of falling back', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'studio-fonts-'));
    try {
      cpSync(dir, tmp, {recursive: true});
      unlinkSync(join(tmp, 'InterVariable.woff2'));
      assert.match(checkFonts(tmp).join(' '), /Inter: font file InterVariable.woff2 is missing/);
      cpSync(dir, tmp, {recursive: true});
      writeFileSync(join(tmp, 'JetBrainsMono-Variable.woff2'), 'not a font');
      assert.match(checkFonts(tmp).join(' '), /JetBrains Mono: font file .* differs from the manifest/);
      unlinkSync(join(tmp, 'JetBrainsMono-OFL.txt'));
      assert.match(checkFonts(tmp).join(' '), /licence file JetBrainsMono-OFL.txt is missing/);
    } finally { rmSync(tmp, {recursive: true, force: true}); }
  });
});
