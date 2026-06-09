import { useEffect, useRef } from "react";
import {
  Toaster as ChakraToaster,
  Toast,
  Portal,
  Spinner,
  Stack,
  HStack,
  Box,
  Button,
} from "@chakra-ui/react";
import {
  LuCircleCheck,
  LuCircleX,
  LuTriangleAlert,
  LuInfo,
  LuExternalLink,
  LuX,
} from "react-icons/lu";
import type { Options as ToastOptions } from "@zag-js/toast";
import { toaster, type NotificationMeta, type NotifyAction } from "./toaster";

/**
 * The single render surface for every notification. Mounted once at the app root
 * (main.tsx); driven entirely by the `toaster` store, so nothing else needs to
 * know it exists. Visuals are ours — the store only supplies data.
 */

// react-icons return JSX; cast keeps TS happy inside Chakra children.
const ICON: Record<string, (p: { size?: number }) => unknown> = {
  success: LuCircleCheck,
  error: LuCircleX,
  warning: LuTriangleAlert,
  info: LuInfo,
};

// colorPalette per type → semantic accent (works in light & dark).
const ACCENT: Record<string, string> = {
  success: "green",
  error: "red",
  warning: "orange",
  info: "blue",
  loading: "teal",
};

export function NotificationToaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster}>
        {(toast: ToastOptions<React.ReactNode>) => {
          const type = (toast.type as string) || "info";
          const meta = (toast.meta ?? {}) as NotificationMeta;
          const accent = ACCENT[type] ?? "gray";
          const Glyph = ICON[type];

          // Settled toasts auto-dismiss after a finite duration → show the
          // countdown bar. Loading toasts are persistent (no duration) → none.
          const duration = toast.duration;
          const showCountdown =
            type !== "loading" &&
            typeof duration === "number" &&
            isFinite(duration) &&
            duration > 0;

          return (
            <Toast.Root
              colorPalette={accent}
              width={{ base: "full", sm: "sm" }}
              bg="bg.panel"
              color="fg"
              borderWidth="1px"
              borderColor="border.subtle"
              borderLeftWidth="3px"
              borderLeftColor="colorPalette.solid"
              borderRadius="l2"
              boxShadow="md"
              p="3"
              display="flex"
              gap="3"
              alignItems="flex-start"
              position="relative"
              overflow="hidden"
            >
              {/* Indicator */}
              <Box color="colorPalette.solid" mt="0.5" flexShrink="0">
                {type === "loading" ? (
                  <Spinner size="sm" color="colorPalette.solid" />
                ) : Glyph ? (
                  (Glyph({ size: 18 }) as React.ReactNode)
                ) : null}
              </Box>

              {/* Body */}
              <Stack gap="1" flex="1" minW="0">
                {toast.title && (
                  <Toast.Title fontSize="sm" fontWeight="semibold" lineClamp={2}>
                    {toast.title}
                  </Toast.Title>
                )}
                {toast.description && (
                  <Toast.Description fontSize="xs" color="fg.muted" lineClamp={4}>
                    {toast.description}
                  </Toast.Description>
                )}

                {/* Determinate progress (loading toast with meta.progress) */}
                {type === "loading" && typeof meta.progress === "number" && (
                  <Box
                    mt="1"
                    h="1.5"
                    w="full"
                    bg="bg.muted"
                    borderRadius="full"
                    overflow="hidden"
                  >
                    <Box
                      h="full"
                      bg="colorPalette.solid"
                      borderRadius="full"
                      transition="width 0.2s ease"
                      width={`${Math.max(0, Math.min(1, meta.progress)) * 100}%`}
                    />
                  </Box>
                )}

                {/* Actions */}
                {meta.actions && meta.actions.length > 0 && (
                  <HStack gap="2" mt="1" wrap="wrap">
                    {meta.actions.map((action, i) => (
                      <ActionButton key={i} action={action} accent={accent} />
                    ))}
                  </HStack>
                )}
              </Stack>

              {/* Auto-dismiss countdown bar (pauses on hover, in sync with the
                  store's own dismiss timer which also pauses on hover). */}
              {showCountdown && (
                <CountdownBar key={`cd-${toast.id}-${duration}`} durationMs={duration as number} />
              )}

              {/* Close */}
              <Toast.CloseTrigger asChild>
                <Box
                  as="button"
                  color="fg.muted"
                  _hover={{ color: "fg" }}
                  flexShrink="0"
                  aria-label="Dismiss notification"
                >
                  {LuX({ size: 14 }) as React.ReactNode}
                </Box>
              </Toast.CloseTrigger>
            </Toast.Root>
          );
        }}
      </ChakraToaster>
    </Portal>
  );
}

/**
 * Auto-dismiss countdown shown along the toast's bottom edge.
 *
 * Driven by requestAnimationFrame tracking *accumulated elapsed time* (not a CSS
 * animation), so it can never visually "restart": pausing simply stops
 * accumulating. It pauses while the pointer is over the toast — the same gesture
 * that pauses the store's real dismiss timer (verified: the store preserves
 * remaining time on hover and resumes from it), so the bar and the actual timer
 * stay in lockstep. A CSS `animation-play-state` toggled via an ancestor attribute
 * was avoided because WebKit (the Wails webview) can repaint it as a restart.
 */
function CountdownBar({ durationMs }: { durationMs: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || durationMs <= 0) return;
    const root = el.parentElement; // the Toast.Root
    let raf = 0;
    let start = performance.now();
    let elapsedBeforePause = 0;
    let paused = false;

    const tick = (now: number) => {
      if (!paused) {
        const elapsed = elapsedBeforePause + (now - start);
        const frac = Math.max(0, 1 - elapsed / durationMs);
        el.style.transform = `scaleX(${frac})`;
        if (frac <= 0) return; // done — stop the loop
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onEnter = () => {
      if (!paused) {
        elapsedBeforePause += performance.now() - start;
        paused = true;
      }
    };
    const onLeave = () => {
      if (paused) {
        start = performance.now();
        paused = false;
      }
    };
    root?.addEventListener("pointerenter", onEnter);
    root?.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      root?.removeEventListener("pointerenter", onEnter);
      root?.removeEventListener("pointerleave", onLeave);
    };
  }, [durationMs]);

  return (
    <Box
      ref={ref}
      position="absolute"
      bottom="0"
      insetInline="0"
      height="2px"
      bg="colorPalette.solid"
      opacity="0.35"
      transformOrigin="left"
      style={{ transform: "scaleX(1)" }}
    />
  );
}

function ActionButton({
  action,
  accent,
}: {
  action: NotifyAction;
  accent: string;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      colorPalette={accent}
      onClick={action.onClick}
    >
      {action.external && (LuExternalLink({ size: 12 }) as React.ReactNode)}
      {action.label}
    </Button>
  );
}
