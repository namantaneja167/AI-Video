# Pip Explains — channel standards

Pip Explains is a continuing brand. New episodes change the topic and visual mechanism while keeping a recognisable channel identity. The author explicitly requested a consistent profile and a branded hook that also supplies each video's cover image.

## Opening and cover

- Brand name: **PIP EXPLAINS**, in the shared orange banner. Reuse `src/library/PipOpening.tsx`; keep its typography, placement and transition consistent across episodes.
- Hook: a short, specific curiosity or payoff headline backed by the explanation. Aim for 4–8 words, at most 48 characters. Set `openingHook` on the first Pip scene. Keep a descriptive topic in the project title. “Faster apps do less work” is the selected hook for the caching episode; it is not the headline for every episode.
- Opening: show the surprising event or problem immediately, with Pip, a readable hook and recognisable brand/series identity. Integrate the spoken introduction with the demonstration rather than delaying the mechanism behind a separate introduction. The shared full opening and matching clean cover remain part of the brand; its transition may overlap the causal animation. Follow the hook-first experiment rule below when testing narration order. Keep narration, captions and scene cues aligned.
- Sound signature: the existing synthesized chime at 0.12 seconds, gain −21 dB before the normal accent bus and final mastering. Never substitute a different voice or musical identity without a brand decision.
- Export one matching 1080 × 1920 PNG cover with each new video. Use a clean frame of the branded opening before captions appear, with the full hook and Pip visible. Give it the episode's name so it can be selected as its cover at upload. Check the uploader's actual profile/feed crop before publishing; if a crop removes the banner, title or Pip's face, make a cover variant using the same visual system and retain the original full portrait cover. Do not imply a separate PNG is automatically attached to an Instagram post.

## Hook selection — adopted 24 October 2026

For new episodes and hook revisions, lead the cover headline and first spoken sentence with a recognisable technology, product or company name when it is central to the story, followed immediately by a specific surprise or consequence. When the name is unfamiliar or adds little, lead with the strongest concrete curiosity or payoff. Choose attention-worthy wording the video can substantiate; audience familiarity and viral potential remain editorial hypotheses until measured.

Prefer a revealing fact over a vague judgement: “eMudhra’s secret key was just 4” rather than “eMudhra messed up”; “PHP: the attack starts before login” identifies the subject immediately. A famous name must have a direct, source-backed role in the story; preserve conditions and attribution so the hook does not imply a confirmed breach, universal exposure or endorsement. Speak eMudhra as **E Mudhra**, with the E separate; use speech overrides where needed while preserving normal written spelling.

Keep the cover headline, first spoken sentence, compact header and first visible animation aligned around the same promise. Show the event or mechanism immediately, then give the established spoken series introduction promptly while the demonstration continues. Retain the short-hook length guidance, series numbering, full-page takeaway, approved voice/art and preview-before-publishing requirements. Inspect the actual rendered opening, compact-header wrapping and matching cover at phone size; check the generated pronunciation by listening and record author listening approval separately.

This refines the discovery-first rule: a familiar name provides orientation, and the surprise still supplies the reason to watch. It does not require every hook to start with jargon or a brand name.

## Series identity and numbering — adopted 21 October 2026

For every series episode, show the series name and a two-digit episode number on the full opening and its matching cover, and retain that identity in the compact header throughout the video. Keep PIP EXPLAINS as the main brand and the topic hook as the headline. Apply this to AI MAXXING, SYSTEM DESIGN IRL, TECH UNDER THE HOOD and PIP’S TECH RADAR, including news episodes.

Retain a spoken series introduction: for this finite run, “AI Maxxing, part one of ten”; open-ended series speak the episode number without inventing a denominator. Confirm the rendered audio contains it; a visual badge alone does not fulfil the spoken identity. **22 October refinement:** the author approved testing a hook-first opening, followed promptly by the spoken series introduction while the demonstration continues. This supersedes the 21 October requirement that the introduction always precede the hook. Intro-first cuts may still be used with the causal demonstration already moving. Keep the visual series identity present from the opening, align transitions to the actual narration, and preserve earlier cuts for comparison.

Before export, verify the series and episode number against the publishing tracker and actual publication history. Number within the series, not across the account or the five teaching stages. Revisions, rerenders and reposts of the same episode retain their number. Prevent duplicate numbers when inserting an unscheduled news episode.

