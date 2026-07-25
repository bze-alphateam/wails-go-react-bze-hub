import { HStack, Box, Text, Badge, IconButton } from "@chakra-ui/react";
import { LuShield, LuSend } from "react-icons/lu";
import type BigNumber from "bignumber.js";
import type { AssetBalance } from "../../hooks/useAssets";
import { TokenLogo } from "../TokenLogo";
import { prettyAmount, uAmountToBigNumberAmount } from "../../utils/amount";
import { typeBadge, usdLabel } from "./portfolioHelpers";

interface PortfolioRowProps {
  asset: AssetBalance;
  /** Logo data URL for the asset (from `useAssets().logo`). */
  logo: string;
  /** Pre-computed USD value of the held amount, or null when there's no price. */
  usd: BigNumber | null;
  /** Opens this asset's detail view. */
  onSelect?: () => void;
  /** When provided, a Send action is shown that opens the Send form for this denom. */
  onSend?: (denom: string) => void;
}

/**
 * A single Portfolio row: logo, symbol with type/verified badges, name, the held
 * amount and (when priced) its USD value, plus an optional Send action. Clicking
 * (or pressing Enter/Space on) the row opens the asset detail. Purely
 * presentational — all data and USD math is handed in by `PortfolioSection`.
 */
export function PortfolioRow({ asset, logo, usd, onSelect, onSend }: PortfolioRowProps) {
  const badge = typeBadge(asset.type);
  const value = usdLabel(usd);

  return (
    <HStack
      className="group"
      justify="space-between"
      px="3"
      py="2.5"
      borderRadius="lg"
      cursor={onSelect ? "pointer" : undefined}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      _hover={{ bg: "bg.subtle" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "teal.500", outlineOffset: "-2px" }}
    >
      <HStack gap="3" minW="0">
        <TokenLogo src={logo} symbol={asset.symbol} size="9" />
        <Box minW="0">
          <HStack gap="2" minW="0">
            <Text fontSize="sm" fontWeight="semibold" truncate>
              {asset.symbol}
            </Text>
            <Badge colorPalette={badge.colorPalette} size="sm" variant="subtle" flexShrink={0}>
              {badge.label}
            </Badge>
            {asset.verified && (
              <Badge colorPalette="green" size="sm" variant="subtle" flexShrink={0}>
                <HStack gap="1">
                  {LuShield({ size: 12 }) as React.ReactNode}
                  <Text>Verified</Text>
                </HStack>
              </Badge>
            )}
          </HStack>
          <Text fontSize="xs" color="fg.muted" truncate>
            {asset.name}
          </Text>
        </Box>
      </HStack>

      <HStack gap="2" flexShrink={0}>
        <Box textAlign="right">
          <Text fontSize="sm" fontWeight="medium">
            {prettyAmount(uAmountToBigNumberAmount(asset.amount, asset.decimals))}
          </Text>
          {value && (
            <Text fontSize="xs" color="fg.muted">
              {value}
            </Text>
          )}
        </Box>
        {onSend && (
          <IconButton
            aria-label={`Send ${asset.symbol}`}
            size="xs"
            variant="ghost"
            opacity={0}
            _groupHover={{ opacity: 1 }}
            onClick={(e) => {
              e.stopPropagation();
              onSend(asset.denom);
            }}
          >
            {LuSend({ size: 15 }) as React.ReactNode}
          </IconButton>
        )}
      </HStack>
    </HStack>
  );
}
