// Usage: node scripts/validate.ts <episode.json> [--out normalized.json]
// Exit code 0 = valid. Prints readable errors otherwise.
import {readFileSync, writeFileSync} from 'node:fs';
import {EpisodeSchema} from '../src/schema.ts';
import {downgradeV2ToV1, LossyDowngradeError, UnsupportedVoiceConversionError, validateEpisodeV2} from '../src/migrate.ts';

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

// A v2 episode is only accepted here if it converts to v1 with nothing lost. Production never substitutes a
// Kokoro voice for another engine and never drops layout or notes silently.
let candidate = raw;
if (typeof raw === 'object' && raw !== null && (raw as {schemaVersion?: unknown}).schemaVersion === 2) {
  const v2 = validateEpisodeV2(raw);
  if (!v2.ok) {
    console.error(`Episode ${file} is invalid (v2):`);
    for (const i of v2.issues) console.error(`  - ${i.path}: ${i.message}`);
    process.exit(1);
  } else {
    try {
      candidate = downgradeV2ToV1(v2.episode, {purpose: 'production'}).episode;
    } catch (e) {
      if (e instanceof UnsupportedVoiceConversionError) console.error(`Episode ${file} cannot run in the legacy commands: ${e.message}`);
      else if (e instanceof LossyDowngradeError) console.error(`Episode ${file} cannot run in the legacy commands without losing information:\n  - ${e.warnings.join('\n  - ')}`);
      else throw e;
      process.exit(1);
    }
  }
}

const result = EpisodeSchema.safeParse(candidate);
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
