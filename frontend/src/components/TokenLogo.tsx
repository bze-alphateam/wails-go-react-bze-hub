import { useState, useEffect } from "react";
import { Box, Image } from "@chakra-ui/react";

interface TokenLogoProps {
  /** Logo data URL (from the Go asset cache). Empty/undefined → fallback. */
  src?: string;
  /** Token symbol, used for alt text and the fallback initial. */
  symbol: string;
  /** Width/height of the logo. Default "8". */
  size?: string | number;
}

/**
 * Token logo with graceful degradation, mirroring the web ui-kit's TokenLogo:
 *   1. Render `src` (a data URL served by the Go logo cache — no network fetch).
 *   2. If it's empty or fails to decode, show a circular tile with the first
 *      letter of `symbol` — guaranteed to always render something.
 *
 * Logos never come from the network on the React side; the Go backend downloads
 * and caches them and hands them over as data URLs (see App.GetAssetLogo).
 */
export function TokenLogo({ src, symbol, size = "8" }: TokenLogoProps) {
  const [failed, setFailed] = useState(false);

  // Reset the error state when the source changes (e.g. logo arrives after an
  // assets:updated refresh).
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = !!src && !failed;

  return (
    <Box
      w={size}
      h={size}
      borderRadius="full"
      overflow="hidden"
      bg="bg.subtle"
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      fontSize="xs"
      fontWeight="bold"
      color="fg.muted"
    >
      {showImage ? (
        <Image
          src={src}
          alt={`${symbol} logo`}
          w="full"
          h="full"
          objectFit="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        (symbol || "?").charAt(0).toUpperCase()
      )}
    </Box>
  );
}
