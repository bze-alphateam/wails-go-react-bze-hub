import { useState, useEffect } from "react";
import { Box, Center, Spinner, VStack, Text, Button } from "@chakra-ui/react";
import { LuExternalLink, LuRefreshCw } from "react-icons/lu";
import { OpenURL } from "../../wailsjs/go/main/App";

interface DAppFrameProps {
  url: string;
  label: string;
  isActive: boolean;
  refreshKey?: number;
}

export function DAppFrame({ url, label, isActive, refreshKey = 0 }: DAppFrameProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Combined key: retryKey (manual retry button) + refreshKey (from parent refresh)
  const iframeKey = retryKey + refreshKey * 1000;

  // Reset loading state when parent triggers a refresh
  useEffect(() => {
    if (refreshKey > 0) {
      setLoading(true);
      setError(false);
    }
  }, [refreshKey]);

  const handleLoad = () => {
    setLoading(false);
    setError(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  const handleRetry = () => {
    setLoading(true);
    setError(false);
    setRetryKey((k) => k + 1);
  };

  return (
    <Box
      position="absolute"
      top="0"
      left="0"
      width="100%"
      height="100%"
      display={isActive ? "block" : "none"}
    >
      {/* Loading overlay */}
      {loading && !error && (
        <Center position="absolute" top="0" left="0" right="0" bottom="0" zIndex={1} bg="bg">
          <VStack gap="3">
            <Spinner size="lg" color="teal.500" />
            <Text fontSize="sm" color="fg.muted">Loading {label}...</Text>
          </VStack>
        </Center>
      )}

      {/* Error state */}
      {error && (
        <Center position="absolute" top="0" left="0" right="0" bottom="0" zIndex={1} bg="bg">
          <VStack gap="4">
            <Text fontSize="lg" fontWeight="semibold" color="fg">
              Failed to load {label}
            </Text>
            <Text fontSize="sm" color="fg.muted" textAlign="center" maxW="400px">
              The page might not allow embedding, or there could be a network issue.
            </Text>
            <VStack gap="2">
              <Button size="sm" colorPalette="teal" onClick={handleRetry}>
                {LuRefreshCw({}) as React.ReactNode}
                <Text ml="1">Retry</Text>
              </Button>
              <Button size="sm" variant="outline" onClick={() => OpenURL(url)}>
                {LuExternalLink({}) as React.ReactNode}
                <Text ml="1">Open in browser</Text>
              </Button>
            </VStack>
          </VStack>
        </Center>
      )}

      {/* iframe */}
      <iframe
        key={iframeKey}
        src={url}
        title={label}
        onLoad={handleLoad}
        onError={handleError}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          opacity: loading || error ? 0 : 1,
        }}
        allow="clipboard-write"
      />
    </Box>
  );
}
