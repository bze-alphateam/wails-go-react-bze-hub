import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the Wails settings bindings so the hook can be tested without a runtime.
const GetSettings = vi.fn();
const UpdateSetting = vi.fn();
vi.mock("../../wailsjs/go/main/App", () => ({
  GetSettings: (...args: unknown[]) => GetSettings(...args),
  UpdateSetting: (...args: unknown[]) => UpdateSetting(...args),
}));

import { useSectionView, sectionViewKey } from "./useSectionView";

beforeEach(() => {
  GetSettings.mockReset();
  UpdateSetting.mockReset();
  GetSettings.mockResolvedValue({});
  UpdateSetting.mockResolvedValue(undefined);
});

describe("useSectionView", () => {
  it("defaults to simple when nothing is stored", async () => {
    GetSettings.mockResolvedValue({});
    const { result } = renderHook(() => useSectionView("earn"));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.view).toBe("simple");
  });

  it("loads the stored view for the section", async () => {
    GetSettings.mockResolvedValue({ "view.earn": "advanced" });
    const { result } = renderHook(() => useSectionView("earn"));

    await waitFor(() => expect(result.current.view).toBe("advanced"));
    // Only the matching section's key is read.
    expect(result.current.loaded).toBe(true);
  });

  it("ignores an invalid stored value and falls back to the default", async () => {
    GetSettings.mockResolvedValue({ "view.earn": "bogus" });
    const { result } = renderHook(() => useSectionView("earn"));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.view).toBe("simple");
  });

  it("persists an explicit user change via UpdateSetting", async () => {
    GetSettings.mockResolvedValue({});
    const { result } = renderHook(() => useSectionView("earn"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setView("advanced"));

    expect(result.current.view).toBe("advanced");
    expect(UpdateSetting).toHaveBeenCalledWith(sectionViewKey("earn"), "advanced");
    expect(UpdateSetting).toHaveBeenCalledTimes(1);
  });

  it("applies a per-visit override without persisting or reading storage", async () => {
    GetSettings.mockResolvedValue({ "view.earn": "simple" });
    const { result } = renderHook(() => useSectionView("earn", "advanced"));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    // Override wins over the stored "simple" for the visit...
    expect(result.current.view).toBe("advanced");
    // ...and nothing is persisted.
    expect(UpdateSetting).not.toHaveBeenCalled();
  });

  it("persists only when the user flips the tab, even under an override", async () => {
    GetSettings.mockResolvedValue({ "view.earn": "simple" });
    const { result } = renderHook(() => useSectionView("earn", "advanced"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setView("simple"));

    expect(result.current.view).toBe("simple");
    expect(UpdateSetting).toHaveBeenCalledWith(sectionViewKey("earn"), "simple");
  });

  it("keys persistence per section", async () => {
    const { result } = renderHook(() => useSectionView("trade"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setView("advanced"));
    expect(UpdateSetting).toHaveBeenCalledWith("view.trade", "advanced");
  });
});
