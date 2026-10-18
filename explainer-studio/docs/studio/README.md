# Explainer Studio: product planning

Planning documents for the local browser app, plus the status of implementation. Phases 0, 1 and 2 are done (Phase 2 awaiting your review); Phase 3 has not started.

| Doc | Contents |
|---|---|
| [01 Current-state audit](01-current-state-audit.md) | Working, experimental, missing; measured findings |
| [02 Product specification](02-product-spec.md) | Journey, review loop and approval, state and recovery, snapshots and invalidation, timing and alignment, quality checks, jobs, import, layouts, 1280 × 800 editor |
| [03 Navigation and editor mockup](03-navigation-and-editor-mockup.md) | Screens; interactive HTML in `mockups/` |
| [04 Architecture](04-architecture.md) | Single project store and recovery, voice-to-render hand-over, timeline decision, alignment evaluation; diagram in `diagrams/` |
| [05 Implementation plan](05-implementation-plan.md) | Phases 0 to 8 with acceptance criteria; Phase 0 and 1 results |
| [06 Phase 2 acceptance](06-phase2-acceptance.md) | Job runner, audio and render workers, timeline wrapper, alignment evaluation: results, measured resource use, limits |

## Changes in this revision

1. **Review loop.** Edit, draft render, review, revise, final mastered render, final approval, export. Export copies the approved file and never renders or masters. Any change to a hashed input voids approval. ([02 §2](02-product-spec.md#2-the-review-loop))
2. **Immutable snapshots.** Every job runs on a frozen snapshot; a job that finishes after inputs changed is kept as outdated and cannot replace the current or approved output. Dependency hashes now include assets, fonts, scene code, theme, narration, timing, sound mix and render settings. ([02 §4](02-product-spec.md#4-dependencies-invalidation-and-immutable-snapshots))
3. **Model hand-over and cancellation.** Qwen is unloaded and confirmed released (or its process is killed and confirmed gone) before a render starts; cancel stops the whole process tree and frees the heavy slot. The acceptance tests exercise the transition rather than comparing timestamps. ([02 §8](02-product-spec.md#8-jobs), [04](04-architecture.md#voice-to-render-transition), [05 Phase 2](05-implementation-plan.md))
4. **Alignment.** Local forced alignment is in the quality plan with three labelled timing sources (`aligned`, `estimated`, `manual`); no claim of perfect timing. Candidate evaluated, nothing installed. ([02 §6](02-product-spec.md#6-timing-and-alignment), [04](04-architecture.md#alignment-option-evaluation))
5. **One authority for project state.** The project database is the only authoritative store; `episode.json` is a projection; the separate journal is gone. Recovery protocol, backup and restore contents, and reference-safe cache cleanup are specified. ([04](04-architecture.md#project-state-store-and-recovery))
6. **Timeline.** The Python logic stays; a Node wrapper will call it. A port needs a concrete requirement. ([04](04-architecture.md#timeline-decision))
7. **Mockups.** The voice screen's engine state now matches its running job; preview guides no longer overlap content; new 1280 × 800 editor screens with collapsible panels and a resizable timeline; the review screen shows the draft, mastering, manual and approval states. The architecture diagram was updated and re-validated.
8. **Quality checks.** Acceptance checks for missing narration, caption and spoken-text mismatch, fonts, overflow and obscured content, mastering in the reviewed file, and manual listening and playback, each labelled measured, manual or limited. The spec does not claim custom scenes can be verified automatically. ([02 §7](02-product-spec.md#7-quality-checks))

## Implementation status

* **Phase 0** (done): regression fixtures from real data, template and README repair, declared dependencies, tested v1 to v2 migration. [Result](05-implementation-plan.md#phase-0-result).
* **Phase 1** (done): project store and recovery (SQLite, transactional saves, immutable revisions, content-addressed media, input snapshots, dependency hashes, stale and approval invalidation, external `episode.json` detection, backup and restore, reference-safe cleanup) and the rule that legacy commands never substitute a Kokoro voice for a Qwen episode. [Result, limits and plan changes](05-implementation-plan.md#phase-1-result). An independent review found four issues (restore path validation, cleanup preview with thinning, recovery from corrupt backups, lock behaviour when process inspection is unavailable); all are fixed with regression tests ([details](05-implementation-plan.md#review-fixes-independent-review-of-phase-1)).
* **Phase 2** (done, awaiting review): persistent job runner with attempts, immutable snapshots and truthful progress; one heavy job at a time; Qwen narration with the approved Pip reference; block-level caching; thin wrapper around the Python timeline logic; forced alignment (aligner adopted, estimate kept as labelled fallback); Remotion render worker with progress, cancellation and isolated output; confirmed model unload before renders; restart recovery without orphans. One real narration, alignment and render run produced a playable draft. [Results, resource use and limits](06-phase2-acceptance.md).

From the project root: `npm test`.

## Decisions

Resolved (by you):

1. Existing tracked media and `episodes/my-topic` stay as they are.
2. The 0.3 s caption threshold stays. The historical regression fixtures are preserved; the 0.275 s caption in s17 is fixed when that episode is next edited.
3. Mastering targets are configurable, with −16 LUFS and −1.5 dBTP as initial defaults.
4. Alignment evaluation is left for Phase 2; no model download now.
5. Appropriately licensed fonts are bundled in Phase 3.
6. The applicable Remotion licence is recorded before any distribution (Phase 8 acceptance).

Resolved for Phase 2:

* The roughly 1.84 GB aligner download was authorised and used; the aligner is the default and the estimate is the labelled fallback.

Open:

* Which fonts to bundle (Phase 3 input; no action yet).
* **Paused by you:** `init`/`adopt` on the real studio. The store and the runner have only been exercised on temporary projects.
