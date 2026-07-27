import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithChakra } from "../../../test/render";
import { OpenOrdersSummary } from "./OpenOrdersSummary";

const { useOpenOrdersCount } = vi.hoisted(() => ({ useOpenOrdersCount: vi.fn() }));
vi.mock("../../../hooks/useOpenOrdersCount", () => ({ useOpenOrdersCount }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OpenOrdersSummary", () => {
  it("renders nothing when there are no open orders", () => {
    useOpenOrdersCount.mockReturnValue(0);
    const { container } = renderWithChakra(<OpenOrdersSummary address="bze1a" onGoAdvanced={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count and jumps to Advanced when there are open orders", () => {
    useOpenOrdersCount.mockReturnValue(3);
    const onGoAdvanced = vi.fn();
    renderWithChakra(<OpenOrdersSummary address="bze1a" onGoAdvanced={onGoAdvanced} />);
    expect(screen.getByText(/3 open orders/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View orders" }));
    expect(onGoAdvanced).toHaveBeenCalled();
  });
});
