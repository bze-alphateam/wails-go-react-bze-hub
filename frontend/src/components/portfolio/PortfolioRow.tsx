import { HStack, Box, Text, Badge } from "@chakra-ui/react";
import { LuShield } from "react-icons/lu";
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
}

/**
 * A single Portfolio row: logo, symbol with type/verified badges, name, the held
 * amount and (when priced) its USD value. Purely presentational — all data and
 * USD math is handed in by `PortfolioSection`.
 */
export function PortfolioRow({ asset, logo, usd }: PortfolioRowProps) {
  const badge = typeBadge(asset.type);
  const value = usdLabel(usd);

  return (
    <HStack
      justify="space-between"
      px="3"
      py="2.5"
      borderRadius="lg"
      _hover={{ bg: "bg.subtle" }}
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

      <Box textAlign="right" flexShrink={0}>
        <Text fontSize="sm" fontWeight="medium">
          {prettyAmount(uAmountToBigNumberAmount(asset.amount, asset.decimals))}
        </Text>
        {value && (
          <Text fontSize="xs" color="fg.muted">
            {value}
          </Text>
        )}
      </Box>
    </HStack>
  );
}
