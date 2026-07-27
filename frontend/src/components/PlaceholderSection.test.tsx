import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { LuFlame } from "react-icons/lu";
import { renderWithChakra } from "../test/render";
import { PlaceholderSection } from "./PlaceholderSection";
import { PLACEHOLDER_SECTIONS } from "../sections";

describe("PlaceholderSection", () => {
  it("shows the section label and its milestone", () => {
    renderWithChakra(
      <PlaceholderSection id="burner" label="Burner" milestone="M5" icon={LuFlame} />
    );
    expect(screen.getByText("Burner")).toBeInTheDocument();
    expect(screen.getByText(/Coming in M5/)).toBeInTheDocument();
  });

  it("every placeholder section carries a milestone to display", () => {
    // Guards the business rule: placeholders must name their milestone.
    for (const section of PLACEHOLDER_SECTIONS) {
      expect(section.milestone).toBeTruthy();
    }
    // Trade went live in M2 (BHUB-23 swap card), so it's no longer a placeholder.
    expect(PLACEHOLDER_SECTIONS.map((s) => s.id)).toEqual([
      "burner",
      "create",
    ]);
  });
});
