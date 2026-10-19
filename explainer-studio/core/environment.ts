// What this machine needs for the app to work, checked in one place so a missing piece is named with its fix before a job fails halfway.
// Used by `./studio-app doctor` and the Settings screen. Nothing here installs, downloads or changes anything.
import {spawnSync} from 'node:child_process';
import {existsSync, statfsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {checkFonts} from '../src/library/fontCheck.ts';

export type EnvNeed = 'app' | 'narration' | 'video' | 'checks';
export type EnvCheck = {id: string; label: string; ok: boolean; /** What it needs it for: app = nothing works without it. */ need: EnvNeed; detail: string; fix?: string};

const run = (cmd: string, args: string[], ms = 20_000) => {
  const r = spawnSync(cmd, args, {encoding: 'utf8', timeout: ms});
  return {ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), missing: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'};
};
const firstLine = (s: string) => s.split('\n')[0].slice(0, 120);
const hfHub = () => join(process.env.HF_HUB_CACHE ?? join(process.env.HF_HOME ?? join(homedir(), '.cache', 'huggingface'), 'hub'));

export const MODEL_CACHE = [
  {id: 'tts', repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16', label: 'Narration model (Qwen3-TTS 1.7B)'},
  {id: 'aligner', repo: 'mlx-community/Qwen3-ForcedAligner-0.6B-bf16', label: 'Word-timing model (Qwen3 forced aligner 0.6B)'},
];

export function checkEnvironment(root: string, opts: {projectRoot?: string; deep?: boolean} = {}): EnvCheck[] {
  const out: EnvCheck[] = [];
  const add = (c: EnvCheck) => out.push(c);
  const major = Number(process.versions.node.split('.')[0]);
  add({id: 'node', label: 'Node.js 24 or newer', need: 'app', ok: major >= 24, detail: `Node ${process.versions.node}`, fix: 'Install Node 24 or newer (https://nodejs.org), then run npm ci in the explainer-studio folder.'});
  add({id: 'node-modules', label: 'Node packages installed', need: 'app', ok: existsSync(join(root, 'node_modules', 'remotion')), detail: existsSync(join(root, 'node_modules')) ? 'node_modules is present' : 'node_modules is missing', fix: 'In the explainer-studio folder run: npm ci'});
  add({id: 'platform', label: 'Apple silicon Mac (for narration)', need: 'narration', ok: process.platform === 'darwin' && process.arch === 'arm64', detail: `${process.platform} ${process.arch}`, fix: 'Narration uses MLX, which needs an Apple silicon Mac. Everything else (editing, review, checks, rendering) does not.'});
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const r = run(tool, ['-version'], 10_000);
    add({id: tool, label: `${tool} on the PATH`, need: 'video', ok: r.ok, detail: r.ok ? firstLine(r.out) : r.missing ? 'not found' : firstLine(r.out), fix: 'Install it with Homebrew: brew install ffmpeg'});
  }
  const chrome = join(root, 'node_modules', '.remotion');
  add({id: 'browser', label: 'The browser Remotion renders with', need: 'video', ok: existsSync(chrome), detail: existsSync(chrome) ? 'downloaded' : 'not downloaded yet', fix: 'It is fetched the first time a video is rendered or checked (network needed once). To fetch it now: npx remotion browser ensure'});
  const py = join(root, '.venv', 'bin', 'python');
  add({id: 'python', label: 'Python environment for timing logic (.venv)', need: 'video', ok: existsSync(py) && (!opts.deep || run(py, ['-c', 'import numpy']).ok), detail: existsSync(py) ? '.venv is present' : '.venv is missing', fix: 'Run ./setup.sh (needs Homebrew python@3.12).'});
  const qpy = join(root, '.venv-qwen', 'bin', 'python');
  const qok = existsSync(qpy) && (!opts.deep || run(qpy, ['-c', 'import mlx_audio, mlx.core']).ok);
  add({id: 'qwen-python', label: 'Python environment for narration (.venv-qwen)', need: 'narration', ok: qok, detail: existsSync(qpy) ? (opts.deep ? (qok ? 'mlx-audio imports' : 'mlx-audio does not import') : '.venv-qwen is present (not imported)') : '.venv-qwen is missing', fix: 'python3.12 -m venv .venv-qwen && .venv-qwen/bin/pip install -r requirements-qwen.txt'});
  const hub = hfHub();
  for (const m of MODEL_CACHE) {
    const dir = join(hub, `models--${m.repo.replace('/', '--')}`, 'snapshots');
    add({id: `model-${m.id}`, label: m.label, need: 'narration', ok: existsSync(dir), detail: existsSync(dir) ? `in the cache (${hub})` : `not in ${hub}`, fix: `The model is never downloaded implicitly. To fetch it once, on purpose: ${join(root, '.venv-qwen/bin/hf')} download ${m.repo}`});
  }
  const bad = checkFonts(join(root, 'public', 'library', 'fonts'));
  add({id: 'fonts', label: 'Bundled fonts intact (Inter, JetBrains Mono)', need: 'video', ok: bad.length === 0, detail: bad.length ? bad.slice(0, 2).join('; ') : 'files and licences match their manifest', fix: 'Restore public/library/fonts from the repository (git checkout -- public/library/fonts).'});
  add({id: 'voice', label: 'Approved Pip voice reference', need: 'narration', ok: existsSync(join(root, 'reference', 'pip-voice', 'approved-v1', 'approved.json')), detail: 'reference/pip-voice/approved-v1', fix: 'Restore reference/ from the repository; it is never regenerated.'});
  try {
    const s = statfsSync(opts.projectRoot ?? root);
    const gb = (s.bavail * s.bsize) / 1e9;
    add({id: 'disk', label: 'At least 5 GB free where the project lives', need: 'app', ok: gb >= 5, detail: `${gb.toFixed(1)} GB free`, fix: 'Free some space; a project grows by about 10 to 20 MB per short episode.'});
  } catch { /* not available on this platform */ }
  return out;
}

export const environmentReady = (checks: EnvCheck[], need: EnvNeed[] = ['app', 'video']): boolean => checks.filter((c) => need.includes(c.need)).every((c) => c.ok);
