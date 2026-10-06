# Tokens

## Contents

1. Naming
2. A minimal semantic set
3. CSS custom properties and theming
4. Tailwind
5. DTCG / Style Dictionary
6. Contrast
7. Figma variables and DESIGN.md

## 1 · Naming

`<category>-<role>-<variant?>-<state?>` in the semantic tier: `bg-surface`, `bg-surface-raised`,
`fg-default`, `fg-muted`, `border-subtle`, `accent-default`, `accent-hover`, `danger-fg`,
`focus-ring`. Scales for spacing, radius, type and motion use t-shirt or numeric steps
consistently (`space-1…space-12`, `radius-sm/md/lg/full`, `text-xs…text-3xl`,
`duration-fast/base/slow`).

Avoid names that encode the value (`gray-500-text`) or the page (`checkout-blue`) — both
break when the value or the page changes.

## 2 · A minimal semantic set

| Group | Tokens |
|---|---|
| Surfaces | `bg-canvas`, `bg-surface`, `bg-surface-raised`, `bg-surface-sunken`, `bg-overlay`, `bg-hover`, `bg-selected` |
| Text | `fg-default`, `fg-muted` (AA), `fg-subtle` (decorative only), `fg-on-accent`, `fg-disabled` |
| Borders | `border-subtle`, `border-default`, `border-strong`, `focus-ring` |
| Brand/accent | `accent`, `accent-hover`, `accent-active`, `accent-subtle` (tinted background) |
| Status | `success-*`, `warning-*`, `danger-*`, `info-*` — each with `fg`, `bg`, `border` |
| Space | `space-0…space-12` on a 4 px base |
| Radius | `radius-xs, sm, md, lg, xl, full` |
| Type | family (`font-sans`, `font-mono`, `font-display`), size+line-height pairs, weights |
| Elevation | `shadow-sm, md, lg` — full stacks, not single layers |
| Motion | `duration-fast (≈120 ms)`, `duration-base (≈200 ms)`, `duration-slow (≈300 ms)`, easing tokens; honour reduced motion |

## 3 · CSS custom properties and theming

```css
:root {
  --bg-surface: #ffffff;
  --fg-default: #111827;
  --fg-muted: #4b5563;          /* 7.6:1 on white — readable */
  --accent: #2563eb;
  --accent-rgb: 37 99 235;       /* channels, for alpha: rgb(var(--accent-rgb) / 0.12) */
}
:root[data-theme="dark"] {
  --bg-surface: #111318;
  --fg-default: #e5e7eb;
  --fg-muted: #9ca3af;          /* check against the dark surface too */
  --accent: #60a5fa;
  --accent-rgb: 96 165 250;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* same as dark, when the user hasn't chosen */ }
}
```

Set `data-theme` before first paint — an inline script in `<head>` that reads the stored
preference, or the server rendering the attribute from a cookie. Setting it in a React effect
causes a flash of the wrong theme on every load.

Alpha variants: channel tokens (`--accent-rgb`) or `color-mix(in srgb, var(--accent) 12%,
transparent)`. Never concatenate hex-alpha suffixes onto `var()`.

## 4 · Tailwind

- Map the theme to CSS variables (`colors: { surface: 'var(--bg-surface)', … }`, or Tailwind
  v4 `@theme` variables) so dark mode is a variable swap, not `dark:` classes on every element.
- Restrict the palette to tokens: remove or don't extend the default colour palette if the
  project wants enforcement; arbitrary values (`text-[13px]`, `bg-[#151515]`) are then the
  only escape hatch — lint them.
- Class-merging (`tailwind-merge`, `cva`) inside components keeps variant APIs predictable.

## 5 · DTCG / Style Dictionary

For multi-platform systems (web + native), keep tokens as W3C Design Tokens (DTCG) JSON:

```json
{
  "color": {
    "fg": {
      "muted": { "$type": "color", "$value": "{color.gray.600}", "$description": "Secondary text; AA on surfaces" }
    }
  }
}
```

and generate CSS variables, Tailwind config, iOS/Android resources with Style Dictionary (or
the project's pipeline). Generated files are never edited by hand; CI regenerates and fails on
drift.

## 6 · Contrast

| Pair | Minimum (WCAG 2.2 AA) |
|---|---|
| Body text vs background | 4.5 : 1 |
| Large text (≥ 24 px, or ≥ 18.66 px bold) | 3 : 1 |
| UI component boundaries, icons that convey meaning, focus indicators | 3 : 1 against adjacent colours |
| Disabled controls, pure decoration | exempt |

Check every text-bearing semantic pair in every theme — a table of `fg-*` × `bg-*` with the
computed ratio is a cheap, reviewable artefact. Tools: the browser devtools contrast checker,
axe, or a script using a WCAG contrast function over the token file.

## 7 · Figma variables and DESIGN.md

- Keep token names identical between Figma variables and code; a rename in one place is a
  migration in the other.
- Decide the direction of sync (design → code or code → design) and automate it; two
  hand-maintained copies drift within a sprint.
- A `DESIGN.md` (from a design/taste skill or a designer) describes intent — atmosphere,
  roles, spacing philosophy. Treat it as the input: translate each described role into a
  semantic token, flag where it conflicts with existing tokens, and don't copy raw values into
  components.
