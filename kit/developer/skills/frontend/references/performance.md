# Frontend performance

## Contents

1. Budgets and what to measure
2. Measuring honestly
3. LCP — the main content is slow to appear
4. INP — the page is slow to respond
5. CLS — things jump
6. Bundle size
7. Rendering cost in component frameworks

## 1 · Budgets

Core Web Vitals thresholds for "good", measured at the 75th percentile of real page loads:

| Metric | Good | What it captures |
|---|---|---|
| LCP (Largest Contentful Paint) | ≤ 2.5 s | when the main content appears |
| INP (Interaction to Next Paint) | ≤ 200 ms | how fast the page responds to input |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | visual stability |

If the project defines its own budgets (bundle size, route weight, TTI on a reference
device), those win. Don't invent a budget and present it as the project's.

## 2 · Measuring honestly

- **Lab:** Lighthouse / PageSpeed Insights, Chrome DevTools Performance panel with CPU
  throttling (4–6×) and a "Fast 4G"/"Slow 4G" network profile. The dev machine is the fastest
  hardware the app will ever run on.
- **Field:** the `web-vitals` library, CrUX, or the project's RUM. Field data beats lab data
  when they disagree.
- **Production build only.** Dev builds include checks and unminified code; their numbers
  mean nothing.
- Measure before and after each change, same conditions, and keep the numbers in the PR.

## 3 · LCP

Find the LCP element (DevTools shows it). Then, in order of usual payoff:

1. **Server response time** — slow TTFB caps everything. Cache, stream, or move data fetching
   earlier (server components/loaders instead of client waterfalls).
2. **Discovery** — the LCP image must be in the initial HTML, not injected by JS. Give it
   `fetchpriority="high"` and don't lazy-load it. Preload the hero font if text is LCP.
3. **Size** — responsive images (`srcset`/`sizes`), modern formats (AVIF/WebP), correct
   dimensions; the framework's image component usually does this.
4. **Render-blocking resources** — inline critical CSS, defer non-critical scripts,
   `font-display: swap` or `optional`.
5. **Client-side waterfalls** — fetch in parallel; don't chain request B on component A's
   render. Preload data for the next route on hover/intent.

## 4 · INP

Slow interactions are long tasks on the main thread.

- Profile the interaction in the Performance panel; look for long tasks (> 50 ms).
- Do less on input: debounce expensive filters, move heavy work off the critical path
  (`requestIdleCallback`, `scheduler.yield()`/`setTimeout` chunking, Web Workers for parsing
  and computation).
- In React, `useTransition`/`useDeferredValue` keep typing responsive while a heavy list
  re-renders.
- Virtualise long lists (TanStack Virtual, react-window, vue-virtual-scroller).
- Third-party scripts (tag managers, chat widgets) are frequent culprits — load them late.

## 5 · CLS

- Width/height (or `aspect-ratio`) on every image, video, iframe and ad slot.
- Skeletons the same size as the content they stand in for.
- Reserve space for anything that loads late (banners, embeds, consent bars) or render it
  over content rather than pushing content down.
- Fonts: `size-adjust`/metric-compatible fallbacks, or `font-display: optional`.
- Animate `transform` and `opacity`, never `top`/`height`/`width`.

## 6 · Bundle size

- Analyse before optimising: `rollup-plugin-visualizer` (Vite), `@next/bundle-analyzer`,
  `source-map-explorer`, `webpack-bundle-analyzer`.
- Route-level code splitting (lazy routes); dynamic `import()` for heavy, rarely used
  features (charts, editors, maps).
- Import precisely: `import debounce from 'lodash/debounce'`, not `import _ from 'lodash'`;
  replace moment-style libraries with `Intl`/date-fns/dayjs; check that icon libraries
  tree-shake.
- Watch the client/server boundary in React Server Components: `'use client'` on a high-level
  component ships its whole subtree to the browser. Push the boundary down to the leaves that
  need interactivity.

## 7 · Rendering cost

- Find it with the framework profiler (React DevTools Profiler "why did this render",
  Vue devtools performance, Angular DevTools) before changing code.
- Common causes: a context/provider value object recreated every render; props that are new
  arrays/objects/functions each render passed into memoised children; state held too high so
  every keystroke re-renders the page; effects that set state on every render.
- Fix the cause (move state down, split contexts, stabilise values) before reaching for
  `memo`/`useMemo`. The React Compiler, if the project uses it, handles most memoisation —
  don't add manual memoisation on top without measuring.
