# Accessibility

## Contents

1. The five checks that catch most problems
2. Semantics and names
3. Focus
4. Widget patterns
5. Forms
6. Motion, colour, zoom
7. Testing

The target is WCAG 2.2 AA unless the project states otherwise. The goal is not a score; it is
that someone using a keyboard, a screen reader, voice control or 200 % zoom can do the task.

## 1 · Five checks that catch most problems

1. **Keyboard walk.** Unplug the mouse mentally: Tab through the page. Every interactive
   thing is reachable, in a sensible order, with a visible focus ring, and operable with
   Enter/Space. Nothing traps focus except an open modal.
2. **Names.** Every control announces what it is and what it does. Run axe; then read the
   accessibility tree (browser devtools) for the component you changed.
3. **Headings and landmarks.** One `h1`, levels not skipped, `main`/`nav`/`header`/`footer`
   present — screen-reader users navigate by these.
4. **State changes announced.** Errors, toasts, loading completion and live results reach
   assistive tech through focus movement or a live region.
5. **Contrast and zoom.** Text ≥ 4.5:1 (≥ 3:1 for large text and for UI component boundaries
   and focus indicators); the layout survives 200 % zoom and 320 px width without horizontal
   scrolling of text.

## 2 · Semantics and names

- Native first. `<button>`, `<a href>`, `<input>`, `<select>`, `<details>`, `<dialog>` carry
  role, state and keyboard behaviour for free. ARIA is for what HTML cannot express — and
  "no ARIA is better than bad ARIA".
- Accessible name precedence: visible label → `aria-labelledby` → `aria-label`. Prefer
  visible text; if an icon button has none, give it `aria-label`, and hide the icon itself
  (`aria-hidden="true"`).
- Images: meaningful → `alt` describing the content/function; decorative → `alt=""`.
- Toggle state: `aria-pressed` (toggle buttons), `aria-expanded` (disclosures, menus),
  `aria-selected` (tabs, options), `aria-current="page"` (current nav item).
- Tables of data use `<table>`, `<th scope>`, and a caption; layout never uses tables.

## 3 · Focus

- Visible focus on every focusable element: `:focus-visible` styles with ≥ 3:1 contrast.
  Never `outline: none` without a replacement.
- DOM order = visual order = tab order. Avoid positive `tabindex`.
- After an action that removes the focused element (delete, close), move focus to the next
  logical element or the container heading.
- Route changes in an SPA: move focus to the new page's `h1` (or a skip target) and update
  `document.title`; otherwise screen-reader users hear nothing.
- Skip link ("Skip to content") as the first focusable element on content-heavy pages.

## 4 · Widget patterns

Follow the WAI-ARIA Authoring Practices keyboard model for each. Prefer the project's
component library (Radix, React Aria, Headless UI, Reka/Radix Vue, Bits UI, Angular CDK,
Material) — they implement these correctly; hand-rolled versions usually do not.

| Widget | Must do |
|---|---|
| Modal dialog | `role="dialog"` + `aria-modal="true"` (or native `<dialog>` with `showModal()`), labelled by its title; focus moves in on open and is trapped; Esc closes; focus returns to the trigger; background is inert |
| Menu button | `aria-haspopup`, `aria-expanded`; arrow keys move between items; Esc closes and returns focus |
| Tabs | `role="tablist"`/`tab`/`tabpanel`; arrow keys switch tabs (roving `tabindex`); panel labelled by its tab |
| Combobox / autocomplete | `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` for the highlighted option; typing filters, arrows move, Enter selects, Esc closes |
| Disclosure / accordion | a `<button>` with `aria-expanded` controlling the region |
| Toast / snackbar | `role="status"` (polite) or `role="alert"` (urgent); never the only place critical info appears; pausing on hover/focus; no auto-dismiss for errors that need action |
| Tooltip | supplementary only; appears on hover **and** focus; dismissible with Esc; never contains interactive content |

## 5 · Forms

- Every input has a `<label for>` (or wraps it). Required fields say so in text, not only an
  asterisk colour.
- Errors: `aria-invalid="true"`, message linked by `aria-describedby`, and on submit move
  focus to the first invalid field or to an error summary with links.
- Group related controls with `<fieldset>` + `<legend>` (radio groups, address blocks).
- Don't disable the submit button to signal validation errors — users can't discover why.
  Let them submit and explain.

## 6 · Motion, colour, zoom

- Respect `prefers-reduced-motion`: remove parallax, large transforms and autoplay; keep
  opacity fades short.
- Never encode meaning in colour alone — add an icon, text or pattern.
- Touch targets ≥ 24×24 CSS px (WCAG 2.2 minimum); 44×44 is the comfortable target.
- Text in `rem`; containers that grow with content; no fixed heights on text blocks.

## 7 · Testing

- **Automated:** `jest-axe` / `vitest-axe` in component tests, `@axe-core/playwright` in e2e,
  Storybook's a11y addon. These catch roughly a third of issues — names, contrast, roles —
  and nothing about focus flow or announcements.
- **Keyboard:** script the walk in Playwright (`page.keyboard.press('Tab')`, assert
  `toBeFocused()`), especially for dialogs and menus.
- **Screen reader smoke test** for new widgets: NVDA + Firefox/Chrome on Windows, VoiceOver +
  Safari on macOS/iOS, TalkBack on Android. Listen to one full task, not every page.
- **Testing Library queries by role** double as an accessibility check: if
  `getByRole('button', { name: 'Save' })` cannot find it, neither can a screen reader.
