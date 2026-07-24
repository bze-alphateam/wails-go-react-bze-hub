import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";

/**
 * Render a component inside the app's Chakra provider (same `system` as
 * `main.tsx`), so theme tokens and `colorPalette` styling resolve in tests.
 */
export function renderWithChakra(ui: ReactElement) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}
