import { useState, useEffect, useRef } from "react";
import {
  VStack, HStack, Text, Heading, Box, IconButton, SimpleGrid,
} from "@chakra-ui/react";
import {
  LuRefreshCw, LuGlobe, LuBookOpen, LuMessageCircle, LuNewspaper,
  LuHandshake, LuWrench, LuChartColumn, LuFlame, LuLock, LuExternalLink,
} from "react-icons/lu";
import { GetBalance, OpenURL } from "../../../wailsjs/go/main/App";

interface Props {
  address: string;
  label: string;
  proxyTarget: string;
  onNavigate: (tabId: string) => void;
}

function formatBze(ubzeAmount: string): string {
  const num = BigInt(ubzeAmount || "0");
  const whole = num / BigInt(1_000_000);
  const frac = num % BigInt(1_000_000);
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  if (fracStr === "") return whole.toLocaleString();
  return `${whole.toLocaleString()}.${fracStr}`;
}

interface HubPage {
  label: string;
  tabId: string;
  icon: Function;
  description: string;
}

interface ExternalLink {
  label: string;
  url: string;
  icon: Function;
  description: string;
}

const hubPages: HubPage[] = [
  { label: "DEX", tabId: "dex", icon: LuChartColumn, description: "Trade tokens" },
  { label: "Burner", tabId: "burner", icon: LuFlame, description: "Burn tokens & raffles" },
  { label: "Staking", tabId: "staking", icon: LuLock, description: "Stake & delegate" },
];

const officialLinks: ExternalLink[] = [
  { label: "Website", url: "https://getbze.com", icon: LuGlobe, description: "Official BZE website" },
  { label: "Blog", url: "https://medium.com/bzedge-community", icon: LuBookOpen, description: "Medium articles" },
  { label: "Twitter", url: "https://x.com/BZEdgeCoin", icon: LuMessageCircle, description: "@BZEdgeCoin" },
  { label: "CoinTrunk", url: "https://cointrunk.io", icon: LuNewspaper, description: "Web3 Tools" },
];

const partnerLinks: ExternalLink[] = [
  { label: "Vidulum", url: "https://vidulum.app", icon: LuHandshake, description: "Multi-asset wallet" },
  { label: "ChainTools", url: "https://chaintools.tech", icon: LuWrench, description: "Blockchain infrastructure" },
];

function HubPageCard({ item, onClick }: { item: HubPage; onClick: () => void }) {
  return (
    <Box
      px="4"
      py="3"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      cursor="pointer"
      _hover={{ bg: "bg.subtle", borderColor: "teal.500" }}
      transition="all 0.15s"
      onClick={onClick}
    >
      <HStack gap="3">
        <Box color="teal.500" flexShrink={0}>
          {item.icon({}) as React.ReactNode}
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="semibold">{item.label}</Text>
          <Text fontSize="xs" color="fg.muted">{item.description}</Text>
        </Box>
      </HStack>
    </Box>
  );
}

function ExternalLinkCard({ item }: { item: ExternalLink }) {
  return (
    <Box
      px="4"
      py="3"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      cursor="pointer"
      _hover={{ bg: "bg.subtle", borderColor: "border" }}
      transition="all 0.15s"
      onClick={() => OpenURL(item.url)}
    >
      <HStack gap="3">
        <Box color="fg.muted" flexShrink={0}>
          {item.icon({}) as React.ReactNode}
        </Box>
        <Box flex="1">
          <Text fontSize="sm" fontWeight="semibold">{item.label}</Text>
          <Text fontSize="xs" color="fg.muted">{item.description}</Text>
        </Box>
        <Box color="fg.muted" flexShrink={0} fontSize="xs">
          {LuExternalLink({}) as React.ReactNode}
        </Box>
      </HStack>
    </Box>
  );
}

export function BalancePanel({ address, label, proxyTarget, onNavigate }: Props) {
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBalance = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const resp = await GetBalance();
      const bal = resp?.balance as any;
      if (bal?.amount) {
        setBalance(bal.amount);
      }
    } catch (e) {
      console.error("balance fetch:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    if (intervalRef.current) clearInterval(intervalRef.current);
    const interval = proxyTarget === "local" ? 10_000 : 30_000;
    intervalRef.current = setInterval(fetchBalance, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [address, proxyTarget]);

  return (
    <VStack align="stretch" gap="8">
      {/* Balance */}
      <Box>
        <HStack justify="space-between" mb="2">
          <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
            Balance
          </Text>
          <IconButton
            aria-label="Refresh balance"
            size="2xs"
            variant="ghost"
            onClick={fetchBalance}
            disabled={loading}
          >
            {LuRefreshCw({}) as React.ReactNode}
          </IconButton>
        </HStack>

        <HStack align="baseline" gap="2">
          <Heading size="3xl" fontWeight="bold">
            {formatBze(balance)}
          </Heading>
          <Text fontSize="lg" color="fg.muted">BZE</Text>
        </HStack>

        <Text fontSize="xs" color="fg.muted" mt="1" fontFamily="mono">
          {address}
        </Text>
      </Box>

      {/* Hub Pages */}
      <Box>
        <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb="3">
          Hub Pages
        </Text>
        <SimpleGrid columns={3} gap="2">
          {hubPages.map((page) => (
            <HubPageCard key={page.tabId} item={page} onClick={() => onNavigate(page.tabId)} />
          ))}
        </SimpleGrid>
      </Box>

      {/* Official Links */}
      <Box>
        <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb="3">
          Official Links
        </Text>
        <SimpleGrid columns={2} gap="2">
          {officialLinks.map((link) => (
            <ExternalLinkCard key={link.url} item={link} />
          ))}
        </SimpleGrid>
      </Box>

      {/* Partners */}
      <Box>
        <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb="3">
          Partners
        </Text>
        <SimpleGrid columns={2} gap="2">
          {partnerLinks.map((link) => (
            <ExternalLinkCard key={link.url} item={link} />
          ))}
        </SimpleGrid>
      </Box>
    </VStack>
  );
}
