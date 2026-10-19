// Creating and opening projects: a user's own project is a real, separate store; nothing is overwritten and the checkout is refused.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {ROOT, WorkspaceError, createProject, isProject, openProjectAt, refuseLocation} from '../../app/workspace.ts';
import {ProjectLockedError} from '../../core/project.ts';
import {getComponentValues} from '../../core/state.ts';
import {listEpisodes} from '../../core/episodes.ts';

const tmp = mkdtempSync(join(tmpdir(), 'studio-ws-'));
after(() => rmSync(tmp, {recursive: true, force: true}));
const refused = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof WorkspaceError && re.test(e.message));

test('a new project is a real store with the production settings and no episode, and it can be reopened', () => {
  const dir = join(tmp, 'a', 'my project');
  const made = createProject(dir, '  My explainers ');
  assert.equal(made.name, 'My explainers');
  assert.ok(isProject(dir));
  assert.match(readFileSync(join(dir, 'PROJECT.txt'), 'utf8'), /studio-app open/);
  const {project, name} = openProjectAt(dir);
  try {
    assert.equal(name, 'My explainers');
    assert.deepEqual(listEpisodes(project), []);
    const v = getComponentValues(project, 'none') as Record<string, unknown>;
    for (const k of ['voiceRuntime', 'aligner', 'mixParams', 'masteringParams', 'timelineLogic', 'versions', 'renderSettings', 'soundEvents']) assert.ok(k in v, `component ${k} is set`);
    assert.deepEqual(v.soundEvents, []);
  } finally { project.close(); }
});

test('nothing is overwritten: an existing project, a non-empty folder and a file are all refused untouched', () => {
  const dir = join(tmp, 'b');
  createProject(dir);
  refused(() => createProject(dir), /already holds a project/);
  const full = join(tmp, 'full');
  mkdirSync(full);
  writeFileSync(join(full, 'keep.txt'), 'mine');
  refused(() => createProject(full), /not empty/);
  assert.equal(readFileSync(join(full, 'keep.txt'), 'utf8'), 'mine');
  assert.equal(isProject(full), false);
  const file = join(tmp, 'afile');
  writeFileSync(file, 'x');
  refused(() => createProject(file), /not empty|is a file/);
  mkdirSync(join(tmp, 'empty'));
  assert.equal(createProject(join(tmp, 'empty')).name, 'empty', 'an empty existing folder is fine');
});

test('opening never creates: a missing folder and a folder that is not a project are refused and left alone', () => {
  refused(() => openProjectAt(join(tmp, 'nope')), /does not exist/);
  const plain = join(tmp, 'plain');
  mkdirSync(plain);
  refused(() => openProjectAt(plain), /not a studio project/);
  assert.equal(isProject(plain), false);
});

test('the checkout, its parents, the home folder and places inside another project are refused, also through a symlink', () => {
  refused(() => createProject(ROOT), /own checkout/);
  refused(() => openProjectAt(ROOT), /own checkout/);
  refused(() => createProject(join(ROOT, '..')), /contains this checkout/);
  refused(() => createProject(join(ROOT, 'src', 'newproject')), /own checkout/);
  refused(() => createProject(join(ROOT, 'episodes')), /own checkout/);
  refused(() => createProject(process.env.HOME!), /folder of its own/);
  const p = join(tmp, 'c');
  createProject(p);
  refused(() => createProject(join(p, 'inside')), /inside another project/);
  const link = join(tmp, 'link-to-root');
  symlinkSync(ROOT, link);
  refused(() => createProject(link), /own checkout/);
  refused(() => createProject(join(link, 'src', 'x')), /own checkout/);
  assert.doesNotThrow(() => refuseLocation(join(ROOT, 'projects', 'fine')), 'projects/ inside the checkout is allowed');
});

test('a project that is already open elsewhere is refused with a message, not a crash', () => {
  const dir = join(tmp, 'd');
  createProject(dir);
  const {project} = openProjectAt(dir);
  try {
    assert.throws(() => openProjectAt(dir), (e: unknown) => e instanceof ProjectLockedError && /open in another process/.test(e.message));
  } finally { project.close(); }
});

test('the command line refuses the checkout and a missing folder with exit code 2 and a plain message', () => {
  for (const [args, re] of [[['new', ROOT], /own checkout/], [['open', join(tmp, 'missing')], /does not exist/], [['new'], /needs exactly one folder/], [['--port', 'abc'], /--port needs a number/], [['bogus'], /Unknown argument/], [['--nope'], /Unknown option/]] as [string[], RegExp][]) {
    const r = spawnSync(process.execPath, [join(ROOT, 'app', 'main.ts'), '--no-open', ...args], {encoding: 'utf8', cwd: ROOT, timeout: 60_000});
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, re);
  }
});
