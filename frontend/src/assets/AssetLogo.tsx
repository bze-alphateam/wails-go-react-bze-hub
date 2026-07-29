// Token logo with a graceful fallback chain: image URL → first-letter monogram.
// Presentational — pass a resolved symbol + optional logo URL.

import { useState } from "react";
import { Box, Image } from "@chakra-ui/react";

interface AssetLogoProps {
  symbol: string;
  /** Logo URL; when absent or broken, a letter monogram is shown. */
  src?: string;
  /** Chakra size token (e.g. "4", "6") or CSS length. */
  size?: string | number;
}

export function AssetLogo({ symbol, src, size = "5" }: AssetLogoProps) {
  const [failed, setFailed] = useState(false);
  const letter = (symbol || "?").charAt(0).toUpperCase();

  if (src && !failed) {
    return (
      <Image
        src={src}
        alt={symbol}
        boxSize={size}
        borderRadius="full"
        objectFit="cover"
        flexShrink={0}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <Box
      boxSize={size}
      borderRadius="full"
      bg="bg.subtle"
      color="fg.muted"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      fontSize="2xs"
      fontWeight="bold"
      flexShrink={0}
      lineHeight="1"
    >
      {letter}
    </Box>
  );
}
