# 04 · Architecture

Diagram: [diagrams/architecture.html](diagrams/architecture.html) (validated; visual-check receipt in the same folder).

Principle: connect the existing Qwen, Python timeline and Remotion code behind a thin local app. No rewrite. The legacy `./studio` commands keep working throughout.

## Shape

| Layer | Choice | Reason |
|---|---|---|
| App | Local browser app. Node server bound to 127.0.0.1 with host and token checks, `node:http`, `node:sqlite`, server-sent events. React single-page UI bundled with an explicit build step. | Node 26 is installed; Remotion's Player is a React component, so preview uses the same components that render the MP4. |
| Preview | `@remotion/player` | Live preview, exact component parity. |
| Audio worker | Long-lived Python process (`.venv-qwen`), JSON lines over stdio: load, generate, align, unload, status, cancel. Loads one model at a time. | Derived from `scripts/pip_scene_narration.py`. Qwen3-TTS load is 2.6 s and the active set is about 4.3 GB, so it is held only while needed. |
| Timeline | **Existing Python `pipeline/timeline.py`, unchanged.** A Node wrapper calls it with JSON in and JSON out. | See "Timeline decision" below. |
| Audio analysis | Python tool derived from `scripts/pip_scene_timing.py` (envelope, estimated timing fallback, mouth track). | Reuses working code; it is the `estimated` source. |
| Schema | `episode.json` v2 (blocks, layout, beats, voice profile, review notes) with a tested v1 migration and a v2-to-v1 downgrade for legacy commands. | Draft and tests exist from Phase 0 (`src/schema2.ts`, `src/migrate.ts`). |
| Composition | One generic `Episode` composition driven by input props; scenes from a registry. | Replaces the per-variant manifest. |
| Render | `renderMedia` with a prebuilt bundle, a per-job workspace, `cancelSignal`, `onProgress`, `frameRange`. | Present in installed Remotion 4.0.536. |

Alternatives rejected: Electron (heavy, no gain for a local tool), native SwiftUI (loses the live Remotion preview), extending Remotion Studio (poor fit for a multi-stage workflow).

## Project state store and recovery

### One authority

The **project database** (`.studio/project.sqlite`, write-ahead log, `synchronous=FULL`) is the only authoritative store of project state: working documents, revisions, takes and selections, timing metadata, jobs and attempts, snapshots, artifact index, approvals, review notes, UI state. Large files are content-addressed blobs in `.studio/blobs/<aa>/<sha256>`, referenced from the database.

What is *not* a second store:

| File | Role |
|---|---|
| `episodes/<id>/episode.json` | One-way projection of the current revision for git and the legacy CLI. Rebuildable from the database. Never read as truth without a hash check. |
| `.studio/blobs/` | Bytes only. Meaning lives in the database; a blob with no reference is garbage. |
| `.studio/backups/` | Copies of the database for recovery, not live state. |

There is no separate edit journal: a committed transaction is the journal. This removes a whole class of "journal and file disagree" failures.

### Layout

```
episodes/<id>/episode.json     tracked projection
sources/                       tracked: approved research and imports as received
reference/                     tracked: approved voice references (small)
public/assets/, public/fonts/  tracked: curated art, licences, font files
.studio/                       ignored by git
  project.sqlite (+ -wal, -shm)
  blobs/                       takes, timing, mixes, renders, snapshots of code/fonts
  backups/  tmp/<jobId>/  logs/  lock
```

Policy: approved source materials are tracked in git. Generated media (takes, mixes, renders, exports) is excluded from ordinary history and protected by explicit project backups.

### Commit protocol

1. A blob is written to a temp file, flushed, renamed to its hash name, **then** referenced. A crash leaves at worst an unreferenced blob, never a reference to a missing file.
2. An edit is validated, then applied in **one transaction** (new working document, op record, commit sequence number). The UI shows "saved" only after the commit returns.
3. After commit, the projection writer rewrites `episode.json` atomically (temp file and rename) and records the hash it wrote.
4. Revisions are immutable rows. Restore inserts a new revision.

### Recovery protocol (every start)

