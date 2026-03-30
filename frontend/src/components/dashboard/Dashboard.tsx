import { useState, useEffect } from "react";
import { HStack, VStack, Box, Text, IconButton } from "@chakra-ui/react";
import { LuX, LuShield, LuZap, LuHardDrive, LuGlobe } from "react-icons/lu";
import { BalancePanel } from "./BalancePanel";
import { ArticleList } from "./ArticleList";

interface DashboardProps {
  address: string;
  label: string;
  proxyTarget: string;
  onNavigate: (tabId: string) => void;
}

export function Dashboard({ address, label, proxyTarget, onNavigate }: DashboardProps) {
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    if (!showAbout) return;
    const timer = setTimeout(() => setShowAbout(false), 60_000);
    return () => clearTimeout(timer);
  }, [showAbout]);

  return (
    <HStack align="stretch" h="100%" w="100%" gap="0" overflow="hidden">
      {/* Left side */}
      <Box flex="1" overflow="hidden" position="relative">
        {/* Normal dashboard content */}
        <Box p="6" overflowY="auto" h="100%" display={showAbout ? "none" : "block"}>
          <BalancePanel
            address={address}
            label={label}
            proxyTarget={proxyTarget}
            onNavigate={onNavigate}
            onShowAbout={() => setShowAbout(true)}
          />
        </Box>

        {/* About overlay — replaces dashboard content in place */}
        {showAbout && (
          <Box p="6" overflowY="auto" h="100%">
            <HStack justify="space-between" mb="5">
              <Text fontSize="lg" fontWeight="bold">About BZE Hub</Text>
              <IconButton
                aria-label="Close"
                size="xs"
                variant="ghost"
                onClick={() => setShowAbout(false)}
              >
                {LuX({}) as React.ReactNode}
              </IconButton>
            </HStack>

            <VStack align="stretch" gap="5" fontSize="sm" color="fg.muted">
              <Text fontSize="md">
                <strong>BZE Hub</strong> is your gateway to the BeeZee ecosystem — a single desktop app that combines a wallet, a local node, and all BZE applications.
              </Text>

              <HStack gap="4" align="start">
                <Box color="teal.500" mt="1" flexShrink={0} fontSize="lg">{LuShield({}) as React.ReactNode}</Box>
                <Box>
                  <Text fontWeight="semibold" color="fg" fontSize="md">Secure Wallet</Text>
                  <Text>Your keys are stored in the OS keychain and never saved in plain text. They are only accessed when needed and cleared from memory immediately after.</Text>
                </Box>
              </HStack>

              <HStack gap="4" align="start">
                <Box color="teal.500" mt="1" flexShrink={0} fontSize="lg">{LuHardDrive({}) as React.ReactNode}</Box>
                <Box>
                  <Text fontWeight="semibold" color="fg" fontSize="md">Local Light Node</Text>
                  <Text>The Hub runs a pruned BZE node on your machine, giving you direct blockchain access without depending on third-party services.</Text>
                </Box>
              </HStack>

              <HStack gap="4" align="start">
                <Box color="teal.500" mt="1" flexShrink={0} fontSize="lg">{LuZap({}) as React.ReactNode}</Box>
                <Box>
                  <Text fontWeight="semibold" color="fg" fontSize="md">Faster Experience</Text>
                  <Text>Queries go through your local node for lower latency. When syncing, the app seamlessly falls back to public endpoints — you're never blocked.</Text>
                </Box>
              </HStack>

              <HStack gap="4" align="start">
                <Box color="teal.500" mt="1" flexShrink={0} fontSize="lg">{LuGlobe({}) as React.ReactNode}</Box>
                <Box>
                  <Text fontWeight="semibold" color="fg" fontSize="md">All-In-One</Text>
                  <Text>Trade, stake, burn, and explore — all from one app, without browser extensions or multiple tabs.</Text>
                </Box>
              </HStack>
            </VStack>
          </Box>
        )}
      </Box>

      {/* Right side: articles */}
      <Box
        w="350px"
        flexShrink={0}
        borderLeftWidth="1px"
        borderColor="border"
        overflowY="auto"
      >
        <ArticleList />
      </Box>
    </HStack>
  );
}
