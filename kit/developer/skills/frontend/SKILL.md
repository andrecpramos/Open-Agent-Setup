---
name: frontend
description: >
  Build, change, review or debug user-facing UI in any web or mobile frontend — components,
  pages, forms, modals and dialogs, client and server state, data fetching, routing,
  accessibility (keyboard navigation, focus), rendering performance and frontend tests,
  including end-to-end tests of UI flows. Use whenever a task touches .tsx/.jsx/.vue/.svelte/
  .astro/.html/.css files or React, Next.js, Vue, Nuxt, Svelte, Angular or React Native code,
  a UI bug ("the page flickers", "the button does nothing", "stale data after saving", a
  hydration mismatch), a refactor such as class components to hooks, a form, a
  loading/empty/error state or a slow screen. Load it before the first change, even if the
  user never says "frontend". Not
  for design tokens, theming or the shared component library (design-system), API contract
  shape (api-design), or choosing a visual style (design-taste-frontend, if installed).
---

# Frontend engineering

The job: UI that is correct in every state, usable by keyboard and screen reader, fast on the
hardware real users have, and consistent with the codebase it lands in. The happy path is a
fifth of the work and all of the mockups — this skill is mostly about the other four fifths.

## Before you start

1. **Read the overlay.** `.agents/overlays/frontend.md`, if it exists, is this project's
   adaptation of this skill. Where it disagrees with this file, it wins.
2. **Learn the house style from the code, not from memory.** Open two neighbours that do
   something similar and copy their answers to: where files go, how data is fetched, how
   forms and errors work, how tests are written, how strings are translated. A second,
   parallel way of doing something the codebase already does is a defect even when your way
   is better — the next fix to the original will miss yours.
3. **Identify the stack** from `package.json` — framework, router, data layer, styling, test
   runner — and read its section in [references/frameworks.md](references/frameworks.md).
4. **Search before you build a primitive.** If the component library or design system has a
   close match, extend it with a prop or slot instead of hand-rolling a lookalike.

## Workflow for a UI change

1. **Enumerate the states before writing markup.**
   Data: idle · loading · success · empty · error · partial · refetching · offline.
   Interaction: default · hover · focus-visible · active · disabled · pending · invalid.
   Each one needs a deliberate rendering. Write the list down for anything non-trivial.
2. **Decide who owns each piece of state.** This is the decision that most often goes wrong:

   | State | Owner | Not |
   |---|---|---|
   | Data that lives on the server | the data layer — query cache, loader, server component | `useState` + `useEffect`, a global store |
   | Shareable view state — filters, tab, page, sort, selected id | the URL | component state (breaks back, refresh, share) |
   | Form input and validation | the form (library or local state) | a global store |
   | Purely visual — open, hovered, expanded | the component | the URL, a store |
   | Anything computable from the above | derived during render | a second piece of state synced by an effect |

   Patterns, race handling and mutations: [references/state-and-data.md](references/state-and-data.md).
3. **Structure first, then style.** Semantic elements (`button`, `a href`, `label`, `nav`,
   `main`, lists, headings in order), accessible names, focus management — then design-system
   tokens for colour, spacing, type and motion. No raw hex or magic pixel values where tokens exist.
4. **Wire data together with its failure modes:** latest-wins or cancellation for inputs that
   change, a pending state that blocks double submits, server errors mapped back onto the
   fields they concern, optimistic updates only with rollback, and invalidation of every
   cached query the mutation affects.
5. **Test at the level the user experiences it** — queries by role, label and text,
   user-event interactions, the network mocked at the boundary. One end-to-end test for the
   critical path if the project has an e2e runner. [references/testing.md](references/testing.md).
6. **Verify in a browser when you can:** keyboard only (Tab, Shift+Tab, Enter, Space, Esc),
   320 px wide, throttled network, each theme, 200 % zoom. If you cannot run a browser, say
   which of these you did not check rather than implying they pass.

## The mistakes that matter

These recur in AI-written frontend code. Look for them in your own diff before calling it done.

