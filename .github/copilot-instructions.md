# Project instructions for GitHub Copilot

## Layout
* The Git root is the parent of the app. **The app is `explainer-studio/`**: its docs, `src/`, `core/`, `workers/`, `pipeline/`, `reference/` and `prototypes/` live there. Run every npm, node, python and `./studio` command from `explainer-studio/`, and use paths relative to it.
* Read `explainer-studio/docs/studio/05-implementation-plan.md` (the plan) and `06-phase2-acceptance.md` and `07-phase3-acceptance.md` (current status and limits) before changing anything. Project skills are in `.github/skills/`; these instructions and the project's documents win over them.

## Phase boundaries
* Work only on the phase the user names. Phases 0 to 3 are done (2 and 3 await the author's review). Do not start the next phase or UI work unless asked. No 3D work. The scene library is `src/library/`; bundled fonts are only a proposal until the author approves them.
* Creative references: `explainer-studio/prototypes/pip-scene-10x-v1/` is the reference for Pip's character, expressive performance and warm-paper direction. `explainer-studio/out/phase4/slice2/context-window_slice2_rebuilt.mp4` (SHA-256 `cd6fa2aaf645b7df120c40edc9c5feebdb1c9c4e107acff53038202dd2d7fd08`, never overwrite it) is the author's primary visual benchmark for explanatory storytelling: show concepts through changing objects, states and relationships, keep continuity when it helps, use cards selectively; it is a quality reference, not a template. The Phase 8 final output demonstrates the production workflow and is not a creative benchmark. See `explainer-studio/docs/studio/15-creative-benchmark-and-review-records.md`. The Phase 2 table-lab output is a technical pipeline test only: do not treat its style as a baseline, make more table-lab samples, or restart mascot or voice design.
* Real-project `init`/`adopt` is paused. Run integration and destructive tests only in temporary projects, and clean up only files and processes those tests created.

## Creative freedom for video production
* Build the visual explanation the topic needs. Existing scenes and components are reusable starting points, not the limit of what an episode may show. Within a user-authorized video brief, create new topic-specific animations, components, diagrams, transitions and scene types from scratch when they explain the idea better; routine creative implementation does not need another permission question.
* Follow `.github/skills/pip-production/SKILL.md`, especially **Creating new scenes and components**, when the current library cannot express the explanation. Prefer visible cause and effect, object continuity and meaningful state changes over forcing a topic into text cards.
* This standing authorization covers new episode content and supporting scene code using the existing stack. Preserve the approved Pip identity, voice, frozen references and benchmarks; keep new work separate from protected assets. Existing dependency, service, heavy-job and review rules still apply. 3D remains deferred until the user asks for it.

* New Pip episodes use the shared branded opening: set `openingHook` on the first scene to a concise, truthful curiosity hook (48 characters maximum), and follow **Standard branded opening** in `.github/skills/pip-production/SKILL.md`. The banner and hook animate over the opening narration; keep the header strip clear. The app's *Opening hook* and *Cover image* cards and the chime default are described in `explainer-studio/docs/studio/16-pip-opening-workflow.md`; do not edit `src/**` for episode work, because recorded render sources make existing projects refuse to render or draw covers.

* Treat Pip Explains as a brand: follow `explainer-studio/docs/studio/pip-brand-standards.md` for every new episode, including a matching clean PNG cover and consistent profile identity.

## Protected files
* Never edit `explainer-studio/reference/pip-voice/approved-v1/` (approved voice reference) or `explainer-studio/prototypes/pip-scene-10x-v1/` (frozen prototype). Copy from them; do not move or rewrite them. Do not modify `episodes/*` or `src/art` without being asked.

## Dependencies and services
* Keep dependencies pinned (`package.json`, `package-lock.json`, the Python requirements). Do not add packages, skills or services, and do not use paid services, without being asked. Model weights are never downloaded implicitly.

## Heavy work
* Narration, alignment, mastering and rendering run one at a time, across every open project on the computer (the production slot, `explainer-studio/core/slot.ts`). Load one model at a time. Run long jobs in the background with a log, never wait on them in a blocking terminal, and stop on sustained critical memory pressure.
* Never kill processes by name or group. Only stop processes this work started and recorded.

## Verification and reporting
* Report what was measured separately from what was judged. Include exact test counts, skips and failures. Do not say a test or check passed unless it ran in this session.
* Review feedback is per build (file and hash). The author's positive feedback on a build is not export approval, not word-by-word verification and not approval of other builds; do not write "nobody has viewed any video" or "approved" for either.
* Do not claim the narration sounds natural, the words are right, the video looks good or anything is approved: listening, viewing and approval belong to the author. Approval of the voice reference is not approval of a generated take.
* State limitations precisely; do not claim isolation or reproducibility the code does not provide (render sources are read from the working checkout and verified, not copied).
