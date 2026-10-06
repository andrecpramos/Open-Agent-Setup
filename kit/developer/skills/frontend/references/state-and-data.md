# State and data

## Contents

1. Choosing the owner of a piece of state
2. Server state by framework
3. Races, cancellation and stale responses
4. Mutations: invalidation, optimistic updates, rollback
5. URL state
6. Forms
7. Global client state — the small legitimate slice

## 1 · Choosing the owner

Ask in order; stop at the first yes.

1. **Does it live on the server?** → the data layer. Never a copy in `useState` or a store.
2. **Would a user expect it to survive refresh, back/forward, or a shared link?** → the URL.
3. **Is it the in-progress value of a form?** → the form.
4. **Can it be computed from things you already have?** → compute it during render. If the
   computation is genuinely expensive (measured), memoise it — still not state.
5. **Is it needed by distant components and none of the above?** → a small client store.
6. **Otherwise** → local component state.

The failure this ordering prevents: state that has two owners. Two owners disagree after the
first update, and the bug report is "sometimes it shows the old value".

## 2 · Server state by framework

| Stack | Read | Write |
|---|---|---|
| React + TanStack Query | `useQuery({ queryKey: ['orders', filters], queryFn })` | `useMutation` + `queryClient.invalidateQueries({ queryKey: ['orders'] })` |
| React + SWR | `useSWR(key, fetcher)` | `mutate(key)` after the write |
| Redux Toolkit | RTK Query endpoints with `providesTags` | mutations with `invalidatesTags` |
| Next.js App Router | fetch in a Server Component; pass data down | Server Action + `revalidatePath`/`revalidateTag`, or a route handler |
| React Router / Remix | `loader` + `useLoaderData` | `action` + `<Form>`; revalidation is automatic |
| SvelteKit | `load` in `+page(.server).ts` | form actions + `use:enhance`; `invalidate()` |
| Nuxt | `useFetch` / `useAsyncData` with a stable key | `$fetch` then `refresh()` / `refreshNuxtData(key)` |
| Vue (SPA) | TanStack Vue Query | same pattern as React Query |
| Angular | `HttpClient` + `async` pipe, or signals via `toSignal`/`resource` | service method + refetch; unsubscribe via `takeUntilDestroyed` |

Rules that hold everywhere:

- **The query key contains every input the request depends on.** A key of `['products']` for
  a request that also uses `search` returns cached results for the wrong search.
- **Loading and fetching are different.** First load shows a skeleton; a background refetch
  keeps the old data on screen with a subtle indicator. Replacing content with a spinner on
  every refetch is flicker.
- **Errors are data.** Render them with a retry, don't throw them into the console.
- **Caching semantics differ by framework version** (Next.js changed its fetch caching
  defaults between majors). Check the installed version's docs before relying on a default.

## 3 · Races, cancellation and stale responses

The classic bug: the user types "ab", the request for "a" is slow, the request for "ab" is
fast, "a" lands last and overwrites the correct results.

- A query library keyed by the input solves it: results are stored per key and the view
  reads the current key.
- Hand-rolled (only when there is no data layer): use an `AbortController` per request and
  abort the previous one in the effect cleanup, or keep a request counter and ignore any
  response that is not the latest.
- Debounce free-text search inputs (≈250–300 ms) — it reduces load; it does *not* fix the
  race on its own.

```ts
useEffect(() => {
  const ctrl = new AbortController();
  fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
    .then((r) => r.json())
    .then(setResults)
    .catch((e) => { if (e.name !== 'AbortError') setError(e); });
  return () => ctrl.abort();
}, [q]);
```

## 4 · Mutations

1. Disable the trigger and show pending state while in flight.
2. On success, **invalidate every query whose data the write changed** — list, detail,
   counts, anything aggregated. Missing one is the "stale data after saving" bug.
3. On error, keep the user's input, show the error next to what caused it, and offer retry.
4. **Optimistic updates** only when the success rate is very high and the change is cheap
   to reverse. Snapshot the cache before, apply the change, roll back to the snapshot on
   error, and always refetch on settle so the cache converges on the server's truth.
5. For anything that must not happen twice (payments, account creation), the button state
   is a courtesy — the real protection is an idempotency key on the server (see `api-design`).

## 5 · URL state

Filters, sort, pagination, tabs and selected items belong in the URL: they survive refresh,
work with back/forward, and can be shared. Read from the router (`useSearchParams`, route
params, a typed helper such as `nuqs` if the project has it), and **treat the URL as the
single source** — do not mirror it into component state.

- Validate and default URL params — they are user input.
- Use `replace` rather than `push` for keystroke-level changes, so the history stays usable.

## 6 · Forms

- Use the project's form approach (React Hook Form, Formik, VeeValidate, framework actions);
  don't introduce a second one.
- **One schema for both sides** where the stack allows it (zod/valibot shared between client
  and server). Client validation is UX; server validation is the rule.
- Validate on blur and on submit; show an error only after the user has interacted.
- **Map server errors to fields.** A 422 with field errors should mark those fields
  (`aria-invalid`, message linked via `aria-describedby`); a generic error goes to a
  form-level alert (`role="alert"`) and focus moves to it.
- Never clear the form on a failed submit. Keep the submit button's label stable and show
  pending state inside it, so the layout does not jump.
- Autocomplete attributes (`autocomplete="email"`, `new-password`, `one-time-code`) and the
  right `type`/`inputmode` are free usability — and password managers depend on them.

## 7 · Global client state

Legitimate uses are few: the current user/session shell, UI preferences, a multi-step
wizard's draft, a cart that is genuinely client-side. Use whatever the project already has
(Zustand, Jotai, Redux, Pinia, NgRx, a context). Keep it small, never mirror server data into
it, and select narrowly so an update does not re-render the whole tree.
