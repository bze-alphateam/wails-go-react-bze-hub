import { describe, it, expect } from "vitest";
import {
  assetFromChainMetadata,
  buildChainAssetMap,
  combineAssets,
  heuristicAsset,
  resolveAsset,
  FALLBACK_DECIMALS,
  type ChainDenomMetadata,
} from "./registry";
import { getDenomType, shortDenomLabel } from "./denom";

// Real mainnet bank-metadata shape for the VDL factory token.
const VDL_META: ChainDenomMetadata = {
  base: "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl",
  display: "VDL",
  name: "Vidulum",
  symbol: "VDL",
  denom_units: [
    { denom: "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl", exponent: 0 },
    { denom: "VDL", exponent: 6 },
  ],
};

describe("assetFromChainMetadata", () => {
  it("reads decimals from the display denom_unit", () => {
    const a = assetFromChainMetadata(VDL_META)!;
    expect(a.decimals).toBe(6);
    expect(a.symbol).toBe("VDL");
    expect(a.name).toBe("Vidulum");
    expect(a.type).toBe("factory");
    expect(a.resolved).toBe(true);
  });

  it("falls back to max exponent when no unit matches display", () => {
    const a = assetFromChainMetadata({
      base: "factory/x/y",
      display: "MISSING",
      denom_units: [
        { denom: "factory/x/y", exponent: 0 },
        { denom: "Y", exponent: 8 },
      ],
    })!;
    expect(a.decimals).toBe(8);
  });

  it("returns null without a base denom", () => {
    expect(assetFromChainMetadata({ display: "X" })).toBeNull();
  });
});

describe("buildChainAssetMap", () => {
  it("keys assets by base denom", () => {
    const map = buildChainAssetMap([VDL_META]);
    expect(map.get(VDL_META.base!)?.symbol).toBe("VDL");
    expect(map.size).toBe(1);
  });
});

describe("resolveAsset", () => {
  const chainMap = buildChainAssetMap([VDL_META]);

  it("resolves native ubze from the static registry", () => {
    const a = resolveAsset("ubze", chainMap);
    expect(a.symbol).toBe("BZE");
    expect(a.decimals).toBe(6);
    expect(a.verified).toBe(true);
    expect(a.resolved).toBe(true);
  });

  it("resolves a factory token from chain metadata", () => {
    const a = resolveAsset(VDL_META.base!, chainMap);
    expect(a.symbol).toBe("VDL");
    expect(a.decimals).toBe(6);
  });

  it("resolves a curated IBC denom (USDC)", () => {
    const a = resolveAsset(
      "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4"
    );
    expect(a.symbol).toBe("USDC");
    expect(a.decimals).toBe(6);
    expect(a.verified).toBe(true);
  });

  it("falls back to a heuristic for unknown denoms (flagged unresolved)", () => {
    const a = resolveAsset("factory/bze1unknown/foo", chainMap);
    expect(a.decimals).toBe(FALLBACK_DECIMALS);
    expect(a.symbol).toBe("foo");
    expect(a.resolved).toBe(false);
    expect(a.type).toBe("factory");
  });

  it("works before chain metadata loads (no map)", () => {
    expect(resolveAsset("ubze").symbol).toBe("BZE");
  });
});

describe("heuristicAsset", () => {
  it("derives label and type from the denom", () => {
    const a = heuristicAsset("ibc/ABCDEF1234567890");
    expect(a.type).toBe("ibc");
    expect(a.symbol).toBe(shortDenomLabel("ibc/ABCDEF1234567890"));
    expect(a.resolved).toBe(false);
  });
});

describe("combineAssets", () => {
  it("includes static + curated IBC + chain assets", () => {
    const combined = combineAssets(buildChainAssetMap([VDL_META]));
    expect(combined.get("ubze")?.symbol).toBe("BZE");
    expect(combined.get(VDL_META.base!)?.symbol).toBe("VDL");
    expect(
      combined.get("ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4")?.symbol
    ).toBe("USDC");
  });
});

describe("denom helpers", () => {
  it("classifies and labels denoms", () => {
    expect(getDenomType("ubze")).toBe("native");
    expect(getDenomType("factory/x/y")).toBe("factory");
    expect(getDenomType("ibc/ABC")).toBe("ibc");
    expect(getDenomType("ulp_1_2")).toBe("lp");
    expect(getDenomType("weird")).toBe("unknown");
    expect(shortDenomLabel("ubze")).toBe("BZE");
    expect(shortDenomLabel("factory/x/uvdl")).toBe("uvdl");
    expect(shortDenomLabel("ibc/ABCDEFGHIJ")).toBe("IBC/ABCDEF");
  });
});
