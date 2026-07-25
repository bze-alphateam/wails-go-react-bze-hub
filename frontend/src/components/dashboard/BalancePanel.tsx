import { useState, useEffect, useRef } from "react";
import {
  VStack, HStack, Text, Heading, Box, IconButton, SimpleGrid,
} from "@chakra-ui/react";
import BigNumber from "bignumber.js";
import {
  LuRefreshCw, LuGlobe, LuBookOpen, LuMessageCircle, LuNewspaper,
  LuHandshake, LuWrench, LuChartColumn, LuFlame, LuLock, LuExternalLink,
  LuInfo,
} from "react-icons/lu";
import { GetAllBalances, OpenURL } from "../../../wailsjs/go/main/App";
import { useAssets } from "../../hooks/useAssets";
import { useChainEvents } from "../../hooks/useChainEvents";
import { TokenLogo } from "../TokenLogo";
import { prettyAmount, uAmountToBigNumberAmount, toBigNumber } from "../../utils/amount";
import { formatUsdAmount } from "../../utils/formatter";

const NATIVE_DENOM = "ubze";
const NATIVE_DECIMALS = 6;

interface Props {
  address: string;
  label: string;
  proxyTarget: string;
  onNavigate: (tabId: string) => void;
  onShowAbout: () => void;
}

function formatBze(ubzeAmount: string): string {
  return prettyAmount(uAmountToBigNumberAmount(ubzeAmount || "0", NATIVE_DECIMALS));
}

/** "$1,234.56" for values ≥ 1, "$0.00046927" for sub-dollar prices; null when
 *  there is no positive value to show (never renders "$0"). */
