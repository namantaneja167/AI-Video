# Project instructions for GitHub Copilot

## Layout
* The Git root is the parent of the app. **The app is `explainer-studio/`**: its docs, `src/`, `core/`, `workers/`, `pipeline/`, `reference/` and `prototypes/` live there. Run every npm, node, python and `./studio` command from `explainer-studio/`, and use paths relative to it.
* Read `explainer-studio/docs/studio/05-implementation-plan.md` (the plan) and `06-phase2-acceptance.md` and `07-phase3-acceptance.md` (current status and limits) before changing anything. Project skills are in `.github/skills/`; these instructions and the project's documents win over them.

## Phase boundaries
* Work only on the phase the user names. Phases 0 to 3 are done (2 and 3 await the author's review). Do not start the next phase or UI work unless asked. No 3D work. The scene library is `src/library/`; bundled fonts are only a proposal until the author approves them.
* The creative baseline is `explainer-studio/prototypes/pip-scene-10x-v1/` (Pip's character, performance and warm-paper direction). The Phase 2 table-lab output is a technical pipeline test only: do not treat its style as a baseline, make more table-lab samples, or restart mascot or voice design.
* Real-project `init`/`adopt` is paused. Run integration and destructive tests only in temporary projects, and clean up only files and processes those tests created.

## Protected files
* Never edit `explainer-studio/reference/pip-voice/approved-v1/` (approved voice reference) or `explainer-studio/prototypes/pip-scene-10x-v1/` (frozen prototype). Copy from them; do not move or rewrite them. Do not modify `episodes/*` or `src/art` without being asked.

## Dependencies and services
* Keep dependencies pinned (`package.json`, `package-lock.json`, the Python requirements). Do not add packages, skills or services, and do not use paid services, without being asked. Model weights are never downloaded implicitly.

## Heavy work
* Narration, alignment, mastering and rendering run one at a time. Load one model at a time. Run long jobs in the background with a log, never wait on them in a blocking terminal, and stop on sustained critical memory pressure.
* Never kill processes by name or group. Only stop processes this work started and recorded.

## Verification and reporting
* Report what was measured separately from what was judged. Include exact test counts, skips and failures. Do not say a test or check passed unless it ran in this session.
* Do not claim the narration sounds natural, the words are right, the video looks good or anything is approved: listening, viewing and approval belong to the author. Approval of the voice reference is not approval of a generated take.
* State limitations precisely; do not claim isolation or reproducibility the code does not provide (render sources are read from the working checkout and verified, not copied).