Show a denominator only for a defined finite run whose total is verified in the current plan. The current AI Maxxing run has ten planned episodes: the tokens opener is **AI MAXXING · 01/10**; this does not claim ten videos are completed. Open-ended news can use **PIP’S TECH RADAR · 01**. Never invent a total such as 20 from a formatting example. Label any chapter counter separately (for example STEP 5 / 5).

At adoption, the published caching episode is System Design IRL 01 and the published NCM episode is Pip’s Tech Radar 01. The tokens episode is AI Maxxing 01, awaiting review/publication at the time this rule was written. These are dated reference points: check live tracker history before assigning the next number. Do not modify previously published video files merely to add the new label.

Place the series line below the brand banner and above the hook on the opening cover; after the opening settles, put it between the compact header and chapter title. Inspect the actual rendered opening, compact header, ending and Instagram cover crop at phone size for collisions and readability. Keep the cover’s topic hook, Pip’s face and series label visible together.

## Preview before publishing — author review

Present the exact final video, matching cover and full caption to the author before publishing a new or revised episode. Wait for approval of that version unless the author explicitly waives the preview/review step. Earlier creative approval, approval of a different version, or a request to make and post an episode does not by itself waive this preview. After a material revision, show the changed cut before sharing it. Keep the author’s approval separate from measured checks and agent visual inspection; do not claim perceptual listening or Studio sign-offs that did not occur.

The rule is authoritative across production and publishing guidance. Documentation does not itself integrate a new renderer or metadata field into Studio: adopt source changes through the supported recording, render, cover and review workflow before claiming app-wide support.

## Approved episode structure — 20 October 2026

Default to the structure the author approved in caching **v5** (items 2 and 3 are the default; since 24 October 2026 they may appear where useful rather than on every body shot, see **Presentation flexibility** below):

1. **Branded hook opening.** Keep the shared opening and matching clean cover described above.
2. **Chapter header.** Below the compact brand/hook header, show a large, short chapter title and one supporting sentence. Use meaningful concept or action names: the caching example begins “SAME REQUEST.” / “A shorter route the second time.” and moves through Cache Miss, Store, Cache Hit, Stale Copy and Refresh.
3. **Visible stage strip.** Beneath the chapter title and supporting sentence, keep the episode's stage labels visible together in one row. Highlight the current stage with charcoal fill and cream text; use muted paper-grey fills and subdued text for inactive stages. The approved caching strip is **MISS · STORE · HIT · STALE · REFRESH**. Drive its state from the real narrative cues. This full labelled strip is the approved navigation; a small step counter or thin progress bar alone does not replace it.
4. **Continuous visual explanation.** Put the causal mechanism below the strip, with expressive Pip, purposeful motion and readable captions. The labels, diagrams, objects, components and animation can be made from scratch for each topic. Choose a short stage sequence that fits that episode; caching's five labels are an example, not a template to force onto every subject.
5. **Dedicated full-page takeaway.** During the final spoken summary, transition away from the working diagram to one large takeaway and at most two short supporting points. Keep the brand header, Pip and captions, with clear space around them. Caching's approved example is **“Reuse the work. Keep it fresh.”**, supported by returning the saved result and invalidating/fetching a fresh copy. Give viewers time to read it within the narration; plan that time in the storyboard rather than adding a silent end card or compressing the voice.

For 1080 × 1920, the reference places the chapter title around y=255, supporting sentence around y=365 and stage strip around y=435, above the mechanism at y=540. These are reference positions, not mandatory coordinates: fit longer titles and topic-specific scenes without clipping, crowding or obscuring captions. Keep all stage labels legible at phone size.

### Approved visual reference and adoption status

The author said “perfect, i love this” after reviewing **faster-apps-do-less-work-v5.mp4** on 20 October 2026. This approved the visual format and review cut, not audience performance. The author subsequently reported deleting v2 and manually publishing v5; the new post URL and timestamp were verified live on 20 October 2026. See the media-library publication record and Notion for the current post.

