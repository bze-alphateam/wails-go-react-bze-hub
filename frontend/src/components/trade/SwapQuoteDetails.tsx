import { Fragment } from "react";
import { Box, HStack, VStack, Text, Badge, Flex } from "@chakra-ui/react";
import { LuArrowRight } from "react-icons/lu";
import BigNumber from "bignumber.js";
import type { AssetBalance } from "../../hooks/useAssets";
import type { amm } from "../../../wailsjs/go/models";
import { TokenLogo } from "../TokenLogo";
import { prettyAmount, uAmountToBigNumberAmount, toBigNumber } from "../../utils/amount";
import { minOutputBase, priceImpactPalette } from "./swapHelpers";

interface SwapQuoteDetailsProps {
  quote: amm.SwapQuote;
  toAsset: AssetBalance;
  /** Current slippage tolerance (percent), for the minimum-received line. */
  slippage: number;
  /** Resolve a denom to its loaded asset (for symbols/decimals along the route). */
  resolve: (denom: string) => AssetBalance | undefined;
  logo: (denom: string) => string;
}

const FALLBACK_DECIMALS = 6;

function symbolOf(denom: string, resolve: (d: string) => AssetBalance | undefined): string {
  return resolve(denom)?.symbol ?? denom;
}

function decimalsOf(denom: string, resolve: (d: string) => AssetBalance | undefined): number {
  return resolve(denom)?.decimals ?? FALLBACK_DECIMALS;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <HStack justify="space-between">
      <Text fontSize="sm" color="fg.muted" fontWeight="medium">
        {label}
      </Text>
      {children}
    </HStack>
  );
}

/**
 * The quote breakdown shown under the swap inputs: expected output, minimum
 * received after slippage, price impact, total fee, and the multi-hop route with
 * a per-hop fee. Simple view — deliberately no "price"/"rate" or orderbook
 * concepts (M2 business rule); only give/get amounts and fees.
 */
export function SwapQuoteDetails({
  quote,
  toAsset,
  slippage,
  resolve,
  logo,
}: SwapQuoteDetailsProps) {
  const expectedOut = uAmountToBigNumberAmount(quote.expectedOut, toAsset.decimals);
  const minReceived = uAmountToBigNumberAmount(
    minOutputBase(quote.expectedOut, slippage),
    toAsset.decimals,
  );
  const totalFee = uAmountToBigNumberAmount(quote.totalFees, toAsset.decimals);
  const impact = toBigNumber(quote.priceImpact);
  const path = quote.path ?? [];
  const feesPerHop = quote.feesPerHop ?? [];

  return (
    <Box
      borderWidth="1px"
      borderColor="blue.500/20"
      borderRadius="lg"
      p="3"
      bg="bg.subtle"
    >
      <VStack gap="2.5" align="stretch">
        <DetailRow label="Expected output">
          <Text fontSize="sm" fontWeight="semibold">
            {prettyAmount(expectedOut)} {toAsset.symbol}
          </Text>
        </DetailRow>

        <DetailRow label={`Minimum received (${slippage}% slippage)`}>
          <Text fontSize="sm" fontWeight="medium">
            {prettyAmount(minReceived)} {toAsset.symbol}
          </Text>
        </DetailRow>

        <DetailRow label="Price impact">
          <Badge colorPalette={priceImpactPalette(quote.priceImpact)} variant="subtle">
            {(impact.isNaN() ? new BigNumber(0) : impact).toFixed(2)}%
          </Badge>
        </DetailRow>

        <DetailRow label="Total fee">
          <Text fontSize="sm" fontWeight="medium">
            {prettyAmount(totalFee)} {toAsset.symbol}
          </Text>
        </DetailRow>

        {path.length > 1 && (
          <Box pt="1">
            <Text fontSize="xs" color="fg.muted" mb="2">
              Route ({path.length - 1} hop{path.length - 1 > 1 ? "s" : ""})
            </Text>
            <Flex wrap="wrap" gap="2" align="center">
              {path.map((denom, i) => {
                const isLast = i === path.length - 1;
                const hopFee = feesPerHop[i];
                const hopDecimals = decimalsOf(denom, resolve);
                return (
                  <Fragment key={`${denom}-${i}`}>
                    <HStack
                      gap="1.5"
                      px="2"
                      py="1"
                      borderWidth="1px"
                      borderRadius="md"
                      bg="bg.panel"
                    >
                      <TokenLogo src={logo(denom)} symbol={symbolOf(denom, resolve)} size="5" />
                      <Text fontSize="xs" fontWeight="medium">
                        {symbolOf(denom, resolve)}
                      </Text>
                    </HStack>
                    {!isLast && (
                      <VStack gap="0" align="center">
                        {LuArrowRight({ size: 14 }) as React.ReactNode}
                        {hopFee !== undefined && (
                          <Text fontSize="2xs" color="fg.muted">
                            fee{" "}
                            {prettyAmount(uAmountToBigNumberAmount(hopFee, hopDecimals))}{" "}
                            {symbolOf(denom, resolve)}
                          </Text>
                        )}
                      </VStack>
                    )}
                  </Fragment>
                );
              })}
            </Flex>
          </Box>
        )}
      </VStack>
    </Box>
  );
}
