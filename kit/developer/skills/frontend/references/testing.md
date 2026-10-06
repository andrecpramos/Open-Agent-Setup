# Frontend testing

## What to test

Test behaviour a user or a caller can observe: what is rendered for each state, what happens
on interaction, what is sent to the network, what is announced. Do not test framework
internals, class names or the shape of internal state.

| Level | Tool (use what the project has) | Good for |
|---|---|---|
| Component / integration | Testing Library + Vitest/Jest, Vue Test Utils, Angular TestBed | states, interactions, forms, error mapping |
| Network boundary | MSW (Mock Service Worker) or the project's fetch mock | realistic success, error, slow and empty responses |
| End to end | Playwright, Cypress | the critical user journeys, auth, routing, real browser behaviour |
| Visual | Playwright screenshots, Chromatic, Percy | design-system components and key screens |
| Accessibility | axe in component and e2e tests | names, roles, contrast |

## Testing Library, done right

- Query priority: `getByRole` (with `name`) → `getByLabelText` → `getByPlaceholderText` →
  `getByText` → `getByDisplayValue` → `getByAltText`/`getByTitle` → `getByTestId` (last
  resort, for things with no accessible handle).
- `userEvent` (with `await`) over `fireEvent` — it simulates the full event sequence a user
  produces.
- `findBy…` / `waitFor` for anything async; never arbitrary timeouts.
- An `act()` warning means an update happened after the test stopped looking — await the
  thing that causes it instead of silencing the warning.
- Render with the real providers (router, query client with retries off, i18n, theme) via a
  shared `renderWithProviders` helper; tests that stub providers away test a different app.

## The states to cover for an async view

1. Loading → skeleton or spinner is shown.
2. Success → data is rendered.
3. Empty → the empty state (with its call to action).
4. Error → message plus a working retry.
5. For search/filter inputs: the stale-response race — respond to the older request last
   and assert the newer results are shown.

## Forms

- Submitting invalid input shows the errors and focuses the first invalid field.
- A server-side validation error (422 with field errors) marks the right field.
- The submit control is disabled (or ignores clicks) while pending; a second click sends
  nothing.
- A failed submit keeps the user's input.

## Playwright

- Locate by role and name (`page.getByRole('button', { name: 'Save' })`), never by CSS
  structure.
- Rely on auto-waiting assertions (`await expect(locator).toBeVisible()`); no `waitForTimeout`.
- Isolate state: each test creates what it needs (API seeding or fixtures); never depend on
  test order.
- Keep traces/screenshots on failure (`trace: 'retain-on-failure'`) — they make CI failures
  debuggable.
- Headless browsers inherit OS preferences such as the dark colour scheme on some machines;
  set `colorScheme` explicitly when a test depends on it.

## Flakiness

A flaky test is a bug in the test or the app — usually an un-awaited async step, shared
state between tests, time-dependent logic without a fake clock, or animation timing. Fix the
cause; retries that turn it green hide a real intermittent failure.
