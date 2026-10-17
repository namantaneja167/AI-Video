# Pip: visual brief for image-generated concepts

**Use:** generate the final look of Pip, an original AI-capsule companion for a channel about current tech (launches, AI trends, how things work). Concepts will be compared, one chosen, and only then rebuilt as editable vector layers. v1 (in `reference/pip-v1/`) is a layout and colour reference only, **not** a style target.

**Personality:** curious, witty, technically grounded, skeptical of hype. Alert and approachable, with playful confidence. Not sleepy, not smug, not a permanent smile.

## Keep

- **Silhouette:** asymmetric capsule, roughly 0.9 wide to 1.0 tall. Fuller right shoulder, softer left belly, slight lean. Hovers; no feet, no legs, no stand.
- **Split:** burnt-orange crescent shell on the left (about a third of the width), warm ivory body on the right, a visible raised seam with a thin bevel.
- **Face:** eyes, brows and a small mouth sit directly in the shell. No screen, no visor, no dark face panel, no antenna, button or strap.
- **Small floating hands:** no arms. Palette: ivory `#F3EADA`, burnt orange `#C75A2C`, charcoal `#2B2826`.

## Change from v1 (why it reads as a "sleepy bean")

v1 diagnosis: the neutral preset covers 6–10% of each eye with a lid, the brows are thick, low and tapered, there are shadows above and a highlight ring below each eye, the eyes have orange iris rings, and the base sags like a bean.

1. **Simpler eyes.** One flat shape per eye, one dark pupil, one highlight. No iris ring, lashes, or shading inside the eye. Explore two options: ivory eyes with charcoal pupils, and solid charcoal ovals with a highlight.
2. **Lighter brows.** Thinner, shorter, lower contrast, a single clean stroke each. No taper, no weight.
3. **No under-eye shading.** No sockets, bags, rings or soft shadows around the eyes at all.
4. **Cleaner material.** Matte satin ceramic or soft-touch plastic. At most three value steps per surface, one soft shading band, a crisp seam. No gloss, glass, metal, grain, texture or glow.
5. **Sleek volume.** Same proportions, but taut and confident: crisp shoulders, a firm base instead of sagging.
6. **Intentional hands** (below).

## Light

One key light from the top-left on every surface, with a soft shadow falling bottom-right. A soft ground shadow sits under the hovering body.

## Expressions

All four share one face layout, so they can be rigged as swaps later.

- **Neutral (alert, approachable):** eyes fully open and equal, looking at the viewer. Brows slightly raised, one a touch higher. Mouth small and closed with a faint one-sided lift. Upright, leaning very slightly toward the viewer.
- **Curious:** head tilted, one brow high, eyes slightly larger, gaze up and to the side toward something off-screen, small round "o" mouth.
- **Skeptical:** one eyelid half-lowered, the opposite brow raised, flat mouth with one corner lifted, leaning back, one hand raised (pointing or "hold on").
- **Surprised:** eyes wide, both brows high, small round mouth, body stretched taller and lifted, hands up.

## Hands

Simple, readable mitt or glove with deliberate fingers (for example three chunky fingers and a thumb), designed once and reused. Small, about 18% of body width, and clear at phone size. Show a set: relaxed, pointing, open palm ("hold on"), shrug. Charcoal, or ivory with an orange accent.

## Avoid

Medical pill or two-tone vitamin look; generic chatbot or speech-bubble icon; robot, device, or smart-speaker look; screen face; permanent smile; heavy lids; under-eye shading; accessories on the base character; and any resemblance to an existing mascot or character (do not reference or imitate any).

## Output request

- A sheet of **4 distinct concepts**, full body, front view, same scale, each with the four expressions.
- Plain flat light-grey background, no text, no scene, 2048 px or larger.
- For the chosen concept, a hand set and a three-quarter view.

## Prompt-ready text

**Master:** an original friendly AI-companion character, a sleek asymmetric capsule shape with a burnt-orange shell crescent on the left and warm ivory body on the right, separated by a thin raised bevelled seam, matte satin ceramic finish, soft single key light from the top-left, simple flat eyes with one dark pupil and one highlight, thin light eyebrows, a small expressive mouth, face integrated directly in the shell, two small floating mitten hands with clear fingers, no arms or legs, hovering with a soft ground shadow, alert and confident, plain light-grey background, full body, clean vector-like illustration, high quality.

**Per expression, add:** *neutral* "alert, approachable, eyebrows slightly raised, faint one-sided smile" · *curious* "head tilted, one brow raised, small round mouth, looking sideways" · *skeptical* "one eyelid half lowered, one eyebrow raised, lopsided flat mouth, leaning back, one hand raised" · *surprised* "wide eyes, high eyebrows, round mouth, stretched upward, hands up".

**Negative:** screen face, visor, robot, device, antenna, button, strap, feet, legs, arms, monocle, glossy, glass, metal, noise, grain, heavy eyelids, under-eye shadows, eyelashes, permanent wide smile, medical capsule, chatbot icon, text, logo, existing mascot likeness.

## Reference images

`reference/pip-v1/pip_{neutral,curious,skeptical,surprised}.png`, character only on transparency. Use them for proportion, the shell split and the pose logic. Do not copy their eyes, brows, hands or shading.

## After a concept is chosen

Decide which parts to rebuild as editable vector layers for animation. Candidates: silhouette and shell (one shape each), seam, eyes, lids, brows, mouth set, hands set, ground shadow. Controls available today are documented in `docs/pip/v1-expression-controls.md`.
