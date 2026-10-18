// Usage:
//   node scripts/migrate.ts <episode.json>                  summarise the v1 -> v2 migration (writes nothing)
//   node scripts/migrate.ts <episode.json> --out v2.json    write the v2 episode
//   node scripts/migrate.ts <episode.json> --check          also prove v1 -> v2 -> v1 returns the same episode
//   node scripts/migrate.ts <v2.json> --down [--out v1.json] [--accept-loss]
//       v2 -> v1. Refuses if anything would be lost unless --accept-loss is given; the result is for inspection, not production
// Never edits the input file. Exit code 0 = ok, 1 = invalid input or failed check.
import {readFileSync, writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {EpisodeSchema} from '../src/schema.ts';
import {downgradeV2ToV1, LossyDowngradeError, migrateV1ToV2, validateEpisodeV2} from '../src/migrate.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name: string) => args.includes(name);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : undefined;

if (!file) {
  console.error('usage: node scripts/migrate.ts <episode.json> [--out file] [--check] [--down]');
  process.exit(2);
}

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  fail(`Cannot read ${file}: ${(e as Error).message}`);
}

if (flag('--down')) {
  const v2 = validateEpisodeV2(raw);
  if (!v2.ok) fail(`${file} is not a valid v2 episode:\n${v2.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
  else {
    let result;
    try {
      result = downgradeV2ToV1(v2.episode, {acknowledgeLoss: flag('--accept-loss'), purpose: 'export'});
    } catch (e) {
      if (e instanceof LossyDowngradeError) fail(`${e.message}\nNothing written. Re-run with --accept-loss to export anyway (for inspection only).`);
      throw e;
    }
    const {episode, warnings} = result;
    for (const w of warnings) console.error(`warning: ${w}`);
    if (out) writeFileSync(out, JSON.stringify(episode, null, 2) + '\n');
    console.log(`OK v1 ${episode.id}: ${warnings.length ? `${warnings.length} thing(s) not representable` : 'nothing lost'}${out ? `, wrote ${out}` : ''}`);
  }
} else {
  const v1 = EpisodeSchema.safeParse(raw);
  if (!v1.success) fail(`${file} is not a valid v1 episode:\n${v1.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`);
  else {
    const v2 = migrateV1ToV2(raw);
    const check = validateEpisodeV2(v2);
    if (!check.ok) fail(`migrated episode failed v2 validation:\n${check.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    if (flag('--check')) {
      const back = downgradeV2ToV1(v2);
      if (back.warnings.length || !isDeepStrictEqual(back.episode, v1.data)) fail('round trip FAILED: v1 -> v2 -> v1 did not reproduce the original episode');
      console.log('round trip ok: v1 -> v2 -> v1 reproduces the original episode');
    }
    if (out) writeFileSync(out, JSON.stringify(v2, null, 2) + '\n');
    console.log(
      `OK v2 ${v2.id}: ${v2.narration.segments.length} segments in ${v2.narration.blocks.length} block(s), ${v2.scenes.length} scenes, ${v2.beats.length} beats` +
        `${out ? `, wrote ${out}` : ' (nothing written; use --out)'}`,
    );
  }
}
