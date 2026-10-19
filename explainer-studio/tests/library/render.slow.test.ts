// Render-based checks (a browser renders stills; about a minute). Run with STUDIO_SLOW=1 (npm run test:slow).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {ROOT, mkTmp} from '../helpers.ts';
import {acquireHeavy} from '../heavy-lock.ts';

const skip = process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to render stills';
const stills = (spec: object) => execFileSync('node', [join(ROOT, 'scripts/phase3_stills.ts'), (() => { const f = join(mkTmp('studio-slow-'), 'spec.json'); writeFileSync(f, JSON.stringify(spec)); return f; })()], {encoding: 'utf8', cwd: ROOT});
// Both tests compare against media that is made by running the pipeline, never committed (public/generated, out/). A clean checkout does not have it,
// and making it needs the Kokoro voice model (a download that is never started implicitly), so there they are skipped with the reason, not passed.
const legacyGenerated = join(ROOT, 'public/generated/join-fanout/preview-join-multiplication');
const needLegacy = existsSync(join(legacyGenerated, 'timeline.json')) ? false : 'needs public/generated/join-fanout/preview-join-multiplication, made by ./studio narrate (downloads the Kokoro model); not in a clean checkout';
const needProto = existsSync(join(ROOT, 'out/pip_scene_10x_v1.mp4')) ? false : 'needs out/pip_scene_10x_v1.mp4, the prototype\'s own render (an output, restored from a backup); not in a clean checkout';
const same = (a: string, b: string) => readFileSync(a).equals(readFileSync(b));

describe('rendered output through the library composition', {skip}, () => {
  // Renders are heavy: they take their turn with the other heavy suites (see tests/heavy-lock.ts).
  let release = () => {};
  before(async () => { release = await acquireHeavy('library render'); }, {timeout: 40 * 60_000});
  after(() => release());
  test('legacy dark episodes render through the new composition exactly as through the original EpisodeVideo path', {skip: needLegacy}, () => {
    const dir = mkTmp('studio-legacy-');
    const pub = join(dir, 'public');
    const gen = join(pub, 'generated', 'join-fanout', 'preview-join-multiplication');
    mkdirSync(gen, {recursive: true});
    cpSync(join(ROOT, 'public/generated/join-fanout/preview-join-multiplication'), gen, {recursive: true});
    const data = {episode: JSON.parse(readFileSync(join(gen, 'episode.json'), 'utf8')), timeline: JSON.parse(readFileSync(join(gen, 'timeline.json'), 'utf8'))};
    const frames = [0, 40, 95, 160, 230, 300].map((f) => Math.min(f, Math.ceil(data.timeline.durationSec * 30) - 1));
    const list = frames.flatMap((f) => [
      {composition: 'join-fanout--preview-join-multiplication', inputProps: {}, frame: f, out: join(dir, `old-${f}.png`)},
      {composition: 'studio-episode', inputProps: {episode: 'join-fanout', variant: 'preview-join-multiplication', data}, frame: f, out: join(dir, `new-${f}.png`)},
    ]);
    stills({publicDir: pub, stills: list});
    for (const f of frames) assert.ok(same(join(dir, `old-${f}.png`), join(dir, `new-${f}.png`)), `frame ${f} differs between the old and new composition`);
  });

  test('the frozen prototype scene, registered as a custom scene with its original timing and audio, renders the same frames as its own composition', {skip: needProto}, () => {
    const dir = mkTmp('studio-proto-');
    execFileSync('node', [join(ROOT, 'scripts/phase3_parity.ts'), '--out', dir], {encoding: 'utf8', cwd: ROOT});
    const frames = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8')) as [string, number][];
    assert.equal(frames.length, 14);
    for (const [name] of frames) assert.ok(same(join(dir, `live-${name}.png`), join(dir, `lib-${name}.png`)), `frame ${name} differs`);
  });
});
