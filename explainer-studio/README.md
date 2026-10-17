# Explainer Studio

Local pipeline for faceless technical explainer videos: an episode JSON (script + storyboard you approved elsewhere) goes in, a 1080×1920, 30 fps narrated MP4 comes out. No LLM, paid API or browser automation is involved.

```
episodes/<id>/episode.json ──► ./studio narrate ──► public/generated/<id>/<variant>/{audio.wav,timeline.json,episode.json}
                                                      │
                                       Remotion Studio (preview)  /  ./studio render ──► out/<id>-<variant>.mp4
```

## Install (once)

Requires macOS/Linux, Node 20+, and Homebrew packages `ffmpeg`, `python@3.12`, `espeak-ng`.

```sh
brew install ffmpeg python@3.12 espeak-ng
./setup.sh          # creates .venv (Kokoro) and runs npm install
```

The first narration downloads the Kokoro model (~330 MB) from Hugging Face; after that it works offline. The first render downloads Remotion's headless browser.

## Preview

```sh
./studio narrate episodes/join-fanout                                  # full episode audio + timing
./studio narrate episodes/join-fanout --preview join-multiplication    # 15–20 s preview only
npm run studio                                                         # Remotion Studio
```

In Remotion Studio pick `join-fanout--full` or `join-fanout--preview-join-multiplication` in the sidebar. Re-run `./studio narrate` after editing the script; unchanged segments are cached, so only edited lines are re-synthesized.

## Render and verify

```sh
./studio render episodes/join-fanout --preview join-multiplication     # -> out/join-fanout-preview-join-multiplication.mp4
./studio render episodes/join-fanout                                   # -> out/join-fanout-full.mp4
./studio verify episodes/join-fanout [--preview NAME]
```

`verify` recomputes the numbers with SQLite (running the SQL shown on screen), cross-checks them against the on-screen model, checks caption/word/event timing, and inspects the MP4 (resolution, fps, audio stream, speech onsets vs. the timeline). It also writes one frame per segment to `out/verify/` for visual inspection.

## Create another episode

```sh
./studio new my-topic            # copies episodes/_template
```

Edit `episodes/my-topic/episode.json`, then `./studio check episodes/my-topic` (validates with the same schema Remotion uses) and `./studio narrate episodes/my-topic`.

| Field | Purpose |
| --- | --- |
| `narration.segments[]` | `id`, `text` (shown in captions), optional `speech` (what the voice says, e.g. "six hundred rupees" for "₹600"), optional `captions` (hand-written phrases), `pauseAfter` |
| `scenes[]` | `type` + `params`; `segments` lists the narration it covers. Scenes must cover every segment in order. |
| `events[]` | `{segment, at, cue}` or `{segment, at, expression}`. `at` is `"start"`, `"end"`, `{"word": n}` or `{"offset": seconds}`. Timing comes from the generated narration, never from a fixed speaking rate. |
| `chapters[]` | The chips along the top |
| `sources[]`, `reviewNotes[]` | Technical review trail (not rendered) |
| `previews{}` | Named subsets of consecutive segments for short previews |

Scene types and their cues (`src/schema.ts` is the reference):

- `kpi-mismatch`: cues `checks`, `dashboard`, `expected`, `mismatch`
- `tables-lab`: cues `show-orders`, `show-history`, `grain-note`, `join-start`, `sum-start`, `counts`, `inspect-order`, `repair-start`, `pick-latest`, `rejoin`, `fixed-sum`
- `cards`: cues `card-1` … `card-4`

Expressions: `neutral`, `thinking`, `surprised`, `happy`, `concerned`, `pointing`.

## Use existing narration instead of Kokoro

```sh
./studio import episodes/my-topic --audio narration.wav --timestamps timestamps.json
```

```json
{"segments": [
  {"id": "s01", "start": 0.4, "end": 5.1, "words": [{"start": 0.4, "end": 0.7}]},
  {"id": "s02", "start": 5.6, "end": 9.0}
]}
```

`words` is optional (word times are then spread across the segment). Every segment id must appear, in order, with times in seconds in the audio file. Imported narration is for the full episode only (no `--preview`).

## Third-party art

All third-party art is copied into `public/assets/` (nothing is fetched at render time). `public/assets/manifest.json` records each file's source URL, version, SHA-256, licence and attribution requirement; licence texts are in `public/assets/licenses/`. Re-download with `.venv/bin/python scripts/fetch_assets.py`.

| Source | Licence | Use |
| --- | --- | --- |
| [3dicons v1](https://3dicons.co) ("clay" material) | CC0-1.0 | 3D objects. The white render backgrounds are colour-keyed to alpha (original WebPs kept in `3dicons/src`). |
| [Lucide](https://lucide.dev) 1.59.0 | ISC (some Feather-derived icons MIT) | Technical symbols; keep `licenses/lucide-LICENSE.txt` with any redistribution. |
| [Simple Icons](https://simpleicons.org) 16.35.0 | CC0 package; logos are trademarks of their owners | Product marks only where a specific product is discussed; check the brand's guidelines first. |

## Replace the presenter

`src/components/Presenter.tsx` is placeholder robot artwork. Replace the SVG but keep the props (`expression`, `prevExpression`, `expressionSince`, `mouth`, `t`).

## Layout

`src/theme.ts` defines the canvas, colours and safe areas. Chapter chips sit at y = 96, the stage spans y = 190–1110, presenter and terminal strip y = 1140–1470, captions at y = 1520; the bottom ~380 px stays clear of platform UI.
