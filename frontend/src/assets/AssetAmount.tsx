// AssetAmount — the reusable, extendable way to render a token amount in BZE Hub.
//
// Give it a base-unit amount + denom; it resolves the correct decimals and symbol
// (factory tokens, native, IBC) via AssetsProvider and formats nicely. Decimals and
// symbol can be overridden for callers that already know them. Optionally shows the
// token logo and abbreviates large numbers.
//
//   <AssetAmount amount="164006001296" denom="ubze" />              → 164,006.001296 BZE
//   <AssetAmount amount={p} denom={reward.prize_denom} showLogo />  → ◎ 10 VDL
//   <AssetAmount amount={big} denom="ubze" abbreviate />            → 1.64M BZE

import { Text, HStack, type TextProps } from "@chakra-ui/react";
import { useAssets } from "./AssetsProvider";
import { uAmountToHuman, formatAmount, shortNumberFormat } from "./format";
import { AssetLogo } from "./AssetLogo";

type Amount = string | number | bigint;

export interface AssetAmountProps extends Omit<TextProps, "children"> {
  /** Amount in base (micro) units. */
  amount: Amount;
  /** Denom used to resolve decimals + symbol. */
  denom: string;
  /** Override the resolved decimals. */
  decimals?: number;
  /** Override the resolved display symbol. */
  symbol?: string;
  /** Append the symbol after the number (default true). */
  showSymbol?: boolean;
  /** Render the token logo before the number (default false). */
  showLogo?: boolean;
  /** Abbreviate large values (1.2M) instead of full grouped digits (default false). */
  abbreviate?: boolean;
  /** Max fraction digits when not abbreviating (default = min(decimals, 6)). */
  maxDecimals?: number;
  /** Logo size when showLogo is set. */
  logoSize?: string | number;
}

export function AssetAmount({
  amount,
  denom,
  decimals,
  symbol,
  showSymbol = true,
  showLogo = false,
  abbreviate = false,
  maxDecimals,
  logoSize = "4",
  ...textProps
}: AssetAmountProps) {
  const { getAsset } = useAssets();
  const asset = getAsset(denom);
  const dec = decimals ?? asset.decimals;
  const sym = symbol ?? asset.symbol;

  const human = uAmountToHuman(amount, dec);
  const text = abbreviate
    ? shortNumberFormat(human)
    : formatAmount(human, { maxDecimals: maxDecimals ?? Math.min(dec, 6) });

  const body = (
    <Text as="span" {...textProps}>
      {text}
      {showSymbol && (
        <Text as="span" color="fg.muted" ms="1">
          {sym}
        </Text>
      )}
    </Text>
  );

  if (!showLogo) return body;

  return (
    <HStack as="span" display="inline-flex" gap="1.5" verticalAlign="middle">
      <AssetLogo symbol={sym} src={asset.logo} size={logoSize} />
      {body}
    </HStack>
  );
}
