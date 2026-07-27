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
import { useSwapTx } from "../../hooks/useSwapTx";
import { useChainEvents } from "../../hooks/useChainEvents";
import { prettyAmount, uAmountToBigNumberAmount } from "../../utils/amount";
import { AssetPicker } from "./AssetPicker";
import { SlippageControl } from "./SlippageControl";
import { SwapQuoteDetails } from "./SwapQuoteDetails";
import {
  PRICE_IMPACT_ACK_THRESHOLD,
  minOutputBase,
  parseAmountToBase,
  resolveSwapIssue,
  sanitizeAmountInput,
  swapIssueMessage,
} from "./swapHelpers";

interface SwapCardProps {
  address: string;
  proxyTarget: string;
  /** Denom to preselect as the input token (Portfolio → Trade deep link). */
  preselectDenom?: string | null;
  /** Called once the preselect denom has been applied, so it can be cleared. */
  onPreselectConsumed?: () => void;
}

/**
 * The Simple-view swap card: two token pickers, an amount-in field, live quoting
 * via the Go AMM router, a flip control, slippage settings, and a review →
 * confirm → execute flow that broadcasts a MsgMultiSwap. A stale quote (a newer
 * block has arrived than the quote was computed at) can never be executed, and a
 * high price impact requires an explicit acknowledgement.
 */
