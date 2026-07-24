import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithChakra } from "../test/render";
import { TabBar } from "./TabBar";
import { SECTIONS } from "../sections";

function setup(overrides: Partial<Parameters<typeof TabBar>[0]> = {}) {
  const props = {
    activeTab: "dashboard" as const,
    onTabChange: vi.fn(),
    onRefresh: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  // No account props → WalletMenu (and its Wails bindings) stay unmounted.
  renderWithChakra(<TabBar {...props} />);
  return props;
}

describe("TabBar", () => {
  it("renders a button for every section", () => {
    setup();
    for (const section of SECTIONS) {
      expect(
        screen.getByRole("button", { name: section.label })
      ).toBeInTheDocument();
    }
    // Sanity: the full six-section nav, not the old two-tab bar.
    expect(SECTIONS).toHaveLength(6);
  });

  it("renders the Settings gear and Refresh control", () => {
    setup();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("calls onTabChange with the section id when a section is clicked", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Trade" }));
    expect(props.onTabChange).toHaveBeenCalledTimes(1);
    expect(props.onTabChange).toHaveBeenCalledWith("trade");
  });

  it("calls onOpenSettings when the gear is clicked", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("calls onRefresh when the refresh control is clicked", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });
});
