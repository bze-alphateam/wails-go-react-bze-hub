// Asset metadata model for BZE Hub.
//
// Mirrors the shape used across the BZE ecosystem (bze-ui-kit's `Asset`), trimmed
// to what a native desktop app needs and what we can resolve without pulling in the
// heavy chain-registry dependency the web apps use. Decimals/symbol/name come from
// (1) a static built-in registry, (2) the chain's bank denom-metadata, or (3) a
// heuristic fallback — see registry.ts.

export type DenomType = "native" | "factory" | "ibc" | "lp" | "unknown";

export interface AssetMeta {
  /** The on-chain base denom, e.g. "ubze", "factory/.../uvdl", "ibc/ABC…". */
  denom: string;
  /** Detected denom family. */
  type: DenomType;
  /** Exponent between base units and display units (ubze→BZE = 6). */
  decimals: number;
  /** Short display ticker, e.g. "BZE", "VDL". */
  symbol: string;
  /** Full human name, e.g. "BeeZee", "Vidulum". Falls back to the symbol. */
  name: string;
  /** Optional logo URL. Usually empty for chain/heuristic-resolved assets. */
  logo?: string;
  /** Curated trust flag (a known/official asset). */
  verified: boolean;
  /**
   * Whether decimals/symbol came from a real source (static registry or on-chain
   * metadata). `false` means they are a best-effort heuristic guess — the UI can
   * choose to flag the amount as approximate.
   */
  resolved: boolean;
}