1. Acquire the project lock (an atomically created file holding the process id and start time). A lock is taken over only when its holder is **confirmed** gone: the OS reports no such process, or the pid now has a different start time. If the holder cannot be inspected (blocked or failing process inspection, permission denied, no recorded start time, unreadable lock file) the result is *unknown* and the open is refused.
2. Open the database; WAL recovery is automatic. Run `quick_check`. If it fails, stop and offer: restore the newest usable automatic backup (candidates that are unreadable or fail their own checks are skipped, older ones tried; the current database is moved aside only after a candidate's copy has been validated), or rebuild from the tracked projections (reduced: no jobs, no take selections) after explicit confirmation.
3. Apply forward-only schema migrations, each in a transaction, after copying the database to `backups/`.
4. Reconcile blobs: confirm each referenced file exists; verify hashes lazily on use and in a full verify command. A missing blob marks the artifact missing and its dependents stale.
5. Reconcile jobs: any job that was preparing or running becomes Failed (interrupted). Processes recorded for it (id, start time, group) are terminated if still alive, its workspace is deleted and the heavy slot is released.
6. Reconcile the projection: if the file on disk differs from the recorded hash, mark an **external change pending** for the author to import as a new revision; if the file is missing, rewrite it.
7. Restore UI state (open episode, view, panel sizes, timeline height) from the database.

Automatic backups: a database copy (`VACUUM INTO`) at open when the last one is older than six hours, before migrations and before approval; the newest ten are kept. A background timer arrives with the long-running app (Phase 4).

### As implemented in Phase 1

Code lives in `core/` and is driven from `scripts/project.ts`; nothing in it is imported by Remotion or by the legacy commands.

| Module | Responsibility |
|---|---|
| `db.ts` | Schema (version 1), forward-only migrations, WAL and `synchronous=FULL`, foreign keys on |
| `project.ts` | Open and recovery protocol, lock, transactions, automatic backups, corruption recovery |
| `blobs.ts` | Content-addressed store: write, flush, rename, then register; verify on reference and in full when needed |
| `episodes.ts` | Adopt, transactional save, revisions, restore, projection and external-change handling, merge of hand-edited v1 files |
| `deps.ts`, `state.ts` | Dependency hashes (pure) and the recorded components, file sets and references |
| `artifacts.ts` | Jobs on frozen snapshots, outputs, freshness, approval, approved references |
| `gc.ts`, `backup.ts` | Reachability, revision thinning, cleanup; backup and verified restore |

Decisions made while implementing:

* **Freshness is computed.** An output is fresh if its recorded input hash equals today's expected hash and everything upstream is fresh. Expected hashes include the upstream outputs' blob hashes, so swapping a take or regenerating timing stales what was built on it.
* **Takes.** The input hash excludes the seed; the cache key adds it. A re-roll of a fresh take stays unselected until the author selects it; a take for edited text is selected automatically because the old selection is stale.
* **Snapshots.** A snapshot is a manifest (revision, frozen document blob, component hashes, upstream blobs, expected hashes) stored under its own hash. Finishing a job compares the snapshot's hash for that output with today's inside one transaction.
* **Projection ownership.** The file is ours if its bytes equal the last confirmed projection, or a projection committed since (a crash between commit and file write). Any other bytes are an external edit and are never overwritten. Adopting an episode leaves the file untouched until the first save.
* **Projection format.** v1 when the document converts to v1 with nothing lost, otherwise v2. This keeps the legacy commands working for ordinary episodes and makes them refuse, with the reason, anything they cannot represent.
* **Approval** is a record plus a pointer that only `approve` moves. Whether it is valid is computed on each call by comparing the approved render's input parts with today's.
* **Cleanup roots:** every remaining revision's references, current outputs, approvals (file and artifact), approved references, pinned outputs, component file sets, and the snapshots of running jobs. Thinning removes revision rows first, then cleanup collects what became unreachable.

### Compatibility with the legacy commands

`downgradeV2ToV1` is the only way a v2 document becomes v1. Lossless conversions are silent. A lossy conversion throws unless acknowledged, and a non-Kokoro voice is never converted for production, acknowledged or not (`UnsupportedVoiceConversionError`). `scripts/validate.ts`, which every legacy command calls, applies the production rule, so `./studio check|narrate|render` on a Qwen episode stops with an explanation instead of narrating it in a different voice. An acknowledged export (`scripts/migrate.ts --down --accept-loss`) writes an unresolved review note saying the file is not for production.

### Backup and restore

An explicit backup is a self-contained folder with a manifest (app version, schema version, every file with size and SHA-256). It contains:

* the database copy;
* every blob reachable from retained revisions: **selected narration takes**, timing, mixes, snapshots of fonts and code used by retained renders;
* approved references, approved final renders and export packages;
* tracked source files (episodes, sources, references, assets, fonts) so it stands alone;
* optionally, draft renders (off by default). Unreferenced cache is never included.

Restore targets an empty folder. Order: validate the whole manifest (shape, kinds, normalised relative paths, allowed destinations, required database entry, duplicate and colliding destinations); verify every file, rejecting symlinks; stage in a sibling folder, confirming each destination stays inside it; validate the staged database; run the recovery protocol on it; publish with one rename. It refuses to overwrite an existing project and leaves nothing behind on failure.

### Cache cleanup

Two steps. `planCleanup` changes nothing: it chooses the revisions that thinning would remove, then marks and sweeps as if they were gone, and records a fingerprint of every table and file listing the plan depends on. `executeCleanup` runs exactly that plan in one transaction and refuses (and removes nothing) if the fingerprint no longer matches, so a stale preview must be refreshed. A dry run is the plan; it equals what an apply does. Roots: all **retained** revisions (their selected takes, timing, mixes, asset, font and code snapshots), current artifacts, approved renders and packages, approved references, review rounds that are still retained, pinned items, and the snapshots of jobs in progress. Sweep removes only unreachable blobs older than a grace period. Revision retention keeps milestones, approvals and final-render revisions forever and thins older automatic checkpoints; because thinning removes revisions before sweeping, nothing a retained revision references is ever deleted.

## Jobs

Persisted in the same database. Two lanes: heavy (concurrency 1: TTS, alignment, mastering, renders) and light. The lifecycle is in [02](02-product-spec.md#81-lifecycle). Every job is bound to an immutable input snapshot ([02](02-product-spec.md#42-immutable-input-snapshots)); outputs are stored by snapshot hash; the current and approved pointers are updated by compare-and-set inside a transaction.

### Voice to render transition

Do not rely on timestamps showing the jobs did not overlap. The scheduler performs and logs an explicit hand-over:

1. `unload` to the audio worker; it replies with active and cached framework memory after clearing.
2. The scheduler samples the worker's resident memory **and** the framework's own counters (measured in Phase 2: on this machine MLX buffers are largely invisible to resident size, so resident size alone cannot confirm a release; see [06](06-phase2-acceptance.md#finding-resident-size-does-not-show-model-memory)).
3. If there was no reply, or memory stayed above a threshold, the worker process tree is terminated and its exit confirmed.
4. The render starts only after step 2 or 3 succeeds. If neither can be confirmed the render job fails in Preparing with a clear reason and the slot is released.

### Cancellation and the heavy slot

Every process a job starts is recorded with its identity (pid plus start time) under the job's attempt. Cancel sends a terminate signal to the whole tree, waits a short grace period, force-kills what is left, then walks the process table from the job's root to confirm no descendant remains (browser and encoder children may not stay in the group, so the walk is required). Only then is the temporary workspace deleted and the heavy slot released. The slot is released in a `finally` path, and on start-up the recovery protocol releases slots held by dead jobs.

## Timeline decision

Keep `pipeline/timeline.py` as is. It is pure logic (spoken-to-displayed word mapping, caption phrasing, cue timing, scene boundaries, previews) with no TTS dependency, and it already works. The app calls it through a thin JSON-in, JSON-out entry point added when the job runner needs it.

Port it to TypeScript **only if a concrete requirement appears**, for example: interactive editing needs timeline recomputation faster than a Python call can deliver even with a long-lived helper process; or the Python environment cannot be assumed where the app runs. Until then, Phase 0 golden fixtures built from real Kokoro word timings pin its behaviour, which also makes any later port verifiable.

## Alignment option evaluation

**Result (Phase 2):** the Qwen3-ForcedAligner candidate was downloaded after approval, measured and adopted as the default, with the envelope estimate kept as a labelled fallback. Numbers, method and limits are in [06](06-phase2-acceptance.md#alignment-evaluation). The table below is the pre-download assessment and is kept as written; where it says "not measured" the measurement now exists.

Findings from local inspection and the model's public listing before the download:

| Option | Runs on Apple Silicon | Download | Memory | Assessment |
|---|---|---|---|---|
| **Qwen3-ForcedAligner-0.6B** (MLX build `mlx-community/Qwen3-ForcedAligner-0.6B-bf16`) | Yes, through MLX. The installed `mlx-audio` 0.5.9 already contains the aligner module (`stt/models/qwen3_forced_aligner`), so **no new Python package is needed**. | About 1.84 GB (bf16 weights, 0.9 B parameters). Apache-2.0. | **Not measured.** Weights alone are 1.84 GB; peak will be higher. To be measured on this machine. | Recommended candidate. English is supported; up to 5 minutes of audio per call (blocks are about 20 s); non-autoregressive. Same ecosystem as the TTS. The model card publishes an alignment-error table; I did not retrieve it, so no accuracy figure is claimed here. |
| wav2vec2 CTC with a forced-alignment routine (for example through the torch environment already used for Kokoro) | Torch on CPU or MPS | Not verified | Not verified | Plausible fallback; English character-level; needs normalised text (numbers, symbols). Not evaluated further. |
| Montreal Forced Aligner | Needs a Kaldi-based conda setup, a pronunciation dictionary and an acoustic model | Several downloads | Not verified | Rejected: heavy environment for a single-user tool. |
| Whisper word timestamps | Yes | Model dependent | Model dependent | Rejected as primary: it transcribes rather than aligning known text, so it can disagree with the script. |
| Envelope-based estimate (current) | Yes | None | Negligible | Kept as the labelled `estimated` fallback. |

Gate for installing (Phase 2 spike), in order:

1. The author approves the roughly 1.84 GB download.
2. Download into the existing Hugging Face cache.
3. Run on a few existing takes (the prototype's takes) while recording peak memory with the existing monitor script.
4. Compare aligned boundaries with hand-marked boundaries on a small sample of words; report median and worst-case error.
5. Decide: adopt, adopt with a lower trust label, or stay on `estimated`.

The aligner and the TTS model never share memory: one model is loaded at a time, with the hand-over above between them.

## Mapping from existing code

| Existing | Becomes |
|---|---|
| `scripts/pip_scene_narration.py` | Audio worker (TTS) |
| `scripts/pip_scene_timing.py` | Audio analysis and the `estimated` fallback |
| `scripts/qwen_mem_monitor.sh` | Memory guard inside the job runner |
| `pipeline/timeline.py` | Unchanged; called through a wrapper |
| `src/schema.ts` | Legacy v1 schema, kept; v2 in `src/schema2.ts` |
| `src/Episode.tsx`, `src/scenes/*` | Generic Episode and scene registry (Tier 1) |
| `src/art/pip-scene/*` | First Tier 3 scene; parity target |
| `studio.py` | Stays; later a thin wrapper over the same core |
| `reference/pip-voice/approved-v1/` | Read-only voice profile reference |

## Risks

| Risk | Mitigation |
|---|---|
| 16 GB machine: TTS peaked at about 8.0 to 8.6 GB with 4 to 9 GB swap already in use *(measured)* | One heavy job, explicit unload and confirmation, pressure guard |
| TTS output can change across model or library versions | Takes are stored and selected, never silently regenerated; the cache key includes the model snapshot |
| Prosody drift between blocks | Block size cap, explicit pacing, listening check |
| Aligner accuracy and memory unknown | Spike with measurement before adoption; `estimated` fallback stays |
| System fonts: the theme's font stack starts with SF Pro, which comes from macOS, so renders can change with the OS | Phase 3 loads fonts from tracked files and hashes them; until then font checks flag fallback |
| Process trees: Chrome and encoder children may escape a process group | Cancel walks the process table and verifies; tested with a real render |
| Remotion licence | Free for individuals and companies of up to 3 people; a company licence is needed for 4 or more, and a separate arrangement applies to products offering video creation to others. Re-check before any distribution |
| Scope | Phases with acceptance criteria; each phase usable alone |
| Doc drift | README repaired in Phase 0; docs updated in each phase's acceptance |
