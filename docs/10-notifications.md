# 10 — Notifications

The notification system is the app-wide backbone for transient user feedback:
"transaction submitted", "copied", "node fell behind", progress on a long action,
etc. It is designed to be **fired from anywhere** in the frontend and **extended
without touching the call sites**.

## Design in one line

A thin, typed wrapper (`notify`) over Chakra v3's `createToaster` store, with our
own render component. **We own the API and the visuals; the proven store owns the
plumbing** (stacking, auto-dismiss timers, pause-on-hover, exit animations, the
a11y live region, promise lifecycle). We deliberately did **not** hand-roll a store
— timers/stacking/a11y are exactly the parts that are easy to get subtly wrong.

## Files

| File | Responsibility |
|------|----------------|
| `frontend/src/notifications/toaster.ts` | The singleton store + the typed `notify` API + the `NotificationMeta`/handle types. |
| `frontend/src/notifications/NotificationToaster.tsx` | The single render surface (icon, title/description, progress bar, action buttons, close). |
| `frontend/src/notifications/index.ts` | Barrel — import `{ notify }` from here. |
| `frontend/src/notifications/toaster.test.ts` | Unit tests for the wrapper logic (durations, meta shaping, loading→resolve, promise). |

`<NotificationToaster />` is mounted **once** at the app root (`main.tsx`), inside
`ChakraProvider`. Because the store is a module-level singleton, `notify` works
from anywhere — hooks, event handlers, even non-React code — with **no context or
prop-drilling**.

## Position & lifetime

**Bottom-right**, stacked upward, newest on top, capped at 4. Chosen because the app
has a TabBar on top and a StatusBar on the bottom; bottom-end with a 16px offset
keeps toasts clear of both and is the conventional desktop/dapp spot. Configured in
one place (`createToaster({ placement: "bottom-end", … })`).

**Auto-dismiss: 15s default** for settled toasts (`DEFAULT_DURATION` in
`toaster.ts`); loading toasts are persistent. Each auto-dismissing toast shows a
**countdown bar** along its bottom edge that shrinks left→right over the duration,
so the user can see it's about to disappear (`CountdownBar` in
`NotificationToaster.tsx`).

**Hovering pauses both** the dismiss timer and the bar. The store pauses its own
dismiss timer on hover and *preserves the remaining time* (it subtracts elapsed and
resumes from the remainder — it does not reset). The bar is driven by
`requestAnimationFrame` tracking **accumulated elapsed time**, and pauses on the
same `pointerenter`/`pointerleave` of the toast — so it stays in lockstep with the
real timer and can never visually "restart". (A CSS `animation-play-state` toggled
via an ancestor `[data-paused]` attribute was tried first but WebKit — the Wails
webview — can repaint that as a restart, so the rAF approach is used instead.)

## Types of notifications

Five severities — the complete, sufficient set:

| Type | Use | Default auto-dismiss |
|------|-----|----------------------|
| `success` | an action completed | 15s |
| `info` | neutral FYI | 15s |
| `warning` | something needs attention but isn't an error | 15s |
| `error` | an action failed | 15s |
| `loading` | an async action in flight | persistent until resolved |

Links and progress are **not** separate types:

- **Links / buttons** are a generic `actions: { label, onClick, external? }[]`. An
  explorer link is just `{ label: "Open in explorer", external: true, onClick: () => OpenURL(url) }`.
- **Progress** is an optional `progress?: 0..1` on a loading toast → renders a
  determinate bar; omit it for an indeterminate spinner.

## API

```ts
import { notify } from "../notifications";

// Settled toasts:
notify.success({ title, description?, actions?, duration? });
notify.error(...); notify.warning(...); notify.info(...);

// Async lifecycle — the CALLER owns the work and resolves the handle:
const h = notify.loading({ title: "Broadcasting…", progress? });
h.update({ description?, progress? });   // e.g. advance the bar
h.success({ title, actions? });          // or h.error(...) / h.warning(...) / h.info(...)
h.dismiss();

// Convenience for the common case — wires loading→success/error automatically:
await notify.promise(somePromise, {
  loading: { title: "Broadcasting…" },
  success: (value) => ({ title: "Done" }),
  error:   (err)   => ({ title: "Failed", description: String(err) }),
});

notify.dismiss(id?);  // one toast, or all when no id
```

### Why caller-driven, not a self-running progress + callback

A long-action notification reflects the operation; it must never **drive** it. The
caller owns the async work and resolves the handle (`h.success()` / `h.error()`),
which (1) decouples the UI from business logic, (2) handles failure naturally, and
(3) lets `notify.promise()` wire the common case in one call. A self-running bar
that fires a callback on completion is only right for a purely time-based UX (e.g.
"Undo (5s)") — and that is already expressible as a normal toast with an `action`
and a `duration`, so no special mechanism is needed. Determinate progress you *do*
know (uploads, multi-step flows) is supported via `h.update({ progress })`.

## Extending

- **New visual treatment** → edit `NotificationToaster.tsx` only; the API is
  unchanged.
- **New carried data** (e.g. an avatar, a category) → add a field to
  `NotificationMeta` in `toaster.ts` and render it. Call sites that don't set it are
  unaffected.
- **New call site** → `import { notify }` and fire. Nothing to register.

## Consumers

- **Staking** (`useStakingTx`) — every broadcast: `notify.loading` → success (with
  the explorer action) or error (with the chain `raw_log`). See
  [09-staking.md](09-staking.md).

## Testing

Pure-logic Vitest (`toaster.test.ts`) mocks `@chakra-ui/react`'s `createToaster`
and asserts what the wrapper forwards: the 15s default duration, `duration`
override, actions placed under `meta`, the loading→`success`/`error` transition
reusing the same toast id, `update({progress})` patching only `meta.progress`, and
`notify.promise` resolving/rejecting correctly. Rendering/animations (incl. the
countdown bar) are Chakra/CSS concerns and are not re-tested here.
