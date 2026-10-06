# Auditing and enforcing a design system

## Contents

1. Audit recipes
2. Lint rules
3. The ratchet
4. Visual regression
5. Reporting

## 1 · Audit recipes

Run from the frontend root; adjust globs to the project.

```bash
# Hardcoded colours in components (exclude token definitions)
rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" src --glob '!**/tokens*' --glob '!**/theme*' --glob '!*.svg'

# Arbitrary Tailwind values
rg -n "\b(text|bg|border|p[trblxy]?|m[trblxy]?|gap|w|h|rounded|shadow)-\[[^\]]+\]" src

# Inline styles that set visual properties
rg -n "style=\{\{[^}]*(color|background|boxShadow|border|fontSize|padding|margin)" src

# Hex + alpha concatenated onto a variable (invalid CSS)
rg -n "var\(--[a-z0-9-]+\)\s*\+?\s*['\"]?[0-9a-fA-F]{2}\b|\$\{[^}]+\}[0-9a-fA-F]{2}['\"`]" src

# Candidate hand-rolled duplicates of a shared container (adapt the signature classes)
rg -n "rounded-(lg|xl).*(border|shadow).*(p-4|p-6)" src --glob '!**/components/ui/**'

# Usage of the shared component, for the ratio
rg -c "<Card\b" src | awk -F: '{s+=$2} END {print s}'
```

The number that matters is the **ratio** of shared-component usages to lookalikes, and of
token usages to raw values — track it over time.

## 2 · Lint rules

**stylelint** (CSS, CSS modules, styled-components with the processor):

```json
{
  "rules": {
    "color-no-hex": true,
    "scale-unlimited/declaration-strict-value": [["/color$/", "background", "box-shadow", "font-size", "z-index"], { "ignoreValues": ["inherit", "currentColor", "transparent", "none", "0"] }]
  }
}
```

**ESLint** (JSX/TSX) — ban arbitrary Tailwind values and inline colour styles:

```js
'no-restricted-syntax': ['error',
  { selector: "Literal[value=/\\b(text|bg|border)-\\[#/]", message: 'Use a colour token, not an arbitrary value.' },
  { selector: "JSXAttribute[name.name='style'] Property[key.name=/^(color|background|backgroundColor|boxShadow)$/]", message: 'Visual styles come from tokens/variants, not inline styles.' },
]
```

Tailwind: expose only token-backed theme values; consider `eslint-plugin-tailwindcss`
(`no-arbitrary-value`, `no-custom-classname`) if the project uses it.

## 3 · The ratchet

A new rule on an old codebase fails hundreds of files; nobody merges that. Instead:

1. Count current violations per rule and commit the counts (`design-lint-baseline.json`).
2. The check fails only if a count **increases** (or a new file introduces a violation).
3. Every PR that touches a file with violations is encouraged to fix them; the baseline is
   lowered when counts drop.
4. When a count reaches zero, flip that rule to plain blocking and delete its baseline.

A ~40-line Node script over the `rg` recipes above, wired as a gate in
`.agents/sdlc.config.json`, is enough. Make it fail once on purpose to prove it works.

## 4 · Visual regression

- Stories (or a dedicated page) render each component in each state and theme.
- Playwright `toHaveScreenshot()` or Chromatic/Percy compare against committed baselines.
- Stabilise before snapshotting: fixed fonts, disabled animations, fixed dates, explicit
  colour scheme (headless browsers can inherit the OS dark theme).
- Review diffs; never update all baselines blindly.

## 5 · Reporting an audit

```markdown
## Design-system audit — <scope> — <date>
- Tokens: N raw colour values in product code (top files: …); M arbitrary Tailwind values.
- Components: Card used 99×, ~270 hand-rolled lookalikes (sample: …).
- Contrast: fg-muted on bg-surface-raised = 3.9:1 in dark theme — fails AA for body text.
- Enforcement: hex colours — none; arbitrary values — lint (warning only); duplicates — none.
Next action: add the hex-colour lint with a ratchet baseline (S).
```

Lead with counts, end with one next action — the cheapest mechanism with the largest effect.