export function SwapCard({ address, proxyTarget, preselectDenom, onPreselectConsumed }: SwapCardProps) {
  const { assets, isLoading, logo, resolve } = useAssets(address, proxyTarget);
  const { pools } = useLiquidityPools(proxyTarget);
  const { slippage, setSlippage } = useSwapSlippage();
  const { swap, isSubmitting } = useSwapTx(address);

  const [fromDenom, setFromDenom] = useState("");
  const [toDenom, setToDenom] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [impactAck, setImpactAck] = useState(false);
  const [currentHeight, setCurrentHeight] = useState("");

  // Track the chain tip so a quote computed at an older height is treated as stale.
  useChainEvents(address, { onBlock: setCurrentHeight });

  // Seed a sensible default pair once assets load (held/verified first, per the
  // picker sort). Only fills empty slots, so it never overrides a user choice.
  useEffect(() => {
    if (assets.length === 0) return;
    setFromDenom((prev) => prev || assets[0].denom);
    setToDenom(
      (prev) => prev || assets.find((a) => a.denom !== assets[0].denom)?.denom || "",
    );
  }, [assets]);

  // Portfolio → Trade deep link: preselect the input token, then clear the signal.
  useEffect(() => {
    if (!preselectDenom) return;
    setFromDenom(preselectDenom);
    setToDenom((prev) => (prev === preselectDenom ? "" : prev));
    setAmountInput("");
    setStep("form");
    onPreselectConsumed?.();
  }, [preselectDenom]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromAsset = resolve(fromDenom) ?? null;
  const toAsset = resolve(toDenom) ?? null;

  const amountInBase = useMemo(
    () => (fromAsset ? parseAmountToBase(amountInput, fromAsset.decimals) : null),
    [amountInput, fromAsset],
  );

  const { quoted, isQuoting } = useSwapQuote(fromDenom, toDenom, amountInBase, address);

  // Only trust a quote that matches the current inputs — while a re-quote is in
  // flight (typing, or a new block) the previous quote is stale.
  const inputsMatch =
    quoted &&
    quoted.denomIn === fromDenom &&
    quoted.denomOut === toDenom &&
    quoted.amountIn === amountInBase;
  const activeQuote = inputsMatch ? quoted!.quote : null;

  const hasRoute = !!activeQuote && !activeQuote.noRoute;

  // A quote is stale if the chain has advanced past the height it was computed at,
  // or a re-quote is in flight — execution is blocked until a fresh quote lands.
  const quoteStale =
    !!inputsMatch && !!currentHeight && quoted!.blockHeight !== currentHeight;
  const needsFreshQuote = quoteStale || isQuoting;

  const outputDisplay =
    hasRoute && toAsset
      ? uAmountToBigNumberAmount(activeQuote!.expectedOut, toAsset.decimals).toString()
      : "";

  const minReceivedDisplay =
    hasRoute && toAsset
      ? uAmountToBigNumberAmount(minOutputBase(activeQuote!.expectedOut, slippage), toAsset.decimals).toString()
      : "";

  const priceImpact = hasRoute ? Number(activeQuote!.priceImpact) : 0;
  const impactHigh = !isNaN(priceImpact) && priceImpact >= PRICE_IMPACT_ACK_THRESHOLD;

  const issue = resolveSwapIssue({
    fromDenom,
    toDenom,
    amountBase: amountInBase,
    balanceBase: fromAsset?.amount ?? "0",
    quote: activeQuote,
    pools,
  });
  const issueMsg = swapIssueMessage(issue);

  const canReview = hasRoute && !issueMsg && !!amountInBase && !!fromAsset && !!toAsset;
  const canExecute = canReview && !needsFreshQuote && !isSubmitting && (!impactHigh || impactAck);

  const handleFlip = () => {
    setFromDenom(toDenom);
    setToDenom(fromDenom);
    setAmountInput(outputDisplay || "");
  };

  const resetAfterSwap = () => {
    setAmountInput("");
    setImpactAck(false);
    setStep("form");
  };

  const handleExecute = async () => {
    if (!activeQuote || !amountInBase) return;
    const ok = await swap({
      quote: activeQuote,
      denomIn: fromDenom,
      denomOut: toDenom,
      uAmountIn: amountInBase,
      slippage,
      onConfirmed: resetAfterSwap,
    });
    // Close the confirm step on mempool acceptance; balances refresh on chain:tx.
    if (ok) resetAfterSwap();
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
      {step === "confirm" && activeQuote && toAsset && fromAsset ? (
        <VStack gap="3" align="stretch">
          <Text fontSize="md" fontWeight="semibold">
            Confirm swap
          </Text>
          <SummaryRow label="You pay" value={`${prettyAmount(amountInput)} ${fromAsset.symbol}`} />
          <SummaryRow label="You receive ≈" value={`${prettyAmount(outputDisplay)} ${toAsset.symbol}`} />
          <SummaryRow label="Minimum received" value={`${prettyAmount(minReceivedDisplay)} ${toAsset.symbol}`} />
          <SummaryRow label="Price impact" value={`${isNaN(priceImpact) ? "0" : priceImpact.toFixed(2)}%`} />
          <SummaryRow label="Route" value={`${activeQuote.routes.length} hop${activeQuote.routes.length > 1 ? "s" : ""}`} />
          <SummaryRow label="Slippage tolerance" value={`${slippage}%`} />

          {needsFreshQuote && (
            <HStack gap="2" borderWidth="1px" borderColor="orange.500/30" borderRadius="lg" p="2" bg="orange.500/8">
              <Spinner size="xs" colorPalette="orange" />
              <Text fontSize="xs" color="fg">
                A newer block arrived — re-quoting before you can execute.
              </Text>
            </HStack>
          )}

          {impactHigh && (
            <HStack as="label" gap="2" align="start" cursor="pointer">
              <input
                type="checkbox"
                checked={impactAck}
                onChange={(e) => setImpactAck(e.target.checked)}
                aria-label="Acknowledge price impact"
              />
              <Text fontSize="xs" color="red.fg">
                Price impact is {priceImpact.toFixed(2)}%. I understand I may receive
                significantly less than expected.
              </Text>
            </HStack>
          )}

          <HStack gap="2">
            <Button flex="1" variant="outline" onClick={() => setStep("form")} disabled={isSubmitting}>
              Back
            </Button>
            <Button
              flex="1"
              colorPalette="blue"
              onClick={handleExecute}
              disabled={!canExecute}
              aria-disabled={!canExecute}
            >
              {isSubmitting ? <Spinner size="sm" /> : "Confirm swap"}
            </Button>
          </HStack>
        </VStack>
      ) : (
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

          <Button
            size="lg"
            colorPalette="blue"
            onClick={() => setStep("confirm")}
            disabled={!canReview}
            aria-disabled={!canReview}
          >
            Review swap
          </Button>
        </VStack>
      )}
    </Box>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between">
      <Text fontSize="sm" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="sm" fontWeight="medium">
        {value}
      </Text>
    </HStack>
  );
}
