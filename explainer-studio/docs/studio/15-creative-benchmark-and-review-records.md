# Creative benchmark and build-specific review records

Status: written after the Phase 8 closeout request. It records the author's visual preference and what was and was not
reviewed. **It is not an approval of anything.** Nothing here changes Pip's design, the renderer or the approved voice, and
no video was regenerated or overwritten.

## 1. The preferred visual benchmark

| | |
|---|---|
| File | `out/phase4/slice2/context-window_slice2_rebuilt.mp4` (git-ignored output) |
| SHA-256 | `cd6fa2aaf645b7df120c40edc9c5feebdb1c9c4e107acff53038202dd2d7fd08` |
| Size and format | 3,545,672 bytes; h264 1080 x 1920, 30 fps, 721 frames; aac 48 kHz stereo; 24.043 s |
| Made by | The Phase 4 slice 2 rebuild in the demo workspace (revision 4 of the context-window episode, approved voice, saved takes where valid): `09-phase4-slice2.md`, section 7. Beside it: `mastered-mix.wav`, `timeline.json`, `measurements.json`, `voice-only-placement.wav` |
| Scene | The custom (Tier 3) `context-window` scene: `src/library/scenes/ContextWindow.tsx`, score `src/library/pip/scores/contextWindow.ts`; style `pip-paper-bundled` |
| Preserved | The file is read-only (`r--r--r--`) and was never rewritten. It is also inside the recovery backups (see section 6). Its hash and the two videos it is compared with are recorded in `docs/studio/benchmark/benchmark.json`; `tests/benchmark-record.test.ts` re-checks them whenever the files are present (4 tests, none skipped on this machine, where the files exist) |

The author's words: the video is "much clearer and more visual than the Phase 8 final output". That is the only reason the
author gave, and it is the only reason this record claims.

### Three references, three jobs

| Reference | What it is the reference for |
|---|---|
| `prototypes/pip-scene-10x-v1/` (frozen) | **Pip's character and expressive performance** (identity, expressions, hands, warm-paper look). Unchanged. |
| `out/phase4/slice2/context-window_slice2_rebuilt.mp4` | **The primary reference for explanatory visual storytelling in future Pip videos.** A quality reference, not a template every topic must copy. |
| `out/phase8/journey/why-a-model-forgets-the-start-of-a-long-chat-final.mp4` | **Demonstrates the complete production workflow** (research, outline, storyboard, narration, review, export path). It does not supersede the creative benchmark and is not one. |

## 2. Comparison with the Phase 8 final output

Method: twelve frames at even spacing from each video (`docs/studio/benchmark/contact-preferred-slice2.png`,
`docs/studio/benchmark/contact-phase8-final.png`), the benchmark's `timeline.json`, and the scene sources. Frames were looked at
by the agent; the author's own viewing is what the preference rests on.

The two videos differ in more than the visual treatment (see 2.3), so this is a description of differences, not a controlled test.

### 2.1 Observations (what is on screen; counts are from the files)

| | Preferred (slice 2 rebuild) | Phase 8 final |
|---|---|---|
| Length, script | 24.04 s, 60 narrated words, 8 segments, **one** scene | 15.8 s, 5 segments, **three** `pip-cards` scenes |
| Visual mechanism | One persistent object, a window of 60 slots, whose **state changes**: slots fill (question, earlier chat, reply, free), the counter runs 0 / 60 to 8 to 24 to 38 to 59 to 60 / 60, a stacked bar and a legend with live numbers follow it, `8 + 16 = 24` is shown as arithmetic | Text cards that **appear and stay**: six cards, each a bold title and a one-sentence line, in a stack at the top of the frame |
| What carries the meaning | Quantities, colours (one colour per kind of content) and what happens to the slots | The words on the card, which restate the narration |
| Continuity | A panel of slots is on screen in 11 of 12 sampled frames; the same slot rows are reused when the overflow case is shown and when the full window returns | Cards are added within a scene and are gone at the scene change; the upper part of the frame holds nothing in 3 of 12 sampled frames |
| Overflow / consequence | Shown: the full state ("full: no slots left"), then two outcomes ("It stops" / "It drops the oldest") drawn with the slots, then back to the window | Said and written ("Old words drop out"); nothing visibly drops |
| Hierarchy | A visible order: the counter and the panel first, the bar and legend second, the label and disclaimer smallest | Cards share one weight and size; the newest one is outlined |
| Pip | Docked lower left in both; in the benchmark he points (dotted line) at the panel at the moments it changes (2 of 12 sampled frames) | The same placement and pose family; he points (dotted line) at a card when it appears (3 of 12 sampled frames), so the gesture accompanies a card appearing rather than a quantity changing |
| Framing | The panel fills the upper half of the frame, Pip and the caption the lower | The cards occupy roughly the upper third; the rest of the upper half is background |
| Reading burden | Short labels and numbers; the sentences are only in the narration and the caption | Each card is a heading plus a sentence the narrator also says, with the caption on top: the same words in two or three places |
| Honesty label | A visible note: "Illustrative · 1 piece = 1 slot" and "Simplified. Token pieces are illustrative, not from a real tokenizer." | None |
| Cues | 21 timed visual cues in `timeline.json` (window in, label, split, fill, history, reply, share, full, stop, drop, back) | Card reveals and Pip gestures |

