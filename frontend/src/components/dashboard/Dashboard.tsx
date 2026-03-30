import { HStack, Box } from "@chakra-ui/react";
import { BalancePanel } from "./BalancePanel";
import { ArticleList } from "./ArticleList";

interface DashboardProps {
  address: string;
  label: string;
  proxyTarget: string;
  onNavigate: (tabId: string) => void;
}

export function Dashboard({ address, label, proxyTarget, onNavigate }: DashboardProps) {
  return (
    <HStack align="stretch" h="100%" w="100%" gap="0" overflow="hidden">
      {/* Left side: balance + links */}
      <Box flex="1" p="6" overflowY="auto">
        <BalancePanel address={address} label={label} proxyTarget={proxyTarget} onNavigate={onNavigate} />
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