- Review video: `/Users/namantaneja/codex/2026-10-17/https-www-instagram-com-rick-theengineer/outputs/caching-v5/faster-apps-do-less-work-v5.mp4`
- SHA-256: `6a78d349c0524d4a086e4aded2c1f2a139126f168bcab2c629b5deaaa0171e7f`
- Matching cover, contact sheet, source copy (`CacheJourney.v5.tsx`), patch (`scene-revision.patch`) and build manifest are beside that video. These are external local reference files; retain them if moving the workspace.
- v5 was rendered in an isolated source copy. Updating these standards does **not** install a scene into Studio, update recorded render sources, approve an app artifact, or publish a post. When adopting an isolated scene in Studio, use the normal source-recording, render, cover, review and export workflow. Preserve existing approved voice/art and frozen benchmarks; retain earlier builds and feedback.
- **Second topic (AI Maxxing 01, tokens).** Adapts the stages to **TEXT · SPLIT · NUMBERS · COUNT · CHECK** with the same `ChapterHeader`, `StageStrip` and `FullPageTakeaway`, and its own scene `token-journey`. The 20 October rough preview in the caching project is superseded; the production record is published v3 (`PIP-R002`, AI MAXXING 01/10, author-reported in that project's `publication.json`). The scene, its schema and tests are now in Studio (22 October 2026 reconciliation, see `16-pip-opening-workflow.md` §2d) and a fresh Studio build of that episode is byte-identical to the published v3 file. Publication facts are the author's records, not re-verified by Studio.
- **Studio adoption (20 October 2026).** The v5 layout is now in `src/library/scenes/CacheJourney.tsx`, using the reusable `src/library/chapters.tsx` (`ChapterHeader`, `StageStrip`, `FullPageTakeaway`; topic wording and stage logic stay in the scene). The caching project's render sources were re-recorded by a normal rebuild, which re-ran only the final video: Studio render artifact 14 (SHA-256 `6a78d349…`) and its cover artifact 15, with the narration takes, timing and mix reused. That render is byte-identical to the published v5 file. It is a Studio build awaiting the author's viewing review: no review round, sign-off, approval or export exists for it, and the published v5 package and Notion record are untouched.

## Presentation flexibility — approved 24 October 2026

The author approved this refinement of the rules above. The aim is more visual range: the repeated sequence of header, stage strip, central diagram and a corner Pip should not be the default look of every body shot.

**Kept, without change:** Pip and the approved layered artwork; the approved voice; typography (bundled Inter, JetBrains Mono); the orange identity and the PIP EXPLAINS banner; series naming, numbering and the spoken series introduction; the branded opening, the compact header (y=96–180) and the matching clean cover; readable captions in their band; a clear final takeaway; the preview-before-publishing rule; fictional-example and source labelling.

**Now flexible, where it serves the explanation:**
- **Chapter header and full stage strip.** They are the default navigation and the tool for an overview or a meaningful stage change, but need not occupy every body shot. A close-up or demonstration may use a compact current-chapter label (`ChapterTag` in `src/library/chapters.tsx`) or clear the explanatory chrome for a moment; restore the full map at meaningful transitions. Whenever the full strip is shown, the existing rules hold: every label visible, the active one charcoal on cream, legible at phone size.
- **Use of the frame.** Close-ups and demonstrations may use more of the frame: the whole area between the compact header and the caption band, inside the safe area. A scene may use a camera (move, zoom, reframe), masks and transitions. Captions and the brand header stay in screen coordinates: a scene camera moves the scene, never them.
- **Pip.** Pip may move, take part in the action, step aside or leave a shot, and come back for the payoff or takeaway. His artwork, voice, expressions and identity stay as approved; only where he is and what he does vary.
- **Shot variety.** Wide, medium and close shots of the same objects, and different representations of the same object, are encouraged: the object keeps its identity across shots. Choose them for the explanation, not as decoration.

**Preserved defaults.** Existing episode documents, scenes and published or review cuts are not changed: a scene renders as it did unless its document opts in to a new presentation control, and nothing is retrofitted. Cover identity and series numbering stay consistent across the profile even when the film's body varies.

This records approved direction. The engine controls added for it (24 October 2026) and the three comparison proofs are described in `16-pip-opening-workflow.md` §2e; the proofs are draft creative comparisons awaiting editorial review, not an adopted default and not approved cuts.

## Media library and publishing handoff

Deliver approved media to `/Users/namantaneja/Movies/Pip Explains`. Use `Episodes/YYYY-MM-DD_CONTENT-ID_Topic/Approved-vN/` for the exact video, matching clean cover, `caption.txt`, publication/provenance record and SHA-256 checksums. Keep the content ID, topic and version in video/cover filenames. Update the root `library.csv` to identify the current approved pair and its actual publishing state. This library is the file-selection source for publishing; drafts and rejected renders stay in working output directories. If a version is superseded, retain it in that episode's `Archive/` and identify its replacement explicitly rather than overwriting its bytes.

Store shared profile art, font files with licences and a dated standards copy in `Brand/`. The Studio document remains authoritative; refresh the library copy when changing it. Store future Story exports in the episode's separate `Stories/` folder and record their own publication times. The library is local storage, not an automatic backup or cloud upload.

After publishing, update Notion with the actual post URL and timestamp. A replacement post gets a fresh 24-hour/7-day measurement clock; retain the deleted post's history separately. Author-reported publication can be recorded as such, and live verification should be distinguished from byte-for-byte proof of the manually uploaded file.

## In the app

The Studio app carries this standard (`docs/studio/16-pip-opening-workflow.md`): *New episode* starts a Pip Explains episode; the **Opening hook** card on the Script and Scenes steps edits the first scene's `openingHook` (validated by the episode schema, title kept separate); a new episode records the quiet chime once; a hook is required before such an episode is built; the **Cover image** card on Review draws the cover from the rendered video's own opening (frame 20, 0.667 s, no captions), says whether it still matches the video, offers the download, and the approved export package includes it. The cover is made from the recorded sources of its video: do not edit anything under `src/` without expecting every existing project to need its render sources recorded again.

## Identity that stays consistent

- Original ivory-and-orange capsule Pip, charcoal face and floating gloves; use the approved layered artwork and expressive performance tools.
- Approved Pip reference voice. The generated take remains subject to listening review.
- Warm paper/cream ground, orange branding, ink text, bundled Inter for hook/body text and JetBrains Mono for the banner/technical labels. Preserve the existing Pip art; use colours semantically in the explanation.
- A stable hierarchy: brand, short hook, visual mechanism, captions. Reserve y=96–180 for the compact header. Avoid overlapping the caption band.
- Consistent cover hierarchy and opening motion across the profile. Topic-specific animation, objects and diagrams can be built from scratch as needed; visual variety belongs inside this common identity.

## Checks before handoff

View the opening, transition, cover and key mechanism frames at phone size. Make sure the hook is true for the specific example. Confirm the cover matches the delivered build, has no caption overlay, and preserves the hook's full wording. Keep earlier builds and their feedback distinct. Export approval and publishing still belong to the author.

Anything shown as data (token splits, ids, counts, measurements, benchmark figures) must come from a real run recorded with the episode (for example `samples/ai-maxxing-01/tokenizer-evidence.json`), name the tool or model that produced it, and say where other tools would differ; never draw a plausible-looking split or number by hand.

Also inspect a frame from each stage and the full-page ending: where the full strip is shown, all stage labels stay visible, the active highlight matches the mechanism and narration, chapter titles and their supporting lines remain readable, and the final takeaway replaces the busy diagram without obscuring Pip or captions. The takeaway must reflect the actual explanation and its limits.

## Editorial direction and motion — adopted 22 October 2026

Prioritise AI developments and surprising tech mechanisms, in accessible English with India-first examples and global appeal. Select a specific discovery, consequence and source-backed mechanism before writing the script. Explain foundations inside that story. Development slots require a meaningful verified change, availability and limitations; use a researched fallback if none qualifies. The Notion Publishing Calendar owns the active topic plan. Preserve published history and the current finite AI Maxxing ten-part promise.

Make episodes more fluid and visually inventive through purposeful motion. Each storyboard must name its main visual demonstration and how the same objects carry the cause and consequence across stages. Create custom animations, components, layouts and assets freely when the topic needs them. The existing scene library is a starting point, not a limit.

- Preserve object identity and spatial relationships across transitions; transform, move or match-cut the working objects instead of repeatedly resetting to disconnected cards.
- Use smooth easing, anticipation, follow-through, overlapping action and restrained depth where they clarify the event. Time movement and Pip reactions to narration and causal changes. Let viewers read and understand the outcome before the next event.
- Choose motion by topic: token drafting and verification, animated trust boundaries, evolving barcodes, relay paths or a replayed request. Explain one mechanism clearly; avoid decorative motion competing for attention.
- Keep the branded opening and cover, series identity and spoken introduction, readable chapter headers and full labelled stage navigation where they help (see Presentation flexibility), and the full-page takeaway. New motion must fit the approved Pip artwork, voice, palette, typography and caption safe areas. The deferred 3D-world expansion remains separate.
- Build the takeaway around the actual demonstration and a meaningful boundary. Review transitions and pacing through full-speed playback at phone size, alongside opening, stage and ending checks. Record any unavailable listening or playback review honestly.

This records production direction; it does not itself implement a renderer, adopt a scene, approve a finished cut or publish a post. Follow the supported Studio source-recording, render and review workflow for each new scene.


## Discovery workflow and richer motion — approved 22 October 2026

The author approved the strategy review and additionally requested more moving parts, more visual elements and fluid animation. Apply this to new production and revisions. Existing published and review cuts are not automatically replaced by this decision.

### Selection and creative checkpoint
Choose the viewer-facing surprise or consequence before the technical label. Each brief records the intended viewer, reason to care now, primary evidence, one visible demonstration, exact payoff and limitation. Record dated audience-interest evidence when available; otherwise mark demand unverified. “Viral potential” is an editorial hypothesis, never a verified metric or guaranteed outcome. Develop three hook options, a five-second animated opening and the exact takeaway before full narration. Resolve them internally against the brief; the author reviews the exact finished video, cover and caption before publishing.

For the next ten Reels, target four verified AI developments, four surprising everyday mechanisms and two original reproducible experiments. This is a test allocation, not a quota that permits filler news; use a researched mechanism when a development lacks a meaningful verified change. Keep daily Reels and light Stories. Script the next two days in detail and leave later news slots flexible. Improve existing planned angles rather than duplicate episodes or repeatedly reset the calendar. For news, record event date, source date, availability, region and benchmark conditions. For experiments, record the actual setup and results before writing numerical claims.

### Motion brief
- Compose a visual demonstration with multiple meaningful elements: devices, real or illustrative interfaces, signals, packets, timelines, clocks, objects, connections, comparisons or magnified details as the subject requires. Create custom components, assets and animations freely. Explain how each added element helps the viewer understand the event.
- Keep the main objects alive across stages: assemble, move, split, transform, zoom into or match-cut them. Plan overlapping actions such as a moving signal, a responding device and Pip noticing the consequence, with one clear focal point. Preserve object identity and spatial orientation.
- Apply anticipation, smooth easing, stagger, follow-through, restrained depth, path motion and camera reframing where useful. Let labels and diagrams build with the event rather than repeatedly arriving as whole static cards. Match movement and sparse sound cues to causes and consequences, allowing the result time to read.
- Give Pip a narrative role through notice, doubt, inspection, explanation and confirmation. Use the approved artwork and voice. Mark vocal intent in the script and review the actual generated delivery; keep the reference voice stable.
- Reserve a hard caption-safe area throughout motion. Text, moving objects and callouts must remain clear of captions and the branded header. Wherever they appear, keep chapter titles, the complete labelled stage strip and the dedicated full-page takeaway legible. Stage count and body layout should fit the topic.

### Review and learning
Inspect a contact sheet of the opening, each stage change and takeaway, plus the cover; review transitions at full speed and phone size. Check overlapping paths, clipping, caption collisions, causal timing and readable pauses. Record unavailable listening or playback review honestly. Measured decoding/loudness checks supplement perceptual review. Test one main creative variable at a time and compare actual snapshot ages and available denominators. Different posts provide observational evidence, not a randomised A/B test. Preserve unavailable metrics as blank and distinguish watch-time ratio from completion.

### Production-system adoption
Reuse the current local pipeline, brand assets and voice; build explanation-specific scenes freely. Shared motion and expression helpers may grow as repeated needs emerge. This guidance does not itself implement new renderer behaviour, automated layout checks or an app-wide workflow gate. Changes to production code still use source recording, rebuild and review. The deferred 3D-world expansion remains separate.
