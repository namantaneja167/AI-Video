// Child process for the kill -9 test: saves in a loop and reports each save only after its commit returned.
// Usage: node kill-child.ts <projectRoot> <firstIndex>
import {mkdirSync, copyFileSync, existsSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import {putBytes} from '../../core/blobs.ts';
import {adoptEpisode, getEpisode, saveEpisode} from '../../core/episodes.ts';
import {Project} from '../../core/project.ts';

const [root, first] = process.argv.slice(2);
const p = Project.open(root, {create: true});
if (!existsSync(join(root, 'episodes/join-fanout/episode.json'))) {
  mkdirSync(join(root, 'episodes/join-fanout'), {recursive: true});
  copyFileSync(join(import.meta.dirname, '../fixtures/join-fanout/episode.v1.json'), join(root, 'episodes/join-fanout/episode.json'));
}
if (!p.db.prepare('SELECT 1 FROM episodes').get()) adoptEpisode(p, 'episodes/join-fanout/episode.json');
p.policy.checkpointOps = 4;
writeSync(1, 'READY\n');
const doc = JSON.parse(JSON.stringify(getEpisode(p, 'join-fanout')));
for (let i = Number(first); ; i++) {
  doc.title = `edit ${i}`;
  const r = saveEpisode(p, 'join-fanout', doc);
  putBytes(p, `blob ${i} ${'x'.repeat(i % 50)}`);
  writeSync(1, `saved ${i} ${r.seq}\n`);
}
