import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithChakra } from "../test/render";
import { SectionTabs } from "./SectionTabs";

describe("SectionTabs", () => {
  it("renders a Simple and an Advanced tab", () => {
    renderWithChakra(
      <SectionTabs section="earn" value="simple" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("tab", { name: "simple" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "advanced" })).toBeInTheDocument();
  });

  it("marks the active view as selected", () => {
    renderWithChakra(
      <SectionTabs section="earn" value="advanced" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("tab", { name: "advanced" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "simple" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("calls onChange with the clicked view", () => {
    const onChange = vi.fn();
    renderWithChakra(
      <SectionTabs section="earn" value="simple" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "advanced" }));
    expect(onChange).toHaveBeenCalledWith("advanced");
  });
});
