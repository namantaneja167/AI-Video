# Explainer Studio: product planning

Planning only. No implementation has started.

| Doc | Contents |
|---|---|
| [01 Current-state audit](01-current-state-audit.md) | Working, experimental, missing |
| [02 Product specification](02-product-spec.md) | Episode journey, autosave, caching, invalidation, jobs, review, import, layouts |
| [03 Navigation and editor mockup](03-navigation-and-editor-mockup.md) | Screens; interactive HTML in `mockups/` |
| [04 Architecture](04-architecture.md) | Connecting Qwen and Remotion; diagram in `diagrams/` |
| [05 Implementation plan](05-implementation-plan.md) | Phases 0 to 8 with acceptance criteria |

## Preserved

`prototypes/pip-scene-10x-v1/` (frozen, read-only) and the live code behind it. See the audit.

## Decisions needed

1. Local web app (recommended) or native macOS app.
2. Download an optional forced-alignment model for true word timing, or keep envelope-estimated timing.
3. Git policy for revisions and generated artifacts (recommended: episodes tracked, `.studio/` ignored).
4. Retire the Kokoro path once Qwen is integrated.
5. Remotion licence check before any distribution.
6. Default layout and caption zone for new episodes.
7. Generation unit: block (recommended) or single segment.
8. Loudness mastering at export (recommended) or in the voice premix.
