# Pip v1: expression controls (current state)

Source: `src/art/pip2/Pip.tsx`. A frozen copy is in `archive/pip-v1/Pip.tsx`. Transparent references are in `reference/pip-v1/`. This documents what exists today; nothing here is animated or rigged.

## Using it

```tsx
<Pip expr="skeptical" uid="scene" crop={[0, 172, 400, 400]} width={600} height={600} hands shadow />
```

| Prop | Meaning |
| --- | --- |
| `expr` | A preset name (`neutral`, `curious`, `skeptical`, `surprised`) or a full `Expr` object. The object must be complete; nothing is merged. |
| `uid` | Must be unique per instance on the page (it prefixes SVG clip and gradient ids). |
| `crop` | SVG viewBox `[x, y, w, h]` in the character's 400×600 space. The whole character fits in `[-40, 100, 480, 480]`. |
| `width`, `height` | Rendered size in px. |
| `hands`, `shadow` | Toggle the floating hands and the ground shadow. |

The component renders one static frame from numbers. It does not interpolate; a later animation would feed it interpolated `Expr` values. Export command: `npx remotion still src/index.ts art-pip-export out.png --props=props.json` with `{"expr":"neutral"}` (composition `art-pip-export`, 1200×1200, transparent).

## `Expr` fields

Units are in the 400×600 drawing space. Angles are degrees, clockwise positive. "Left" and "right" are the viewer's left and right.

| Field | Range used | Effect |
| --- | --- | --- |
| `openL`, `openR` | 0.95–1.3 | Multiplies each eye's height. The width is fixed. |
| `lidL`, `lidR` | 0–0.52 | Fraction of the eye covered by the lid from above; drawn as a curved cut plus a charcoal lid line. |
| `lidTilt` | 0–10 | Slants both lids toward the nose (left eye `+`, right eye `−`). |
| `gx`, `gy` | −1…1 | Gaze. Both irises shift by `0.3 × eye radius × value`. One gaze for both eyes. |
| `browL.y`, `browR.y` | −22…7 | Vertical offset in px (negative = up). |
| `browL.rot`, `browR.rot` | −8…17 | Brow rotation. Positive on the left brow lowers its inner end (a frown); positive on the right brow raises its inner end. |
| `mouth.w` | 14–32 | Mouth width in px. |
| `mouth.open` | 0–1 | Above 0.05 the mouth becomes a filled oval (vertical radius `4 + open × 10`, horizontal radius `w / 2`) with an orange tongue; at or below it, a closed curve. |
| `mouth.curve` | −0.2…0.3 | Closed mouth only. Positive = smile, negative = flat or frown (control point moves `curve × 9` px). |
| `mouth.skew` | 0–1 | Closed mouth only. Lowers the left corner `3 × skew` px and raises the right corner `7 × skew` px. |
| `tilt` | −5…7 | Lean of the whole body about its base `(197, 552)`. |
| `sx`, `sy` | 0.95–1.08 | Squash and stretch about the same base point. |
| `lift` | 9–34 | Hover height in px. Also shrinks and fades the ground shadow. |
| `handL`, `handR` | see below | Floating hand position `x, y`, rotation `rot`, optional `point`. The right hand is drawn mirrored. `point: true` adds a pointing finger. |

## Presets

| | neutral | curious | skeptical | surprised |
| --- | --- | --- | --- | --- |
| `openL` / `openR` | 1 / 1 | 1.1 / 1.12 | 1 / 1 | 1.28 / 1.3 |
| `lidL` / `lidR` | 0.1 / 0.06 | 0 / 0 | 0.52 / 0.2 | 0 / 0 |
| `lidTilt` | 0 | 0 | 10 | 0 |
| `gx`, `gy` | 0.5, 0.05 | 0.85, −0.45 | 0.75, 0.2 | 0, 0 |
| `browL` (y, rot) | 0, −4 | −4, −7 | 7, 17 | −22, −8 |
| `browR` (y, rot) | −6, 7 | −17, 12 | −15, 5 | −22, 8 |
| `mouth` (w, open, curve, skew) | 26, 0, 0.3, 0 | 14, 0.8, 0, 0 | 32, 0, −0.2, 1 | 20, 1, 0, 0 |
| `tilt` | 2 | 7 | −5 | 0 |
| `sx`, `sy` | 1, 1 | 0.98, 1.03 | 1.04, 0.965 | 0.95, 1.08 |
| `lift` | 14 | 20 | 9 | 34 |
| `handL` (x, y, rot) | 34, 468, 12 | 34, 470, 12 | 36, 462, 12 | 28, 330, 28 |
| `handR` (x, y, rot) | 366, 456, −12 | 352, 424, −26 | 368, 340, −40, point | 372, 322, −28 |

## What is fixed in the code (not controls)

- **Body and seam geometry:** the body path `BODY` and the seam path `SEAM`; the shell is the region left of the seam. Edit them in code.
- **Eye and brow placement:** the eye centres and radii (left 212, 342, 26×36; right 282, 336, 22×33), the brow centres and lengths (left 212, 292, 62; right 284, 286, 54), and the mouth centre at (247, 398).
- **Lighting and shading:** the key light offset (−16, −22), blur amounts, and the highlight positions.
- **Colours:** `K` at the top of the file (ivory, orange and charcoal ramps, eye white).

## Known limits

- One gaze for both eyes, and both hands use the same mitt drawing.
- Only one closed-mouth shape and one open-mouth shape; no speech mouth set.
- No three-quarter or side view, and no per-feature layers; the face and shell are one SVG.
- The neutral preset is the "sleepy" read described in `docs/pip/visual-brief.md`.
