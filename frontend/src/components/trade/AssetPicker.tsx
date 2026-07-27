import { useEffect, useMemo, useRef, useState } from "react";
import { Box, HStack, VStack, Text, Input, Button } from "@chakra-ui/react";
import { LuChevronDown } from "react-icons/lu";
import type { AssetBalance } from "../../hooks/useAssets";
import { TokenLogo } from "../TokenLogo";
import { prettyAmount, uAmountToBigNumberAmount } from "../../utils/amount";
import { filterAssets, sortAssetsForPicker } from "./swapHelpers";

interface AssetPickerProps {
  /** Small caption above the picker, e.g. "You pay" / "You receive". */
  label: string;
  assets: AssetBalance[];
  selected: AssetBalance | null;
  /** Logo data-URL lookup (from `useAssets().logo`). */
  logo: (denom: string) => string;
  onSelect: (asset: AssetBalance) => void;
}

const MAX_RESULTS = 50;

function balanceLabel(asset: AssetBalance): string {
  return prettyAmount(uAmountToBigNumberAmount(asset.amount, asset.decimals));
}

/**
 * Token picker for the swap card: a trigger showing the selected token (logo,
 * symbol, held balance) that opens an inline, searchable list. Rows are styled
 * to match Portfolio's asset rows (M1). Purely presentational — the asset list
 * and logos are handed in by the swap card.
 */
export function AssetPicker({
  label,
  assets,
  selected,
  logo,
  onSelect,
}: AssetPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => sortAssetsForPicker(filterAssets(assets, query)).slice(0, MAX_RESULTS),
    [assets, query],
  );

  // Close when clicking outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (asset: AssetBalance) => {
    onSelect(asset);
    setOpen(false);
    setQuery("");
  };

  return (
    <Box position="relative" ref={containerRef}>
      <Text fontSize="xs" color="fg.muted" mb="1">
        {label}
      </Text>

      <Button
        variant="outline"
        colorPalette="gray"
        w="full"
        h="auto"
        py="2.5"
        px="3"
        justifyContent="space-between"
        onClick={() => setOpen((v) => !v)}
        aria-label={selected ? `${label}: ${selected.symbol}` : label}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <HStack gap="2.5" minW="0">
          {selected ? (
            <>
              <TokenLogo src={logo(selected.denom)} symbol={selected.symbol} size="7" />
              <VStack gap="0" align="start" minW="0">
                <Text fontSize="sm" fontWeight="semibold" truncate>
                  {selected.symbol}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Balance: {balanceLabel(selected)}
                </Text>
              </VStack>
            </>
          ) : (
            <Text fontSize="sm" color="fg.muted">
              Select token
            </Text>
          )}
        </HStack>
        {LuChevronDown({ size: 16 }) as React.ReactNode}
      </Button>

      {open && (
        <Box
          position="absolute"
          zIndex="10"
          mt="1"
          w="full"
          bg="bg.panel"
          borderWidth="1px"
          borderRadius="lg"
          shadow="lg"
          overflow="hidden"
          role="listbox"
        >
          <Box p="2" borderBottomWidth="1px">
            <Input
              size="sm"
              autoFocus
              placeholder="Search by symbol or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search tokens"
            />
          </Box>
          <Box maxH="280px" overflowY="auto">
            {results.length > 0 ? (
              results.map((asset) => (
                <HStack
                  key={asset.denom}
                  role="option"
                  aria-selected={asset.denom === selected?.denom}
                  tabIndex={0}
                  justify="space-between"
                  px="3"
                  py="2.5"
                  cursor="pointer"
                  _hover={{ bg: "bg.subtle" }}
                  onClick={() => pick(asset)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(asset);
                    }
                  }}
                >
                  <HStack gap="2.5" minW="0">
                    <TokenLogo src={logo(asset.denom)} symbol={asset.symbol} size="7" />
                    <Box minW="0">
                      <Text fontSize="sm" fontWeight="medium" truncate>
                        {asset.symbol}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" truncate>
                        {asset.name}
                      </Text>
                    </Box>
                  </HStack>
                  <Text fontSize="xs" color="fg.muted" flexShrink={0}>
                    {balanceLabel(asset)}
                  </Text>
                </HStack>
              ))
            ) : (
              <Box p="4" textAlign="center">
                <Text fontSize="sm" color="fg.muted">
                  No tokens found
                </Text>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
