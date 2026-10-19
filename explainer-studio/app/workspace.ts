// Projects the app can open: the seeded demo, and ordinary persistent projects the user creates anywhere outside this checkout.
// Creating never touches an existing folder's contents; opening never creates; the real checkout is refused (adoption is paused).
import {existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {addReference} from '../core/artifacts.ts';
import {Project} from '../core/project.ts';
import {setComponent} from '../core/state.ts';
import {captureRenderSources, defaultTools, mixParamsValue, timelineLogicValue, versionsValue, voiceRuntimeValue} from '../core/toolchain.ts';

export const ROOT = resolve(import.meta.dirname, '..');

export const TTS = {repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16', revision: 'a6eb4f68e4b056f1215157bb696209bc82a6db48'};
export const ALIGN = {repo: 'mlx-community/Qwen3-ForcedAligner-0.6B-bf16', revision: '53c8c0e46733eec430e4b53dd6471d0e5dee45f8'};
export const MASTER = {lufs: -16, true_peak_db: -1.5, lra: 11};

export class WorkspaceError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkspaceError'; }
}

/** The production settings every project starts from: the approved Pip voice, the models, mixing, mastering and render settings. */
export function configureProject(p: Project): void {
  const approved = JSON.parse(readFileSync(join(ROOT, 'reference/pip-voice/approved-v1/approved.json'), 'utf8'));
  const refWav = join(ROOT, 'reference/pip-voice/approved-v1', approved.files.wav.file);
  addReference(p, 'pip-voice-v1', refWav, {script: approved.script, model: TTS.repo});
  const tools = defaultTools(ROOT);
  captureRenderSources(p, ROOT);
  setComponent(p, 'voiceRuntime', voiceRuntimeValue(p, {profile: 'pip-voice-v1', repo: TTS.repo, revision: TTS.revision, mlxAudio: '0.5.9', mlx: '0.32.4', maxTokens: 600, audioWorker: tools.audioWorker}));
  setComponent(p, 'aligner', {id: ALIGN.repo, revision: ALIGN.revision, grid: '80 ms'});
  setComponent(p, 'manualTiming', {});
  setComponent(p, 'soundEvents', []); // the project default every new episode starts from: no accents
  setComponent(p, 'soundAssets', {});
  setComponent(p, 'mixParams', mixParamsValue(tools.mix));
  setComponent(p, 'masteringParams', MASTER);
  setComponent(p, 'timelineLogic', timelineLogicValue(ROOT));
  setComponent(p, 'versions', versionsValue(ROOT, tools.renderWorker));
  setComponent(p, 'renderSettings', {width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 18, audio: 'aac'});
}

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);
/** The nearest existing ancestor's real path, so a symlink cannot hide the checkout or another project. */
function realish(path: string): string {
  let at = resolve(path);
  const rest: string[] = [];
  while (!existsSync(at)) { rest.unshift(basename(at)); const up = dirname(at); if (up === at) break; at = up; }
  return join(realpathSync(at), ...rest);
}

/** Folders a project may never live in: the checkout itself or anything in it except `projects/` and the demo workspace, and any other project. */
export function refuseLocation(target: string): void {
  const t = realish(target);
  const root = realpathSync(ROOT);
  if (t === sep || t === realpathSync(process.env.HOME ?? sep)) throw new WorkspaceError('Choose a folder of its own for the project, not a drive root or your home folder.');
  if (t === root) throw new WorkspaceError('That folder is the studio\'s own checkout, not a project. Adopting it is paused. Create a project in a folder of its own: ./studio-app new <folder>');
  if (inside(root, t)) throw new WorkspaceError(`${t} contains this checkout of the app. Choose a different folder.`);
  if (inside(t, root) && !inside(t, join(root, 'projects')) && !inside(t, join(root, 'demo-workspace'))) {
    throw new WorkspaceError('The studio\'s own checkout is not a project. Adopting it is paused; create a project in a folder of its own (or under projects/).');
  }
  for (let up = dirname(t); up !== dirname(up); up = dirname(up)) {
    if (existsSync(join(up, '.studio', 'project.sqlite'))) throw new WorkspaceError(`${up} is already a project; a project cannot be created inside another project.`);
  }
}

export const isProject = (dir: string): boolean => existsSync(join(dir, '.studio', 'project.sqlite'));

/** Creates a new project in a missing or empty folder. Never overwrites: a folder that has anything in it is refused. */
export function createProject(target: string, name?: string): {root: string; name: string} {
  const root = resolve(target);
  refuseLocation(root);
  if (isProject(root)) throw new WorkspaceError(`${root} already holds a project; open it instead (./studio-app open "${root}"). Nothing was changed.`);
  if (existsSync(root)) {
    if (!statSync(root).isDirectory()) throw new WorkspaceError(`${root} is a file, not a folder.`);
    if (readdirSync(root).length) throw new WorkspaceError(`${root} is not empty. Choose a new or empty folder; nothing was changed.`);
  }
  const label = (name ?? basename(root)).trim().slice(0, 60) || 'Project';
  mkdirSync(root, {recursive: true});
  const p = Project.open(root, {create: true});
  try {
    configureProject(p);
    p.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('project_name',?)").run(label);
  } catch (e) {
    p.close();
    throw e;
  }
  p.close();
  writeFileSync(join(root, 'PROJECT.txt'), `${label}\n\nA project of Explainer Studio (created ${new Date().toISOString()}).\nOpen it from the explainer-studio folder:  ./studio-app open "${root}"\nIts documents, takes, builds and notes live in .studio/ (never edit it by hand). Back it up with:\n  node scripts/project.ts backup <folder> --root "${root}"\n`);
  return {root, name: label};
}

/** Opens an existing project. Refuses the checkout, a folder that is not a project, and never creates anything. */
export function openProjectAt(target: string): {project: Project; name: string} {
  const root = resolve(target);
  if (!existsSync(root)) throw new WorkspaceError(`${root} does not exist. To make a project there: ./studio-app new "${root}"`);
  refuseLocation(root);
  if (!isProject(root)) throw new WorkspaceError(`${root} is not a studio project (it has no .studio folder). To make one: ./studio-app new <empty folder>. Nothing was changed.`);
  const project = Project.open(root);
  const row = project.db.prepare("SELECT value FROM meta WHERE key='project_name'").get() as {value: string} | undefined;
  return {project, name: row?.value ?? basename(root)};
}
