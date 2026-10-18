# 04 · Architecture

Diagram: [diagrams/architecture.html](diagrams/architecture.html) (validated; visual checks in the same folder).

Principle: connect the existing Qwen and Remotion code behind a thin local app. No rewrite. The `./studio` CLI keeps working throughout.

## Shape

| Layer | Choice | Reason |
|---|---|---|
| App | Local web app. Node 26 server bound to 127.0.0.1 with Host and token checks, `node:http`, `node:sqlite`, server-sent events. React SPA bundled with an explicit `esbuild` step. | Node 26 is already installed; Remotion's Player is a React component, so preview is live and exact. |
| Preview | `@remotion/player` | Same components that render the MP4. |
| TTS worker | Long-lived Python process (`.venv-qwen`), JSON lines over stdio: load, generate, cancel, unload, status. Progress by streamed audio. Unloads after idle. | Loading the model takes 2.6 s and about 4.3 GB; keep it resident only while needed. Derived from `pip_scene_narration.py`. |
| Audio analysis | Python tool derived from `pip_scene_timing.py`: segment detection from the envelope, estimated word times (flagged *estimated*), mouth envelope, loudness. | Reuses working code. |
| Timeline | `pipeline/timeline.py` ported to TypeScript, with golden-parity tests against current output. | One language for app logic; parity tests make the port safe. |
| Schema | `episode.json` v2 (blocks, layout, beats, voice profile, review notes) with a v1 migration. | The current schema cannot express these. |
| Composition | One generic `Episode` composition driven by `inputProps`; scenes come from a registry. | Replaces the per-variant manifest hack. |
| Render | `renderMedia` with `serveUrl`, a per-render staging `publicDir`, `cancelSignal`, `onProgress`, `frameRange`. | All present in installed Remotion 4.0.536. |

Dependencies to declare explicitly (currently only transitive): `@remotion/renderer`, `@remotion/bundler`, `@remotion/player` pinned to 4.0.536, plus `esbuild`.

Alternatives rejected: Electron (heavy, no gain for a local tool), native SwiftUI (loses the live Remotion preview), extending Remotion Studio (poor fit for a multi-stage workflow).

## Storage

```
episodes/<id>/            tracked in git
  episode.json
  revisions/
  imports/                ChatGPT packets as pasted, with hashes
  reviews/
.studio/                  gitignored
  studio.sqlite           jobs, artifact index, UI state
  artifacts/<hash>/       takes, timing, renders, keyed by input hash
  journal/                append-only, fsync'd
  tmp/<jobId>/            deleted on cancel or fail
  logs/
```

Writes: journal first, then atomic temp-and-rename. Checkpoints become revisions. Restore creates a new revision. PID lockfile for a single writer. On boot: replay journal, reconcile jobs.

## Invalidation

Content-hash dependency graph: spoken text → block audio → timing → beats → render. Each artifact stores its input hash; status is computed by comparison. See the table in [02](02-product-spec.md#4-invalidation).

## Jobs

Persisted in SQLite. Two lanes: heavy (concurrency 1: TTS, renders) and light (parallel). Lifecycle is in [02](02-product-spec.md#5-jobs). Memory preflight reads `kern.memorystatus_vm_pressure_level` and swap; per-job peak and pressure are logged.

## Mapping from existing code

| Existing | Becomes |
|---|---|
| `scripts/pip_scene_narration.py` | TTS worker |
| `scripts/pip_scene_timing.py` | Audio-analysis tool |
| `scripts/qwen_mem_monitor.sh` | Memory guard inside the job runner |
| `pipeline/timeline.py` | `src/core/timeline.ts` (parity-tested) |
| `src/schema.ts` | Schema v2 plus migration |
| `src/Episode.tsx`, `src/scenes/*` | Generic Episode + scene registry (Tier 1) |
| `src/art/pip-scene/*` | First Tier 3 scene; parity target |
| `studio.py` | Stays; later thin wrapper over the same core |
| `reference/pip-voice/approved-v1/` | Read-only voice profile |

## Risks

| Risk | Mitigation |
|---|---|
| 16 GB machine: TTS peaked at about 8.0–8.6 GB with 4–9 GB swap already in use *(measured)* | Heavy lane of one, pressure guard, unload on idle |
| TTS output may change across model or library versions | Cache key includes model snapshot and engine version; takes are stored, not regenerated silently |
| Prosody drift between blocks | Block size cap, explicit pacing, listening check on a real episode |
| Word timing is derived from the audio envelope, not forced alignment | Mark as estimated; optional aligner model is an open decision |
| Remotion licence | Free for individuals and companies of up to 3; a company licence is needed for 4+ people, and a separate arrangement applies to products that offer video creation to others. Re-check before any distribution |
| Scope | Phases with acceptance criteria; each phase usable alone |
| Doc drift | Docs updated as part of each phase's acceptance |