function usdLabel(value: BigNumber | null | undefined): string | null {
  if (!value || value.lte(0)) return null;
  if (value.gte(1)) return `$${prettyAmount(value.toFixed(2))}`;
  return `$${formatUsdAmount(value)}`;
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
  { label: "Trade", tabId: "trade", icon: LuChartColumn, description: "Trade tokens" },
  { label: "Burner", tabId: "burner", icon: LuFlame, description: "Burn tokens & raffles" },
  { label: "Earn", tabId: "earn", icon: LuLock, description: "Stake & delegate" },
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

interface WalletBalance {
  address: string;
  label: string;
  amount: string;
}

export function BalancePanel({ address, label, proxyTarget, onNavigate, onShowAbout }: Props) {
  const { assets, isLoading, reload, price, logo, usdValue } = useAssets(address, proxyTarget);

  // Cross-wallet BZE totals still come from GetAllBalances (useAssets only covers
  // the active address). Prices/formatting go through the ported utils.
  const [walletBalances, setWalletBalances] = useState<WalletBalance[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWalletBalances = async () => {
    if (!address) return;
    try {
      const result = await GetAllBalances();
      setWalletBalances((result as WalletBalance[]) || []);
    } catch (e) {
      console.error("wallet balances fetch:", e);
    }
  };

  const refresh = () => {
    reload();
    fetchWalletBalances();
  };

  useEffect(() => {
    fetchWalletBalances();
    if (intervalRef.current) clearInterval(intervalRef.current);
    const interval = proxyTarget === "local" ? 10_000 : 30_000;
    intervalRef.current = setInterval(fetchWalletBalances, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [address, proxyTarget]);

  // Live refresh: a tx touching the active address refreshes balances within a
  // block (coalesced per block), instead of waiting for the poll interval.
  useChainEvents(address, { onMatchingTx: () => refresh() });

  const otherBalances = walletBalances.filter((b) => b.address !== address);
  const otherTotal = otherBalances.reduce((sum, b) => sum + BigInt(b.amount || "0"), BigInt(0));

  const bzePrice = price(NATIVE_DENOM);
  const nativeAsset = assets.find((a) => a.denom === NATIVE_DENOM);
  const nativeAmount = nativeAsset?.amount || "0";
  const nativeUsd = usdLabel(usdValue(NATIVE_DENOM, nativeAmount));
  const otherUsd =
    bzePrice && otherTotal > BigInt(0)
      ? usdLabel(bzePrice.multipliedBy(uAmountToBigNumberAmount(otherTotal.toString(), NATIVE_DECIMALS)))
      : null;

  // The active wallet's holdings (non-zero balances), most valuable first. LP
  // tokens keep their resolved names; anything priced sorts above the unpriced.
  const holdings = assets
    .filter((a) => a.denom !== NATIVE_DENOM && toBigNumber(a.amount || "0").gt(0))
    .sort((a, b) => {
      const av = usdValue(a.denom, a.amount) ?? toBigNumber(0);
      const bv = usdValue(b.denom, b.amount) ?? toBigNumber(0);
      return bv.comparedTo(av) ?? 0;
    });

  return (
    <VStack align="stretch" gap="8">
      {/* Balance */}
      <Box>
        <HStack justify="space-between" mb="2">
          <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
            {label}
          </Text>
          <IconButton
            aria-label="Refresh balance"
            size="2xs"
            variant="ghost"
            onClick={refresh}
            disabled={isLoading}
          >
            {LuRefreshCw({}) as React.ReactNode}
          </IconButton>
        </HStack>

        <HStack align="baseline" gap="2">
          <Heading size="3xl" fontWeight="bold">
            {formatBze(nativeAmount)}
          </Heading>
          <Text fontSize="lg" color="fg.muted">BZE</Text>
        </HStack>

        {nativeUsd && (
          <Text fontSize="sm" color="fg.muted" mt="0.5">
            {nativeUsd}
          </Text>
        )}

        {otherBalances.length > 0 && otherTotal > BigInt(0) && (
          <Text fontSize="xs" color="fg.muted" mt="1">
            In other wallets: {formatBze(otherTotal.toString())} BZE
            {otherUsd && ` (${otherUsd})`}
          </Text>
        )}
      </Box>

      {/* Assets held by the active wallet */}
      {holdings.length > 0 && (
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb="3">
            Your Assets
          </Text>
          <VStack align="stretch" gap="1">
            {holdings.map((a) => {
              const value = usdLabel(usdValue(a.denom, a.amount));
              return (
                <HStack
                  key={a.denom}
                  justify="space-between"
                  px="3"
                  py="2"
                  borderRadius="lg"
                  _hover={{ bg: "bg.subtle" }}
                >
                  <HStack gap="3" minW="0">
                    <TokenLogo src={logo(a.denom)} symbol={a.symbol} size="7" />
                    <Box minW="0">
                      <Text fontSize="sm" fontWeight="semibold" truncate>
                        {a.symbol}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" truncate>
                        {a.name}
                      </Text>
                    </Box>
                  </HStack>
                  <Box textAlign="right" flexShrink={0}>
                    <Text fontSize="sm" fontWeight="medium">
                      {prettyAmount(uAmountToBigNumberAmount(a.amount, a.decimals))}
                    </Text>
                    {value && (
                      <Text fontSize="xs" color="fg.muted">
                        {value}
                      </Text>
                    )}
                  </Box>
                </HStack>
              );
            })}
          </VStack>
        </Box>
      )}

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

        {/* About Hub */}
        <Box
          mt="3"
          px="4"
          py="3"
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          cursor="pointer"
          _hover={{ bg: "bg.subtle", borderColor: "teal.500" }}
          transition="all 0.15s"
          onClick={onShowAbout}
        >
          <HStack gap="3">
            <Box color="teal.500" flexShrink={0}>{LuInfo({}) as React.ReactNode}</Box>
            <Box>
              <Text fontSize="sm" fontWeight="semibold">About BZE Hub</Text>
              <Text fontSize="xs" color="fg.muted">Learn how the Hub works</Text>
            </Box>
          </HStack>
        </Box>
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