### 2.2 Hypotheses (not measured, not claimed as the author's reasons)

* H1. A single object whose state changes is easier to follow than cards because the viewer sees the relationship (8 + 16 = 24, then full) instead of reading a description of it.
* H2. Keeping one object on screen avoids re-orienting at each scene change.
* H3. Less on-screen prose leaves attention for the picture; the card scenes repeat the narration in text.
* H4. Pip pointing at something that changes reads as showing; pointing at a card that is about to be read reads as announcing.
* H5. A quantitative topic (slots filling up) lends itself to this treatment more than a conceptual one; the benchmark may be clearer partly because of its topic.

### 2.3 What the comparison cannot separate

The scripts differ (the Phase 8 script is shorter and less numeric); the benchmark is a hand-built scene for one topic and the Phase 8 output uses the generic `pip-cards` scene; the lengths differ. The author may have preferred it for reasons beyond "clearer and more visual", and none are assumed. Whether a *generic* scene could reach the benchmark's clarity was **not tested** and no such scene was built.

## 3. Production guidance adopted

Recorded in `.github/skills/pip-production/SKILL.md` (section "Visual storytelling"), the plan and the project instructions:

1. Show a concept through **changing objects, states and relationships**, not through a card that restates the narration.
2. **Keep an object on screen** across beats when the idea continues, and let it change; do not rebuild the screen at every segment.
3. Use **cards selectively**: for a name, a definition worth reading or a comparison that needs exact words. Narrated text cards with mascot gestures are not the default.
4. Put **quantities, colour meaning and consequences** where the viewer can see them; label simplifications visibly.
5. Keep **Pip's approved identity, voice and visual direction**: Pip points at or reacts to what changes, as in the benchmark.
6. The benchmark is a **quality reference, not a template**: a topic without a countable or spatial idea does not have to look like it.

Not changed: Pip's design, the renderer, narration, the approved voice, the scene library's code, either video.

## 4. Build-specific review records

These are the author's statements, told to the agent in conversation; the app's own review records are separate (below).

| Build | File and SHA-256 | What the author said | What it is not |
|---|---|---|---|
| Context-window revision 2 (the Phase 3 sample) | `out/phase3/context-window-rev2/context-window_final.mp4`, `fa8d8a6b...a106a769` | Watched; "clear and fun" | Not an export approval, not a check that every spoken word is right, not a factual approval |
| Slice 2 rebuild (the benchmark) | `out/phase4/slice2/context-window_slice2_rebuilt.mp4`, `cd6fa2aa...7d08` | Watched; **preferred** over the Phase 8 final; "much clearer and more visual" | Same: positive visual feedback on this build only |
| Phase 8 final (journey project) | `out/phase8/journey/why-a-model-forgets-the-start-of-a-long-chat-final.mp4`, `eac37082...c713e` | Watched; judged less clear and less visual than the slice 2 rebuild | Not a rejection of the production workflow it demonstrates, and not recorded as approved |
| Branded caching video and its cover | `out/caching-v2/why-caching-is-faster.mp4`, `61d64489...af84d3`; `out/caching-v2/faster-apps-do-less-work-cover.png`, `bbf4d3b4...922d49` | Watched; loved it (the author's word). Kept as creative references for the branded opening, hook and cover (both files read-only, hashes in `benchmark.json`) | Positive visual feedback on these two files only: not export approval, not a check of the words, not approval of any other build. The app's own cover for the same video is compared with it in `16-pip-opening-workflow.md`, never substituted for it |
| Every other build (Phase 7 demo drafts and finals, Phase 2 validation sample, the Phase 8 draft and any other render) | listed in the Phase 7 and 8 documents | No author feedback recorded | Unreviewed |

Positive visual feedback on a build is **not** formal approval for export, **not** verification of every spoken word, **not** a
factual review of the content, and **not** approval of any newer or different build, whatever the title or text.

The app's own records, read from the two project databases in this session: **0** approvals, **0** sign-offs (listened, watched at phone size, custom scenes reviewed), **0** exports and **0** playback records in the demo project; **0** approvals, sign-offs, exports and playback records in the journey project (it has one review round, made by the agent's UI test during Phase 8). The author's conversation feedback above was not entered as sign-offs and the agent cannot enter them.

## 5. Machine-wide heavy work

Specified and tested with the rest of this closeout in `14-phase8-hardening.md`, section "Closeout: one heavy job on the whole computer". It does not change any output.

## 6. Recovery

The recovery backup `../backups/explainer-studio-phase8-closeout/` (outside the repository) holds a byte copy of the benchmark file and its sibling files, the whole `out/` tree, the source, and both projects; its record lists the benchmark hash. Details and the verification are in `14-phase8-hardening.md`.