- **Fetching in an effect.** `useEffect(() => { fetch(…).then(setData) }, [q])` has no cache,
  no deduplication, no cancellation, a race when `q` changes (the slow old response lands
  last and wins), a double request under StrictMode, and no loading or error state unless
  hand-written. Use the project's data layer. If there is none, say so before adding one.
- **State kept in sync by an effect.** If a value can be computed from props or other state,
  compute it during render. An effect that copies state into state renders twice and drifts
  the first time a dependency is missed.
- **Server data copied into a global store** — two sources of truth that disagree after the
  first mutation. The query cache *is* the store.
- **Clickable `div`s and navigating buttons.** Actions are `<button type="button">`,
  navigation is `<a href>`. A `div` with `onClick` has no keyboard, role or focus.
- **Unlabelled controls.** Icon-only buttons need an accessible name; inputs need a real
  `<label>` (a placeholder is not one); errors need `aria-describedby` and must not rely on
  colour alone.
- **Lost focus.** A dialog must move focus in, trap it, close on Esc and return focus to its
  trigger. Removing an item must leave focus somewhere sensible, not on `<body>`.
- **Only the happy path rendered** — a blank screen while loading, nothing for an empty list,
  a swallowed error. Every async view needs all three, designed.
- **Double submits and lost input.** Submit stays enabled while the request is in flight; a
  failed submit clears what the user typed.
- **Index keys on lists that reorder, filter or delete** — React reuses the wrong DOM and
  component state. Use a stable id.
- **Layout shift** from images without dimensions, skeletons that differ in size from the
  content, late fonts, or banners injected above content.
- **Hydration mismatches** from `Date.now()`, `Math.random()`, `window` or locale formatting
  during server render. Use the framework's id helper, or format on the client.
- **Hardcoded strings, colours and sizes** in a codebase that has i18n and tokens.
- **Unscoped component stylesheets.** Without CSS modules or scoping, the bundler ships every
  route's CSS to every page, so a bare `h2 {}` or `section p {}` in one component's file
  styles the whole app. Nest element selectors under the component's own class.
- **Imperative classes on a React-managed `className`.** A class added with `classList` (a
  scroll-reveal flag, say) vanishes on the next render that rewrites `className`. Keep flags
  set outside React in `data-*` attributes or in state.
- **Chaining on `media.play()`.** It returns a promise that rejects when autoplay is blocked,
  and `undefined` in older browsers and jsdom. Wrap it once, guard the return value and catch
  the rejection.
- **Secrets and tokens in the client.** Anything in a `NEXT_PUBLIC_`/`VITE_`/`PUBLIC_`
  variable ships to every browser. Tokens in `localStorage` are readable by any XSS — prefer
  httpOnly cookies. `dangerouslySetInnerHTML`/`v-html`/`innerHTML` with anything a user can
  influence is XSS unless sanitised by a vetted library.
- **Unbounded rendering** — thousands of rows without pagination or virtualisation, a context
  value rebuilt every render, whole-library imports. Measure before memoising; blanket
  `useMemo`/`useCallback` adds cost and stale-closure bugs.
- **Tests of implementation details** — class names, internal state, snapshot dumps. They
  break on every refactor and pass straight through real bugs.

## When the task is performance

Measure first on a throttled profile, never the dev machine: LCP, INP, CLS, bundle size. Fix
the biggest contributor, re-measure, stop at the budget. [references/performance.md](references/performance.md).

## Accessibility is structural

Semantics and focus order cost a rewrite to retrofit, so they are part of building the
component, not a pass at the end. Dialogs, menus, tabs, comboboxes, toasts and how to test
them: [references/accessibility.md](references/accessibility.md).

## Done means

- Typecheck, lint and tests pass — the project's gates (`/gates`, or the commands in
  AGENTS.md), including tests you did not touch.
- Every state from step 1 renders something deliberate, and you can say what each looks like.
- Keyboard-only use works; no unlabelled controls; no console errors or warnings introduced.
- No new hardcoded colours, sizes or user-facing strings where the project has tokens or i18n.
- Your report says what you verified in a real browser and what you could not.

If you had to change course because this repo does things differently, add one entry to
`.agents/learnings/inbox.md` so the next session starts where you finished.
