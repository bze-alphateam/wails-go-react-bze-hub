import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Chakra store so we can assert exactly what the wrapper forwards.
// vi.hoisted keeps the spies available inside the hoisted vi.mock factory.
const store = vi.hoisted(() => {
  let n = 0;
  return {
    create: vi.fn((_options: any) => `id-${++n}`),
    update: vi.fn((id: string, _options?: any) => id),
    dismiss: vi.fn((_id?: string) => {}),
    reset() {
      n = 0;
      this.create.mockClear();
      this.update.mockClear();
      this.dismiss.mockClear();
    },
  };
});

vi.mock("@chakra-ui/react", () => ({
  createToaster: () => ({
    create: store.create,
    update: store.update,
    dismiss: store.dismiss,
  }),
}));

import { notify } from "./toaster";

beforeEach(() => store.reset());

describe("notify settled toasts", () => {
  it("success uses type=success and the 15s default duration", () => {
    notify.success({ title: "Saved" });
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Saved", duration: 15000 })
    );
  });

  it("error uses the 15s default and carries the description", () => {
    notify.error({ title: "Boom", description: "stack trace" });
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", description: "stack trace", duration: 15000 })
    );
  });

  it("an explicit duration overrides the per-severity default", () => {
    notify.info({ title: "FYI", duration: 1234 });
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 1234 })
    );
  });

  it("actions are passed through under meta", () => {
    const onClick = vi.fn();
    notify.success({ title: "Done", actions: [{ label: "Open", onClick, external: true }] });
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { actions: [{ label: "Open", onClick, external: true }] },
      })
    );
  });
});

describe("notify.loading handle", () => {
  it("creates a persistent loading toast (no duration) and returns its id", () => {
    const h = notify.loading({ title: "Working…" });
    expect(h.id).toBe("id-1");
    const arg = store.create.mock.calls[0][0];
    expect(arg.type).toBe("loading");
    expect(arg.duration).toBeUndefined(); // persistent until resolved
  });

  it("success() updates the same toast with type=success + actions + default duration", () => {
    const h = notify.loading({ title: "Working…" });
    h.success({ title: "Done", actions: [{ label: "View", onClick: () => {} }] });
    expect(store.update).toHaveBeenCalledWith(
      "id-1",
      expect.objectContaining({
        type: "success",
        title: "Done",
        duration: 15000,
        meta: { actions: [{ label: "View", onClick: expect.any(Function) }] },
      })
    );
  });

  it("error() updates the same toast with type=error", () => {
    const h = notify.loading({ title: "Working…" });
    h.error({ title: "Failed", description: "raw_log" });
    expect(store.update).toHaveBeenCalledWith(
      "id-1",
      expect.objectContaining({ type: "error", description: "raw_log", duration: 15000 })
    );
  });

  it("update({progress}) patches only meta.progress", () => {
    const h = notify.loading({ title: "Working…" });
    h.update({ progress: 0.5 });
    expect(store.update).toHaveBeenCalledWith("id-1", { meta: { progress: 0.5 } });
  });

  it("update({title}) patches only the title, not meta", () => {
    const h = notify.loading({ title: "Working…" });
    h.update({ title: "Still working…" });
    expect(store.update).toHaveBeenCalledWith("id-1", { title: "Still working…" });
  });

  it("dismiss() dismisses by id", () => {
    const h = notify.loading({ title: "Working…" });
    h.dismiss();
    expect(store.dismiss).toHaveBeenCalledWith("id-1");
  });
});

describe("notify.promise", () => {
  it("resolves to success and returns the value", async () => {
    const value = await notify.promise(Promise.resolve(42), {
      loading: { title: "Loading…" },
      success: (v) => ({ title: `Got ${v}` }),
      error: () => ({ title: "nope" }),
    });
    expect(value).toBe(42);
    expect(store.update).toHaveBeenCalledWith(
      "id-1",
      expect.objectContaining({ type: "success", title: "Got 42" })
    );
  });

  it("resolves to error and re-throws", async () => {
    const boom = new Error("kaboom");
    await expect(
      notify.promise(Promise.reject(boom), {
        loading: { title: "Loading…" },
        success: () => ({ title: "ok" }),
        error: (e) => ({ title: "Failed", description: String(e) }),
      })
    ).rejects.toThrow("kaboom");
    expect(store.update).toHaveBeenCalledWith(
      "id-1",
      expect.objectContaining({ type: "error", title: "Failed" })
    );
  });
});
