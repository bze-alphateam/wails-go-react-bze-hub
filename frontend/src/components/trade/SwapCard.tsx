import { useEffect, useMemo, useState } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  IconButton,
  Input,
  Center,
  Spinner,
} from "@chakra-ui/react";
import { LuArrowDownUp, LuSettings, LuInfo } from "react-icons/lu";
import { useAssets } from "../../hooks/useAssets";
import { useLiquidityPools } from "../../hooks/useLiquidityPools";
import { useSwapSlippage } from "../../hooks/useSwapSlippage";
import { useSwapQuote } from "../../hooks/useSwapQuote";
import { prettyAmount, uAmountToBigNumberAmount } from "../../utils/amount";
import { AssetPicker } from "./AssetPicker";
import { SlippageControl } from "./SlippageControl";
import { SwapQuoteDetails } from "./SwapQuoteDetails";
import {
  parseAmountToBase,
  resolveSwapIssue,
  sanitizeAmountInput,
  swapIssueMessage,
} from "./swapHelpers";

interface SwapCardProps {
  address: string;
  proxyTarget: string;
}

/**
 * The Simple-view swap card: two token pickers, an amount-in field, live quoting
 * via the Go AMM router, a flip control, slippage settings, and a (still
 * disabled) confirm button. Broadcasting the swap is the next story (BHUB-24);
 * this card delivers the section, the inputs and correct quotes only.
 */
