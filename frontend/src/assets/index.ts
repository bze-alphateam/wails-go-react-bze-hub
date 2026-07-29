// Public surface of the assets module — import from "../assets".

export type { AssetMeta, DenomType } from "./types";
export {
  NATIVE_DENOM,
  isNativeDenom,
  isFactoryDenom,
  isIbcDenom,
  isLpDenom,
  getDenomType,
  factorySubdenom,
  shortDenomLabel,
  truncateDenom,
} from "./denom";
export {
  uAmountToHuman,
  humanToUAmount,
  formatAmount,
  formatUAmount,
  shortNumberFormat,
  type FormatOptions,
} from "./format";
export {
  FALLBACK_DECIMALS,
  assetFromChainMetadata,
  buildChainAssetMap,
  combineAssets,
  heuristicAsset,
  resolveAsset,
  type ChainDenomMetadata,
} from "./registry";
export { AssetsProvider, useAssets } from "./AssetsProvider";
export { AssetAmount, type AssetAmountProps } from "./AssetAmount";
export { AssetLogo } from "./AssetLogo";
