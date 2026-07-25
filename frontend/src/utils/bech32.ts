// Minimal bech32 (BIP173) decoder — enough to validate that a string is a
// well-formed bech32 address with the expected human-readable prefix (e.g.
// `bze`). Cosmos addresses use plain bech32 (checksum constant 1), not bech32m,
// so that is all this implements. Ported rather than pulled from a dependency to
// keep the desktop bundle free of a crypto lib just for address validation.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i];
    }
  }
  return chk;
}

/** Expand the human-readable part into the values the checksum is computed over. */
function hrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    high.push(c >> 5);
    low.push(c & 31);
  }
  return [...high, 0, ...low];
}

export interface Bech32Decoded {
  /** The human-readable prefix (before the separator), e.g. "bze". */
  prefix: string;
  /** The 5-bit data words, checksum excluded. */
  words: number[];
}

/**
 * Decode a bech32 string, verifying its checksum. Returns null when the string
 * is not valid bech32 (bad charset, mixed case, missing/short data, wrong
 * checksum). Does not interpret the data as an address — that is the caller's
 * concern; here we only guarantee the encoding is intact.
 */
export function decodeBech32(str: string): Bech32Decoded | null {
  if (typeof str !== "string") return null;
  // Reject mixed case — bech32 is case-insensitive but must be all one case.
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null;
  const lower = str.toLowerCase();

  const sep = lower.lastIndexOf("1");
  // hrp is ≥1 char; the checksum is the last 6 data chars.
  if (sep < 1 || sep + 7 > lower.length) return null;

  const hrp = lower.slice(0, sep);
  const dataPart = lower.slice(sep + 1);

  const data: number[] = [];
  for (const ch of dataPart) {
    const idx = CHARSET.indexOf(ch);
    if (idx === -1) return null;
    data.push(idx);
  }

  if (polymod([...hrpExpand(hrp), ...data]) !== 1) return null;

  return { prefix: hrp, words: data.slice(0, data.length - 6) };
}

/**
 * True when `str` is a valid bech32 address with exactly the given prefix — the
 * check the Send form runs on a recipient (`isValidBech32(addr, "bze")`).
 */
export function isValidBech32(str: string, expectedPrefix: string): boolean {
  const decoded = decodeBech32(str);
  if (!decoded) return false;
  if (decoded.prefix !== expectedPrefix) return false;
  // A bare account address decodes to 20 bytes = 32 five-bit words.
  return decoded.words.length === 32;
}
