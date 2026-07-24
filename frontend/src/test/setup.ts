import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees between tests so they don't leak into one another.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement these browser APIs that Chakra UI touches; stub them
// so components render without throwing.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

// Chakra's clipboard/scroll helpers are occasionally invoked in interactions.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
}
