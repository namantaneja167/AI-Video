// Project store commands. Default project root is this repository; use --root to point elsewhere.
//   init | adopt <episode.json> | status | external | import-external <id> | keep-project <id>
//   revisions <id> | checkpoint <id> [--label L] | restore-revision <id> <n>
//   add-reference <name> <file> | verify | backup <dir> [--include-drafts] | restore <backupDir> <emptyTarget>
//   gc [--apply [--expect <digest>]] [--grace-days N] [--thin [--keep-recent N]]
//      dry run (default) prints the exact plan incl. revision thinning and its digest; --apply with --expect runs
//      only if a fresh plan has the same digest, otherwise it stops and asks for a new preview
import {join, resolve} from 'node:path';
import {approvalStatus, addReference, statusReport} from '../core/artifacts.ts';
import {createBackup, restoreBackup, verifyBackup} from '../core/backup.ts';
import {verifyAll} from '../core/blobs.ts';
import {
  adoptEpisode, createRevision, externalChanges, getEpisodeInfo, importExternal, keepProjectVersion, listEpisodes, listRevisions, restoreRevision,
} from '../core/episodes.ts';
import {DEFAULT_THIN, executeCleanup, planCleanup, planDigest} from '../core/gc.ts';
import {Project} from '../core/project.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const valueFlags = new Set(['--root', '--label', '--grace-days', '--expect', '--keep-recent']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));
const [cmd, ...rest] = pos;
const root = resolve(opt('--root') ?? join(import.meta.dirname, '..'));
const fail = (m: string): never => { console.error(m); process.exit(1); };
const out = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

try {
  if (cmd === 'restore') {
    const [from, to] = rest;
    if (!from || !to) fail('usage: restore <backupDir> <emptyTarget>');
    const rep = restoreBackup(resolve(from), resolve(to));
    out({restoredTo: resolve(to), missingBlobs: rep.missingBlobs, interruptedJobs: rep.interruptedJobs});
  } else if (cmd === 'verify-backup') {
    const v = verifyBackup(resolve(rest[0]));
    out({ok: v.ok, problems: v.problems});
    process.exit(v.ok ? 0 : 1);
  } else if (!cmd) {
    fail('usage: node scripts/project.ts <init|adopt|status|external|import-external|keep-project|revisions|checkpoint|restore-revision|add-reference|verify|backup|restore|gc> ...');
  } else {
    const p = Project.open(root, {create: cmd === 'init'});
    try {
      if (cmd === 'init') out({root, created: p.recovery.created});
      else if (cmd === 'adopt') out(adoptEpisode(p, rest[0]));
      else if (cmd === 'status') {
        const ids = rest[0] ? [rest[0]] : listEpisodes(p);
        out({
          recovery: p.recovery,
          external: externalChanges(p),
          episodes: ids.map((id) => ({id, ...getEpisodeInfo(p, id), revisions: listRevisions(p, id).length, notFresh: statusReport(p, id).notFresh, unsetComponents: statusReport(p, id).unsetComponents, approval: approvalStatus(p, id)})),
        });
      } else if (cmd === 'external') out(externalChanges(p));
      else if (cmd === 'import-external') out(importExternal(p, rest[0]));
      else if (cmd === 'keep-project') out(keepProjectVersion(p, rest[0]));
      else if (cmd === 'revisions') out(listRevisions(p, rest[0]));
      else if (cmd === 'checkpoint') out({revision: createRevision(p, rest[0], {kind: 'milestone', label: opt('--label')})});
      else if (cmd === 'restore-revision') out(restoreRevision(p, rest[0], Number(rest[1])));
      else if (cmd === 'add-reference') out(addReference(p, rest[0], resolve(rest[1])));
      else if (cmd === 'verify') {
        const v = verifyAll(p);
        out(v);
        process.exitCode = v.missing.length || v.corrupt.length ? 1 : 0;
      } else if (cmd === 'backup') out(createBackup(p, resolve(rest[0]), {includeDrafts: flag('--include-drafts')}));
      else if (cmd === 'gc') {
        const days = Number(opt('--grace-days') ?? 14);
        const plan = planCleanup(p, {graceMs: days * 86_400_000, thin: flag('--thin') ? {...DEFAULT_THIN, keepRecent: Number(opt('--keep-recent') ?? DEFAULT_THIN.keepRecent)} : false});
        const digest = planDigest(plan);
        const expect = opt('--expect');
        if (flag('--apply') && expect && expect !== digest) fail(`the plan changed since it was previewed (previewed ${expect}, now ${digest}); nothing was removed. Run a new preview.`);
        if (flag('--apply') && !expect) fail('--apply needs --expect <digest> from a preview, so that exactly the previewed plan runs');
        const r = flag('--apply') ? executeCleanup(p, plan) : {...plan, applied: false};
        out({applied: r.applied, digest, thinned: r.thinned, blobs: r.blobs.length, orphanFiles: r.orphanFiles.length, tmpEntries: r.tmpEntries.length, freedBytes: r.freedBytes, note: r.applied ? 'applied' : `dry run: nothing was removed (apply with: gc --apply --expect ${digest})`});
      } else fail(`unknown command "${cmd}"`);
    } finally {
      p.close();
    }
  }
} catch (e) {
  console.error(`${(e as Error).name}: ${(e as Error).message}`);
  process.exit(1);
}
