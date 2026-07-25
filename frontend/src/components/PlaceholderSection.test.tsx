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
    expect(PLACEHOLDER_SECTIONS.map((s) => s.id)).toEqual([
      "trade",
      "burner",
      "create",
    ]);
  });
});