export function SwapCard({ address, proxyTarget }: SwapCardProps) {
  const { assets, isLoading, logo, resolve } = useAssets(address, proxyTarget);
  const { pools } = useLiquidityPools(proxyTarget);
  const { slippage, setSlippage } = useSwapSlippage();

  const [fromDenom, setFromDenom] = useState("");
  const [toDenom, setToDenom] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // Seed a sensible default pair once assets load (held/verified first, per the
  // picker sort). Only fills empty slots, so it never overrides a user choice.
  useEffect(() => {
    if (assets.length === 0) return;
    setFromDenom((prev) => prev || assets[0].denom);
    setToDenom(
      (prev) => prev || assets.find((a) => a.denom !== assets[0].denom)?.denom || "",
    );
  }, [assets]);

  const fromAsset = resolve(fromDenom) ?? null;
  const toAsset = resolve(toDenom) ?? null;

  const amountInBase = useMemo(
    () => (fromAsset ? parseAmountToBase(amountInput, fromAsset.decimals) : null),
    [amountInput, fromAsset],
  );

  const { quoted, isQuoting } = useSwapQuote(fromDenom, toDenom, amountInBase, address);

  // Only trust a quote that matches the current inputs — while a re-quote is in
  // flight (typing, or a new block) the previous quote is stale.
  const activeQuote =
    quoted &&
    quoted.denomIn === fromDenom &&
    quoted.denomOut === toDenom &&
    quoted.amountIn === amountInBase
      ? quoted.quote
      : null;

  const hasRoute = !!activeQuote && !activeQuote.noRoute;

  const outputDisplay =
    hasRoute && toAsset
      ? uAmountToBigNumberAmount(activeQuote!.expectedOut, toAsset.decimals).toString()
      : "";

  const issue = resolveSwapIssue({
    fromDenom,
    toDenom,
    amountBase: amountInBase,
    balanceBase: fromAsset?.amount ?? "0",
    quote: activeQuote,
    pools,
  });
  const issueMsg = swapIssueMessage(issue);

  const handleFlip = () => {
    setFromDenom(toDenom);
    setToDenom(fromDenom);
    // Move the amount you'd receive into the amount you pay (web parity).
    setAmountInput(outputDisplay || "");
  };

  if (!address) {
    return (
      <Center h="240px">
        <Text color="fg.muted">Connect a wallet to swap</Text>
      </Center>
    );
  }

  if (isLoading && assets.length === 0) {
    return (
      <Center h="240px">
        <Spinner size="lg" colorPalette="blue" />
      </Center>
    );
  }

  return (
    <Box
      maxW="480px"
      mx="auto"
      w="full"
      borderWidth="1px"
      borderColor="blue.500/20"
      borderRadius="xl"
      bg="bg.panel"
      shadow="sm"
      p="4"
    >
      <VStack gap="3" align="stretch">
        {/* Header */}
        <HStack justify="space-between">
          <Text fontSize="md" fontWeight="semibold">
            Swap
          </Text>
          <IconButton
            aria-label="Swap settings"
            size="sm"
            variant="ghost"
            colorPalette="gray"
            onClick={() => setShowSettings((v) => !v)}
          >
            {LuSettings({ size: 16 }) as React.ReactNode}
          </IconButton>
        </HStack>

        {showSettings && (
          <Box borderWidth="1px" borderRadius="lg" p="3" bg="bg.subtle">
            <SlippageControl slippage={slippage} onChange={setSlippage} />
          </Box>
        )}

        {pools.length === 0 && (
          <Box borderWidth="1px" borderRadius="lg" p="3" bg="bg.subtle">
            <Text fontSize="sm" color="fg.muted">
              No liquidity pools are available yet. Swapping will be possible once
              pools are created.
            </Text>
          </Box>
        )}

        {/* You pay */}
        <Box borderWidth="1px" borderRadius="lg" p="3">
          <AssetPicker
            label="You pay"
            assets={assets}
            selected={fromAsset}
            logo={logo}
            onSelect={(a) => setFromDenom(a.denom)}
          />
          <Input
            mt="2"
            size="lg"
            variant="flushed"
            placeholder="0.0"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value))}
            aria-label="Amount to swap"
          />
        </Box>

        {/* Flip */}
        <HStack justify="center" my="-1">
          <IconButton
            aria-label="Flip tokens"
            size="sm"
            variant="outline"
            colorPalette="blue"
            borderRadius="full"
            onClick={handleFlip}
          >
            {LuArrowDownUp({ size: 16 }) as React.ReactNode}
          </IconButton>
        </HStack>

        {/* You receive */}
        <Box borderWidth="1px" borderRadius="lg" p="3">
          <AssetPicker
            label="You receive"
            assets={assets}
            selected={toAsset}
            logo={logo}
            onSelect={(a) => setToDenom(a.denom)}
          />
          <HStack mt="2" minH="10" px="1" justify="space-between">
            <Text fontSize="xl" fontWeight="medium" color={outputDisplay ? "fg" : "fg.muted"}>
              {outputDisplay ? prettyAmount(outputDisplay) : "0.0"}
            </Text>
            {isQuoting && <Spinner size="sm" colorPalette="blue" />}
          </HStack>
        </Box>

        {/* Quote breakdown */}
        {hasRoute && toAsset && (
          <SwapQuoteDetails
            quote={activeQuote!}
            toAsset={toAsset}
            slippage={slippage}
            resolve={resolve}
            logo={logo}
          />
        )}

        {/* Neutral prompt / edge-state messages */}
        {issueMsg ? (
          <HStack
            gap="2"
            align="start"
            borderWidth="1px"
            borderColor="orange.500/30"
            borderRadius="lg"
            p="3"
            bg="orange.500/8"
          >
            <Box color="orange.fg" mt="0.5" flexShrink={0}>
              {LuInfo({ size: 16 }) as React.ReactNode}
            </Box>
            <Text fontSize="sm" color="fg">
              {issueMsg}
            </Text>
          </HStack>
        ) : (
          !amountInBase &&
          fromDenom &&
          toDenom &&
          fromDenom !== toDenom && (
            <Text fontSize="sm" color="fg.muted" textAlign="center">
              Enter an amount to see a quote.
            </Text>
          )
        )}

        {/* Confirm — disabled until execution lands (BHUB-24). */}
        <VStack gap="1" align="stretch">
          <Button size="lg" colorPalette="blue" disabled aria-disabled="true">
            Swap
          </Button>
          <Text fontSize="xs" color="fg.muted" textAlign="center">
            Swap execution is coming soon.
          </Text>
        </VStack>
      </VStack>
    </Box>
  );
}
