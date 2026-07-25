import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { renderWithChakra } from "../../test/render";
import { system } from "../../theme";
import { ReceiveModal } from "./ReceiveModal";

const ADDR = "bze1qy352eufqy352eufqy352eufqy352euf7xxxxx";
const ADDR2 = "bze1z2z3z4z5z6z7z8z9zazbzczdzezfzgzhzjzkzz9yyyyy";

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("ReceiveModal", () => {
  it("renders the active address and a QR element when open", () => {
    renderWithChakra(<ReceiveModal isOpen onClose={() => {}} address={ADDR} />);

    expect(screen.getByText(ADDR)).toBeInTheDocument();
    expect(screen.getByTestId("receive-qr")).toBeInTheDocument();
    // The QR is an accessible SVG labelled for screen readers.
    expect(screen.getByTestId("receive-qr").tagName.toLowerCase()).toBe("svg");
  });

  it("copies exactly the shown address to the clipboard, with feedback", async () => {
    renderWithChakra(<ReceiveModal isOpen onClose={() => {}} address={ADDR} />);

    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ADDR);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument()
    );
  });

  it("updates the shown address and QR when the active account changes", () => {
    const { rerender } = renderWithChakra(
      <ReceiveModal isOpen onClose={() => {}} address={ADDR} />
    );
    expect(screen.getByText(ADDR)).toBeInTheDocument();

    rerender(
      <ChakraProvider value={system}>
        <ReceiveModal isOpen onClose={() => {}} address={ADDR2} />
      </ChakraProvider>
    );

    expect(screen.getByText(ADDR2)).toBeInTheDocument();
    expect(screen.queryByText(ADDR)).not.toBeInTheDocument();
    // Copy now targets the new address.
    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));
    expect(writeText).toHaveBeenCalledWith(ADDR2);
  });

  it("does not render its content when closed", () => {
    renderWithChakra(<ReceiveModal isOpen={false} onClose={() => {}} address={ADDR} />);
    expect(screen.queryByTestId("receive-qr")).not.toBeInTheDocument();
    expect(screen.queryByText(ADDR)).not.toBeInTheDocument();
  });
});
