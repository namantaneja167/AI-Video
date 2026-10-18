# Skill sources

Project-local skills for this repository's GitHub Copilot agent. Third-party skills are copied unmodified; `SOURCES.sha256` lists every installed file (`cd .github/skills && shasum -a 256 -c SOURCES.sha256`). Installed 2026-10-18 by shallow `git clone` and copy, not `npx skills add`, so nothing was installed globally or written to any agent configuration.

| Skill | Source | Revision | Licence |
|---|---|---|---|
| `remotion-best-practices` | https://github.com/remotion-dev/skills, `skills/remotion-best-practices` (the router for all Remotion skills; version in its frontmatter: 4.0.536, the Remotion version this project uses) | `1441a11e95db35443bd76bb318386c0d3ca00053` (2026-10-16) | The upstream skills repository has no licence file. The skills ship with Remotion, so `LICENSE.remotion.md` is a copy of the Remotion License from this project's installed `remotion@4.0.536` (free for individuals and small for-profit teams; company licence otherwise). Recording the applicable licence is already a Phase 8 acceptance item. |
| `frontend-design` | https://github.com/anthropics/skills, `skills/frontend-design` | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` (2026-10-09; last commit touching this skill is the same) | Apache-2.0, `frontend-design/LICENSE.txt` kept as shipped |
| `pip-production` | This project. Draft in `.github/skills-proposed/pip-production/`; **not active** until moved into `.github/skills/` | n/a | Project |

## What was reviewed before installing

* `frontend-design`: one instruction file and the licence. No scripts.
* `remotion-best-practices`: 87 Markdown files, 13 SVG, 13 YAML (agent metadata), TypeScript/TSX examples and four `.mjs` helpers, all under the map references. The helpers only read and write local files; there are no network calls, shell execution or environment reads. Nothing is executable.
* Nothing was run.

## How these skills rank against this project

Where a skill disagrees with this repository, the repository wins. In particular:

* **Dependencies:** do not run the Remotion upgrade or create-project instructions; keep the pinned versions in `package.json`.
* **3D and maps:** the Remotion skill includes map and 3D-flyover references (CesiumJS, three.js). They are out of scope and must not be used.
* **Rendering:** the skill says not to render unless asked and to start Studio. Here renders go through the job runner (`docs/studio/06-phase2-acceptance.md`) or the legacy `./studio` commands.
* **Design:** `frontend-design` asks for a distinctive new direction. The approved Pip art direction and the Phase 3 scene and layout plan are the brief; its own rule is that the brief's words win. Use it for UI work in later phases (editor, mockups), not to restyle Pip or existing scenes.
* **Scope:** the current phase's scope is set by `docs/studio/05-implementation-plan.md`.

## Updating

Re-clone, diff against the installed copy, review the diff, copy, regenerate `SOURCES.sha256`, and update the revisions above.
