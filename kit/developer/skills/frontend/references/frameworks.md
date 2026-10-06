# Framework notes

Version-sensitive: confirm against the version in the project's lockfile before relying on
a default. Where the project's code does something differently from these notes, the
project wins — record why in `.agents/overlays/frontend.md`.

## Contents

- React
- Next.js (App Router)
- Vue 3 and Nuxt
- Svelte 5 and SvelteKit
- Angular
- React Native / Expo
- Astro

## React

- Rules of hooks: top level only, same order every render. Custom hooks start with `use`.
- StrictMode runs effects twice in development. Code that breaks under it (double POSTs,
  subscriptions without cleanup) is broken — the second run exposes the missing cleanup.
- Effects are for synchronising with something *outside* React (subscriptions, the DOM,
  timers, non-React widgets). Transforming data, reacting to a user event, or resetting
  state when a prop changes are not effects — compute during render, handle in the event
  handler, or change the component's `key`.
- Keys: stable ids from the data. `key` also resets a subtree's state on purpose.
- React 19: Actions (`useActionState`, `useFormStatus`, `useOptimistic`) for form
  submissions; `use()` for reading promises and context; ref as a prop (no `forwardRef` needed
  in new code). Use them if the project is on 19 and already does; don't mix idioms within one
  feature.
- Suspense boundaries and error boundaries go together: every suspending subtree needs a
  fallback *and* an error path.

## Next.js (App Router)

- Components are Server Components by default. `'use client'` marks a boundary: that module
  and everything it imports ship to the browser. Keep the boundary at the leaves.
- Fetch data in Server Components (or `route handlers`), not in client effects. Pass
  serialisable props to client components — no functions, class instances or Dates without a
  plan.
- Mutations: Server Actions (validate input on the server — they are public endpoints),
  then `revalidatePath`/`revalidateTag`. Authorisation checks belong inside the action, not
  only in the page that renders the form.
- Caching and dynamic-rendering defaults changed across major versions; read the docs for
  the installed version before assuming a response is or is not cached.
- `NEXT_PUBLIC_*` variables are inlined into client bundles. Server secrets must never be
  referenced from a client module; `import 'server-only'` in server modules makes a mistake
  fail the build.
- `loading.tsx`/`error.tsx`/`not-found.tsx` give each route segment its non-happy states —
  use them instead of ad-hoc spinners.

## Vue 3 and Nuxt

- Composition API with `<script setup>`. Destructuring `props` or a `reactive()` object loses
  reactivity unless you use `toRefs`/`toRef` (or Vue ≥ 3.5 reactive props destructure).
- `computed` for derived values; `watch`/`watchEffect` only for side effects.
- `v-model` on components: `defineModel()` (3.4+). Emit events up, pass props down; don't
  mutate props.
- `v-html` is XSS for untrusted content.
- Pinia for client state; TanStack Vue Query or Nuxt's `useFetch`/`useAsyncData` for server
  state. In Nuxt, give data fetches stable keys, or two components fetch the same thing
  twice and hydration can mismatch.

## Svelte 5 and SvelteKit

- Runes: `$state` for state, `$derived` for derived values (prefer it — most `$effect`s
  should be `$derived`), `$effect` for real side effects, `$props` for props.
- SvelteKit: `load` functions for data (`+page.server.ts` for anything touching secrets or
  the database), form actions with `use:enhance` for mutations, `invalidate`/`invalidateAll`
  to refresh.
- `{@html}` is XSS for untrusted content.

## Angular

- Standalone components; signals (`signal`, `computed`, `effect`) for local state; `OnPush`
  change detection for anything list-heavy.
- RxJS subscriptions leak unless ended: prefer the `async` pipe or `toSignal`; otherwise
  `takeUntilDestroyed()`.
- Use the Angular CDK for overlays, focus traps, a11y utilities and virtual scroll instead
  of hand-rolling them.
- `bypassSecurityTrust*` disables Angular's sanitiser — treat every use as a security
  review item.

## React Native / Expo

- Lists: `FlatList`/`FlashList` with `keyExtractor`, never `ScrollView` + `map` for long data.
- Accessibility props: `accessibilityLabel`, `accessibilityRole`, `accessibilityState`;
  test with TalkBack and VoiceOver.
- Platform differences (keyboard avoidance, safe areas, back button on Android) need a
  deliberate decision per screen.
- Secrets in the JS bundle are extractable; use secure storage (Keychain/Keystore via
  `expo-secure-store` or equivalent) for tokens.
- Measure on a low-end Android device — it is the reference hardware, not the simulator.

## Astro

- Islands: components are static HTML unless given a `client:*` directive. Choose the least
  eager one that works (`client:visible`, `client:idle` before `client:load`).
- Content collections for typed content; don't fetch at runtime what can be built.
