// Usage: node scripts/validate.ts <episode.json> [--out normalized.json]
// Exit code 0 = valid. Prints readable errors otherwise.
import {readFileSync, writeFileSync} from 'node:fs';
import {EpisodeSchema} from '../src/schema.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : undefined;

if (!file) {
  console.error('usage: node scripts/validate.ts <episode.json> [--out normalized.json]');
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${file}: ${(e as Error).message}`);
  process.exit(1);
}

const result = EpisodeSchema.safeParse(raw);
if (!result.success) {
  console.error(`Episode ${file} is invalid:`);
  for (const issue of result.error.issues) console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  process.exit(1);
}

if (out) writeFileSync(out, JSON.stringify(result.data, null, 2));
const ep = result.data;
console.log(
  `OK ${ep.id}: ${ep.narration.segments.length} segments, ${ep.scenes.length} scenes, ${ep.events.length} events, ` +
    `${Object.keys(ep.previews).length} previews`,
);
