---
name: design-system
description: >
  Build, extend, audit or migrate a design system in code — design tokens (colour, spacing,
  typography, radius, shadow, motion), light/dark theming, the shared component library and
  its APIs (variants, sizes, slots, states), Tailwind/CSS-variable/theme configuration,
  Storybook documentation, and the lint and visual checks that keep product code on the
  system. Use whenever adding a colour, spacing or font value, creating or changing a shared
  UI component, implementing a theme, finding hardcoded hex or pixel values, fixing
  "inconsistent UI", or syncing Figma variables or a DESIGN.md with code. For a one-off page or
  feature use frontend; for choosing an aesthetic or visual direction use design-taste-frontend
  (if installed).
---

# Design system engineering

A design system is not a component folder; it is a set of decisions (tokens), a set of
building blocks that encode them (components), and **the mechanisms that stop product code
from routing around them** (lint rules, checks, visual tests). The third part is what most
systems lack — and why most systems drift: a rule with no mechanism is a preference.

## Before you start

1. **Read the overlay.** `.agents/overlays/design-system.md`, if it exists, is this project's
   adaptation of this skill and wins where they disagree.
2. **Find the source of truth for tokens** — CSS custom properties, a Tailwind theme, a
   tokens JSON (W3C DTCG / Style Dictionary), a theme object, a `DESIGN.md` — and how it flows
   to components. There must be exactly one; if there are two, that is the first finding.
3. **Inventory the shared components** and how product code uses them. Before creating
   anything, search for the existing thing — including hand-rolled lookalikes that should
   have been the shared one.

## Tokens

Three tiers, and components consume only the semantic tier:

| Tier | Example | Who uses it |
|---|---|---|
| Primitive (palette) | `blue-600`, `space-4`, `radius-2` | only the semantic tier |
| Semantic (role) | `bg-surface`, `fg-muted`, `border-subtle`, `accent`, `danger`, `space-inline-md` | components and product code |
| Component (optional) | `button-bg-primary`, `input-border-focus` | that component |

Rules:

- **A new token needs a role, not just a value.** "`#6B7280` for this label" is not a token;
  "`fg-muted`: secondary text that still passes AA" is. Reuse a role before adding one.
- **Every semantic token is defined for every theme**, and text/background pairs are checked
  for contrast in each: 4.5:1 for body text, 3:1 for large text and UI boundaries/focus
  rings. A "muted" colour that fails AA is decorative — never for text a user must read.
- **Themes swap semantic mappings**, never component code. Dark mode is not `invert()`.
- **Apply the theme before first paint** (a blocking inline script or server-set attribute),
  not in an effect after mount — otherwise every load flashes the wrong theme.
- Naming and file formats: [references/tokens.md](references/tokens.md).

## Components

- **API by intent**, not by style: `variant="danger" size="sm"`, not `red small`. Enumerated
  variants over boolean soup (`primary`, `secondary`, `ghost` — not `isPrimary`, `isGhost`,
  `isOutline` that can conflict).
- **Composition over configuration** — slots/children/compound components rather than a
  growing list of `showX`, `xText` props.
- **Accessible by default** — correct element, focus-visible styles, disabled and loading
  states announced, labels required by the type system where possible.
- **Every state designed** — default, hover, active, focus-visible, disabled, loading,
  invalid, selected; with long text, empty text, and RTL if the product supports it.
- **Forward refs and rest props** so consumers can integrate; **no style escape hatch that
  bypasses tokens** (a free-form `color` prop becomes a hardcoded colour everywhere).
- **Widen, don't fork.** When a shared component almost fits, add a variant, prop or slot so
  every caller gains it. A local copy silently misses every future fix to the original.
- API patterns and examples: [references/component-api.md](references/component-api.md).

## The mistakes that matter

- **Hand-rolled duplicates of shared components.** A `div` with the card's classes *is* a
  second card — and when the card is fixed, it isn't. Count them: the gap between shared
  usages and lookalikes is the real health metric of the system.
- **Overriding part of a component's material inline.** `style={{ boxShadow: … }}` on a
  shared surface replaces the whole shadow stack, not one layer; the component "looks right"
  and is off-system. Change the component or add a variant.
- **Arbitrary values** — `#151515`, `text-[13px]`, `mt-[7px]`, `rgba(…)` in product code —
  bypass the scale and drift one screen at a time.
- **String-concatenated colours** — `var(--brand) + '33'` or `${token}80` for alpha does not
  produce valid CSS when the token is a variable. Use alpha tokens, `color-mix()`, or
  channel-based tokens (`rgb(var(--brand-rgb) / 0.2)`).
- **Decorative tokens used for readable text** — a tertiary/muted grey that fails contrast,
  used for hints and metadata people need to read.
- **Deleting a token or Tailwind alias without a usage search** — Tailwind drops classes that
  no longer resolve without any error, so the UI silently loses styling.
- **Visibility decided inside a layout child.** A component that returns `null` after the
  grid/stack has placed it leaves an empty cell or a titled empty card; decide visibility where
  the layout is composed.
- **Tokens defined for one theme only**, or components that hardcode a light-mode colour.
- **Primitives imported after components.** With plain CSS, equal-specificity rules resolve by
  import order: on `<a class="btn promo-cta">`, the shared `.btn` beats `.promo-cta`'s override
  whenever the primitives load later. Import reset → tokens → primitives → components, or pin
  the order with `@layer`.

## Enforcement — make the rules mechanical

Each rule above should have a check. Pick what fits the stack:

- Lint: stylelint `color-no-hex`/`declaration-strict-value` for CSS; ESLint
  `no-restricted-syntax` for arbitrary Tailwind values or inline colour styles; a Tailwind
  config that exposes only the token scale.
- Scripts: find hand-rolled containers, dead classes, unused tokens.
- Visual regression on the component library (Playwright screenshots, Chromatic) in both themes.
- Accessibility checks in Storybook/tests for contrast and names.
- **Ratchet** existing violations: record today's count, fail only when it grows, burn it down.

Recipes, audit commands and a ratchet script outline:
[references/audit-and-enforcement.md](references/audit-and-enforcement.md).

## Migrating an existing UI onto tokens

Inventory values (colours, sizes) → cluster them into roles → define semantic tokens →
codemod or replace per area → add the lint rule with a ratchet baseline → burn down → make
it blocking at zero. Never a big-bang rewrite across the app in one PR.

## Done means

- New values exist as semantic tokens in every theme, with contrast checked.
- Shared components changed or widened — no local copies; every state renders.
- The check that enforces the rule you just relied on exists, or its absence is recorded as a
  gap.
- Docs/stories updated for new variants; visual tests updated deliberately, not blindly.

When the design system here has a rule that isn't written down anywhere, capture it in
`.agents/learnings/inbox.md` — the retro turns it into a lint rule or an overlay entry.
