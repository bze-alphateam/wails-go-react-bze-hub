import { useState, useEffect } from "react";
import {
  Box, Button, HStack, VStack, Text, Badge, IconButton, Separator, Portal, Dialog,
} from "@chakra-ui/react";
import { LuCopy, LuCheck, LuShield, LuSend } from "react-icons/lu";
import type BigNumber from "bignumber.js";
import type { AssetBalance } from "../../hooks/useAssets";
import { TokenLogo } from "../TokenLogo";
import { prettyAmount, uAmountToBigNumberAmount } from "../../utils/amount";
import { typeBadge, usdLabel } from "./portfolioHelpers";
import { balanceBreakdown } from "./assetDetailHelpers";

interface AssetDetailProps {
  /** The selected asset; when null the dialog renders nothing. */
  asset: AssetBalance | null;
  isOpen: boolean;
  onClose: () => void;
  /** Logo data URL for the asset (from `useAssets().logo`). */
  logo: string;
  /** USD unit price, or null when unknown — the view never shows "$0". */
  price: BigNumber | null;
  /** Raw base-unit staked amount for this denom, or null when not applicable
   *  (only the native token has a staked breakdown in v1). */
  stakedUAmount?: string | null;
  /** Opens the Send flow for this denom (wired by the sibling Send story). */
  onSend: (denom: string) => void;
  /** Trade deep-link target (M2). When absent, the Trade action is not rendered
   *  at all — v1 shows no disabled buttons for unavailable features. */
  onTrade?: (denom: string) => void;
}

/**
 * Asset detail: a modal (matching the Portfolio's ReceiveModal pattern) opened
 * from a Portfolio row. Shows the token identity, a copyable denom, type/verified
 * badges, unit price (hidden when unknown), on-chain supply for factory tokens,
 * and an available/staked balance breakdown. Actions: Send (always) and Trade
 * (only once M2 wires `onTrade` — otherwise absent, never a disabled button).
 *
 * Purely presentational: all data (price, staked amount, logo) is handed in by
 * `PortfolioSection`.
 */
export function AssetDetail({
  asset, isOpen, onClose, logo, price, stakedUAmount, onSend, onTrade,
}: AssetDetailProps) {
  const [copied, setCopied] = useState(false);

  // Reset the copy feedback whenever the dialog opens or the asset changes.
  useEffect(() => {
    setCopied(false);
  }, [isOpen, asset?.denom]);

  if (!asset) return null;

  const badge = typeBadge(asset.type);
  const priceLabel = usdLabel(price);
  const rows = balanceBreakdown(asset, stakedUAmount, price);
  const supplyLabel =
    asset.type === "factory" && asset.supply
      ? prettyAmount(uAmountToBigNumberAmount(asset.supply, asset.decimals))
      : null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(asset.denom);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e: { open: boolean }) => !e.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="420px" borderRadius="xl">
            <Dialog.Header>
              <HStack gap="3" minW="0">
                <TokenLogo src={logo} symbol={asset.symbol} size="10" />
                <Box minW="0">
                  <Dialog.Title fontWeight="bold" truncate>
                    {asset.symbol}
                  </Dialog.Title>
                  <Text fontSize="sm" color="fg.muted" truncate>
                    {asset.name}
                  </Text>
                </Box>
              </HStack>
            </Dialog.Header>

            <Dialog.Body>
              <VStack gap="4" align="stretch">
                {/* Badges */}
                <HStack gap="2">
                  <Badge colorPalette={badge.colorPalette} variant="subtle">
                    {badge.label}
                  </Badge>
                  {asset.verified && (
                    <Badge colorPalette="green" variant="subtle">
                      <HStack gap="1">
                        {LuShield({ size: 12 }) as React.ReactNode}
                        <Text>Verified</Text>
                      </HStack>
                    </Badge>
                  )}
                </HStack>

                {/* Denom — copyable */}
                <Box>
                  <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="1">
                    Denom
                  </Text>
                  <HStack gap="2" p="2.5" bg="bg.subtle" borderRadius="md" align="center">
                    <Text flex="1" fontSize="sm" fontFamily="mono" wordBreak="break-all">
                      {asset.denom}
                    </Text>
                    <IconButton
                      aria-label="Copy denom"
                      size="xs"
                      variant="ghost"
                      onClick={handleCopy}
                    >
                      {copied
                        ? (LuCheck({}) as React.ReactNode)
                        : (LuCopy({}) as React.ReactNode)}
                    </IconButton>
                  </HStack>
                </Box>

                {/* Price + supply */}
                {(priceLabel || supplyLabel) && (
                  <VStack gap="2" align="stretch">
                    {priceLabel && (
                      <HStack justify="space-between">
                        <Text fontSize="sm" color="fg.muted">Price</Text>
                        <Text fontSize="sm" fontWeight="medium">{priceLabel}</Text>
                      </HStack>
                    )}
                    {supplyLabel && (
                      <HStack justify="space-between">
                        <Text fontSize="sm" color="fg.muted">Supply</Text>
                        <Text fontSize="sm" fontWeight="medium">
                          {supplyLabel} {asset.symbol}
                        </Text>
                      </HStack>
                    )}
                  </VStack>
                )}

                <Separator />

                {/* Balance breakdown */}
                <Box>
                  <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="2">
                    Balance
                  </Text>
                  <VStack gap="2" align="stretch">
                    {rows.map((r) => {
                      const value = usdLabel(r.usd);
                      const isTotal = r.label === "Total";
                      return (
                        <HStack key={r.label} justify="space-between" align="baseline">
                          <Text
                            fontSize="sm"
                            color={isTotal ? "fg" : "fg.muted"}
                            fontWeight={isTotal ? "semibold" : "normal"}
                          >
                            {r.label}
                          </Text>
                          <Box textAlign="right">
                            <Text fontSize="sm" fontWeight={isTotal ? "bold" : "medium"}>
                              {prettyAmount(r.amount)} {asset.symbol}
                            </Text>
                            {value && (
                              <Text fontSize="xs" color="fg.muted">{value}</Text>
                            )}
                          </Box>
                        </HStack>
                      );
                    })}
                  </VStack>
                </Box>
              </VStack>
            </Dialog.Body>

            <Dialog.Footer>
              <HStack gap="3" width="full">
                <Button flex="1" variant="outline" onClick={onClose}>
                  Close
                </Button>
                {/* Trade is rendered only once M2 wires `onTrade` (no disabled buttons in v1). */}
                {onTrade && (
                  <Button flex="1" variant="outline" onClick={() => onTrade(asset.denom)}>
                    Trade
                  </Button>
                )}
                <Button flex="1" colorPalette="teal" onClick={() => onSend(asset.denom)}>
                  <HStack gap="2">
                    {LuSend({}) as React.ReactNode}
                    <Text>Send</Text>
                  </HStack>
                </Button>
              </HStack>
            </Dialog.Footer>

            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
