import { createToaster } from "@chakra-ui/react";

/**
 * App-wide notification backbone.
 *
 * A thin, typed wrapper over Chakra v3's `createToaster` (a framework-agnostic
 * store). We own the *API* (`notify`) and the *visuals* (NotificationToaster),
 * and let the proven store handle stacking, timers, pause-on-hover, exit
 * animations and the a11y live region.
 *
 * Because the store is a singleton, `notify` can be called from anywhere — hooks,
 * event handlers, even non-React code — without any context/provider plumbing.
 * Mount <NotificationToaster /> once (see main.tsx) to render whatever is fired.
 */

/** Severity of a settled (non-loading) notification. */
export type NotifySeverity = "success" | "error" | "warning" | "info";

/** A button rendered inside a notification (e.g. "Open in explorer"). */
export interface NotifyAction {
  label: string;
  onClick: () => void;
  /** Show an external-link glyph (the action leaves the app, e.g. opens a browser). */
  external?: boolean;
}

/**
 * Extra data carried on a toast under `meta`. The renderer reads this to draw
 * action buttons and the determinate progress bar.
 */
export interface NotificationMeta {
  actions?: NotifyAction[];
  /** 0..1 determinate progress for a loading toast; omit for an indeterminate spinner. */
  progress?: number;
}

/** Options accepted by every `notify.*` call. */
export interface NotifyOptions {
  title: string;
  description?: string;
  actions?: NotifyAction[];
  /**
   * Auto-dismiss delay in ms. Defaults per severity. Pass `Infinity` to keep the
   * toast until it is dismissed by the user or in code.
   */
  duration?: number;
}

/** Options for a loading toast (persistent until resolved). */
export interface LoadingOptions {
  title: string;
  description?: string;
  /** Optional determinate progress 0..1. Omit for an indeterminate spinner. */
  progress?: number;
}

/** Patch applied to a live loading toast via `handle.update(...)`. */
export interface LoadingPatch {
  title?: string;
  description?: string;
  progress?: number;
}

/**
 * Handle to a live loading toast. The caller owns the async work and resolves
 * the handle when it settles — the notification never drives the operation.
 */
export interface LoadingHandle {
  readonly id: string;
  /** Update the in-flight toast (e.g. advance progress). */
  update(patch: LoadingPatch): void;
  /** Transition to a success toast. */
  success(opts: NotifyOptions): void;
  /** Transition to an error toast. */
  error(opts: NotifyOptions): void;
  /** Transition to an info toast. */
  info(opts: NotifyOptions): void;
  /** Transition to a warning toast. */
  warning(opts: NotifyOptions): void;
  /** Dismiss without a settled state. */
  dismiss(): void;
}

/**
 * Default auto-dismiss for settled toasts (ms). A single 15s window keeps things
 * predictable; the border countdown bar shows the time remaining and pauses on
 * hover. Pass `duration` to override, or `Infinity` to keep a toast until dismissed.
 */
export const DEFAULT_DURATION = 15000;

/** The singleton store. Bottom-right, stacked, newest on top, capped at 4. */
export const toaster = createToaster({
  placement: "bottom-end",
  overlap: false,
  gap: 12,
  max: 4,
  offsets: "16px",
});

function emit(type: NotifySeverity, opts: NotifyOptions): string {
  return toaster.create({
    type,
    title: opts.title,
    description: opts.description,
    duration: opts.duration ?? DEFAULT_DURATION,
    meta: { actions: opts.actions } satisfies NotificationMeta,
  });
}

/**
 * Fire notifications from anywhere.
 *
 * @example
 *   notify.success({ title: "Saved" });
 *   notify.error({ title: "Failed", description: err.message });
 *
 *   // async lifecycle — the caller resolves the handle:
 *   const h = notify.loading({ title: "Broadcasting…" });
 *   try { const r = await doWork(); h.success({ title: "Done", actions: [...] }); }
 *   catch (e) { h.error({ title: "Failed", description: String(e) }); }
 *
 *   // or let promise() wire it:
 *   notify.promise(doWork(), {
 *     loading: { title: "Broadcasting…" },
 *     success: (r) => ({ title: "Done" }),
 *     error:   (e) => ({ title: "Failed", description: String(e) }),
 *   });
 */
export const notify = {
  success: (opts: NotifyOptions) => emit("success", opts),
  error: (opts: NotifyOptions) => emit("error", opts),
  warning: (opts: NotifyOptions) => emit("warning", opts),
  info: (opts: NotifyOptions) => emit("info", opts),

  /** Create a persistent loading toast and return a handle to resolve it. */
  loading(opts: LoadingOptions): LoadingHandle {
    const id = toaster.create({
      type: "loading",
      title: opts.title,
      description: opts.description,
      meta: { progress: opts.progress } satisfies NotificationMeta,
    });

    const resolve = (type: NotifySeverity, o: NotifyOptions) =>
      toaster.update(id, {
        type,
        title: o.title,
        description: o.description,
        duration: o.duration ?? DEFAULT_DURATION,
        meta: { actions: o.actions } satisfies NotificationMeta,
      });

    return {
      id,
      update(patch: LoadingPatch) {
        toaster.update(id, {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.progress !== undefined
            ? { meta: { progress: patch.progress } satisfies NotificationMeta }
            : {}),
        });
      },
      success: (o) => resolve("success", o),
      error: (o) => resolve("error", o),
      info: (o) => resolve("info", o),
      warning: (o) => resolve("warning", o),
      dismiss: () => toaster.dismiss(id),
    };
  },

  /**
   * Track a promise: shows `loading`, then resolves to `success`/`error`. The
   * success/error options may be computed from the resolved value / thrown error.
   */
  promise<T>(
    promise: Promise<T>,
    opts: {
      loading: LoadingOptions;
      success: (value: T) => NotifyOptions;
      error: (err: unknown) => NotifyOptions;
    }
  ): Promise<T> {
    const handle = notify.loading(opts.loading);
    return promise.then(
      (value) => {
        handle.success(opts.success(value));
        return value;
      },
      (err) => {
        handle.error(opts.error(err));
        throw err;
      }
    );
  },

  /** Dismiss a specific toast, or all toasts when no id is given. */
  dismiss: (id?: string) => toaster.dismiss(id),
};
