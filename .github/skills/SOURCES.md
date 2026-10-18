# Skill sources and provenance

Project-local skills for this repository's GitHub Copilot agent (the Git root is the parent of `explainer-studio/`). Third-party skills are copied unmodified, installed 2026-10-18 by shallow `git clone` and copy (not `npx skills add`), so nothing was installed globally and no agent configuration was changed.

## Upstream skills (unmodified)

| Skill | Source | Revision | Licence |
|---|---|---|---|
| `remotion-best-practices` | https://github.com/remotion-dev/skills, `skills/remotion-best-practices` (router for all Remotion skills; frontmatter version 4.0.536, the Remotion version this project pins) | `1441a11e95db35443bd76bb318386c0d3ca00053` (2026-10-16) | **Unconfirmed.** The upstream repository has no licence file, and neither its README nor its `package.json` states one. Its `package.json` points to `remotion-dev/remotion/tree/main/packages/skills`, inside the Remotion monorepo, but nothing says the Remotion License covers the skills. No upstream notice exists to preserve. Treat the terms as unknown until upstream states them. |
| `frontend-design` | https://github.com/anthropics/skills, `skills/frontend-design` | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` (2026-10-09, also the last commit touching this skill) | Apache-2.0: the skill's frontmatter says "Complete terms in LICENSE.txt", and `frontend-design/LICENSE.txt` is kept as shipped |

`UPSTREAM-UNMODIFIED.sha256` lists exactly the upstream files, 145 of them; verify with `cd .github/skills && shasum -a 256 -c UPSTREAM-UNMODIFIED.sha256`. Anything not in that list is not upstream.

## Other files here (not upstream)

* `SOURCES.md`, `UPSTREAM-UNMODIFIED.sha256`: this record.
* `provenance/remotion-package-LICENSE.md`: a byte-for-byte copy of `LICENSE.md` from this app's installed `remotion@4.0.536` package. It is the licence of the **Remotion software the app depends on**, kept as a reference for the Phase 8 licence check. It says nothing about the licence of the skills repository above.
* `pip-production/SKILL.md`: written for this project from its approved documents; the project owns it.

## What was reviewed before installing

* `frontend-design`: one instruction file and the licence. No scripts.
* `remotion-best-practices`: 87 Markdown files, 13 SVG, 13 YAML (agent metadata), TypeScript/TSX examples and four `.mjs` helpers, all under the map references. The helpers only read and write local files: no network calls, shell execution or environment reads. No file is executable. Nothing was run.

## Precedence

Repository instructions (`.github/copilot-instructions.md`) and the project's documents win over every skill. In particular: keep the pinned dependencies (no Remotion upgrade or create-project instructions); the map and 3D references (CesiumJS, three.js) are out of scope; renders go through the job runner or `./studio`, not ad-hoc Studio sessions; `frontend-design` is for later UI work and does not restyle the approved Pip art or existing scenes (its own rule: the brief wins).

## Updating

Re-clone, diff against the installed copy, review the diff, copy, regenerate `UPSTREAM-UNMODIFIED.sha256`, and update the revisions and licence status above.
