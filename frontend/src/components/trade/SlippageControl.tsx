import { useEffect, useState } from "react";
import { Box, HStack, Text, Button, Input } from "@chakra-ui/react";
import {
  SLIPPAGE_PRESETS,
  isValidSlippage,
  sanitizeAmountInput,
} from "./swapHelpers";

interface SlippageControlProps {
  /** Current slippage tolerance, in percent. */
  slippage: number;
  onChange: (value: number) => void;
}

function isPreset(value: number): boolean {
  return (SLIPPAGE_PRESETS as readonly number[]).includes(value);
}

/**
 * Slippage tolerance control: the preset buttons (0.5 / 1 / 2 %) plus a custom
 * field accepting any value in 0–50%. The active preset is highlighted; a custom
 * value clears the preset highlight. Persistence is the caller's concern
 * (`useSwapSlippage`).
 */
export function SlippageControl({ slippage, onChange }: SlippageControlProps) {
  const [custom, setCustom] = useState(isPreset(slippage) ? "" : String(slippage));

  // Clear the custom field when a preset becomes active (e.g. via a preset click).
  useEffect(() => {
    if (isPreset(slippage)) setCustom("");
  }, [slippage]);

  const handleCustom = (raw: string) => {
    const value = sanitizeAmountInput(raw);
    setCustom(value);
    if (value !== "" && isValidSlippage(value)) {
      onChange(parseFloat(value));
    }
  };

  return (
    <Box>
      <Text fontSize="xs" color="fg.muted" mb="2">
        Slippage tolerance
      </Text>
      <HStack gap="2" wrap="wrap">
        {SLIPPAGE_PRESETS.map((preset) => {
          const active = custom === "" && slippage === preset;
          return (
            <Button
              key={preset}
              size="xs"
              variant={active ? "solid" : "outline"}
              colorPalette="blue"
              onClick={() => {
                setCustom("");
                onChange(preset);
              }}
              aria-pressed={active}
            >
              {preset}%
            </Button>
          );
        })}
        <HStack gap="1">
          <Input
            size="xs"
            w="72px"
            placeholder="Custom"
            value={custom}
            onChange={(e) => handleCustom(e.target.value)}
            aria-label="Custom slippage"
          />
          <Text fontSize="xs" color="fg.muted">
            %
          </Text>
        </HStack>
      </HStack>
    </Box>
  );
}
