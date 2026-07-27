import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, VStack, HStack, Text, Button, Input, Spinner } from "@chakra-ui/react";
import {
  EstimateTxFee,
  GetSpendableBalances,
  ValidateOrderInput,
} from "../../../../wailsjs/go/main/App";
import { useOrderTx } from "../../../hooks/useOrderTx";
import {
  amountToBigNumberUAmount,
  priceToUPrice,
  prettyAmount,
  toBigNumber,
  uAmountToAmount,
} from "../../../utils/amount";
import { sanitizeAmountInput } from "../swapHelpers";
import {
  amountFromPriceTotal,
  shortcutBaseAmount,
  summarizeOrder,
  totalFromPriceAmount,
  type OrderSummary,
} from "./orderHelpers";
import type { ResolveAsset } from "./marketHelpers";

interface OrderFormProps {
  marketId: string;
  base: string;
  quote: string;
  address: string;
  resolve: ResolveAsset;
  /** Display price selected from the orderbook (BHUB-27); prefills the price field. */
  selectedPrice: string | null;
  /** Called after an order is confirmed on-chain — refresh my-orders. */
  onOrderPlaced?: () => void;
}

type Side = "buy" | "sell";
const FRACTIONS: Array<{ label: string; value: number }> = [
  { label: "25%", value: 0.25 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "Max", value: 1 },
];

/**
 * The buy/sell order form: price / amount / total (each computes the others),
 * balance shortcuts (fee-aware Max), inline validation via the chain-mirrored
 * ValidateOrderInput binding, and a review → confirm → broadcast flow. The price
 * prefills from an orderbook click. Nothing is optimistic — balances/my-orders
 * refresh only after on-chain confirmation.
 */
export function OrderForm({
  marketId,
  base,
  quote,
  address,
  resolve,
  selectedPrice,
  onOrderPlaced,
}: OrderFormProps) {
  const { buildOrder, placeOrder, isSubmitting } = useOrderTx(address);

  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [total, setTotal] = useState("");
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [feeUbze, setFeeUbze] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [builtMsgs, setBuiltMsgs] = useState<Array<Record<string, unknown>>>([]);
  const [summary, setSummary] = useState<OrderSummary | null>(null);

  const baseDecimals = resolve(base)?.decimals ?? 6;
  const quoteDecimals = resolve(quote)?.decimals ?? 6;
  const baseSym = resolve(base)?.symbol ?? base;
  const quoteSym = resolve(quote)?.symbol ?? quote;
  const isBuy = side === "buy";

  // Prefill price from an orderbook selection.
  useEffect(() => {
    if (selectedPrice) {
      setPrice(selectedPrice);
      setTotal((prevTotal) => (amount ? totalFromPriceAmount(selectedPrice, amount) : prevTotal));
    }
  }, [selectedPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spendable balances for the shortcuts / max.
  useEffect(() => {
    if (!address) return;
    GetSpendableBalances(address)
      .then((b) => setBalances(b ?? {}))
      .catch(() => setBalances({}));
  }, [address, marketId]);

  // A representative fee estimate for the fee-aware Max (order gas is roughly
  // constant per message; a single-order estimate is a safe buffer).
  useEffect(() => {
    if (!address) return;
    const placeholder = {
      "@type": "/bze.tradebin.MsgCreateOrder",
      creator: address,
      order_type: "buy",
      amount: "1",
      price: "1",
      market_id: marketId,
    };
    EstimateTxFee(address, JSON.stringify([placeholder]), "")
      .then((res) => setFeeUbze(res?.amount ?? ""))
      .catch(() => setFeeUbze(""));
  }, [address, marketId]);

  const uAmount = useMemo(
    () => (amount ? amountToBigNumberUAmount(amount, baseDecimals).toFixed(0) : ""),
    [amount, baseDecimals],
  );
  const uPrice = useMemo(
    () => (price ? priceToUPrice(toBigNumber(price), quoteDecimals, baseDecimals) : ""),
    [price, quoteDecimals, baseDecimals],
  );

  // Inline validation, debounced, via the chain-mirrored binding.
  const validateSeq = useRef(0);
  useEffect(() => {
    if (!uAmount || !uPrice || toBigNumber(uAmount).lte(0)) {
      setValidationError(null);
      return;
    }
    const seq = ++validateSeq.current;
    const t = setTimeout(() => {
      ValidateOrderInput(marketId, isBuy, uAmount, uPrice)
        .then(() => {
          if (seq === validateSeq.current) setValidationError(null);
        })
        .catch((e) => {
          if (seq === validateSeq.current) setValidationError(String(e));
        });
    }, 300);
    return () => clearTimeout(t);
  }, [uAmount, uPrice, isBuy, marketId]);

  const shortcut = useCallback(
    (fraction: number) => {
      const amt = shortcutBaseAmount({
        fraction,
        isBuy,
        price,
        base,
        quote,
        baseDecimals,
        quoteDecimals,
        spendableBaseU: balances[base] ?? "0",
        spendableQuoteU: balances[quote] ?? "0",
        feeUbze,
      });
      if (amt === "") return;
      setAmount(amt);
      setTotal(totalFromPriceAmount(price, amt));
    },
    [isBuy, price, base, quote, baseDecimals, quoteDecimals, balances, feeUbze],
  );

  const canReview =
    !!uAmount && toBigNumber(uAmount).gt(0) && !!uPrice && !validationError && step === "form";

  const handleReview = async () => {
    const msgs = await buildOrder(marketId, isBuy, uAmount, uPrice);
    setBuiltMsgs(msgs);
    setSummary(summarizeOrder(msgs, uPrice));
    setStep("confirm");
  };

  const reset = () => {
    setAmount("");
    setTotal("");
    setBuiltMsgs([]);
    setSummary(null);
    setStep("form");
  };

  const handleConfirm = async () => {
    const ok = await placeOrder(builtMsgs, () => onOrderPlaced?.());
    if (ok) reset();
  };

  if (!address) {
    return (
      <Box borderWidth="1px" borderRadius="lg" p="4">
        <Text fontSize="sm" color="fg.muted">
          Connect a wallet to trade.
        </Text>
      </Box>
    );
  }

  return (
    <Box borderWidth="1px" borderRadius="lg" p="4">
      {step === "form" ? (
        <VStack gap="3" align="stretch">
          {/* Buy / Sell */}
          <HStack gap="0" borderWidth="1px" borderRadius="md" overflow="hidden">
            <SideButton label="Buy" active={isBuy} palette="green" onClick={() => setSide("buy")} />
            <SideButton label="Sell" active={!isBuy} palette="red" onClick={() => setSide("sell")} />
          </HStack>

          <Field label={`Price (${quoteSym})`}>
            <Input
              size="sm"
              variant="subtle"
              inputMode="decimal"
              placeholder="0.0"
              value={price}
              onChange={(e) => {
                const v = sanitizeAmountInput(e.target.value);
                setPrice(v);
                setTotal(totalFromPriceAmount(v, amount));
              }}
              aria-label="Order price"
            />
          </Field>

          <Field label={`Amount (${baseSym})`}>
            <Input
              size="sm"
              variant="subtle"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => {
                const v = sanitizeAmountInput(e.target.value);
                setAmount(v);
                setTotal(totalFromPriceAmount(price, v));
              }}
              aria-label="Order amount"
            />
          </Field>

          <HStack gap="1">
            {FRACTIONS.map((f) => (
              <Button key={f.label} size="xs" variant="outline" flex="1" onClick={() => shortcut(f.value)}>
                {f.label}
              </Button>
            ))}
          </HStack>

          <Field label={`Total (${quoteSym})`}>
            <Input
              size="sm"
              variant="subtle"
              inputMode="decimal"
              placeholder="0.0"
              value={total}
              onChange={(e) => {
                const v = sanitizeAmountInput(e.target.value);
                setTotal(v);
                setAmount(amountFromPriceTotal(price, v));
              }}
              aria-label="Order total"
            />
          </Field>

          {validationError && (
            <Text fontSize="xs" color="red.fg">
              {validationError}
            </Text>
          )}

          <Button
            colorPalette={isBuy ? "green" : "red"}
            disabled={!canReview}
            aria-disabled={!canReview}
            onClick={handleReview}
          >
            {isBuy ? "Buy" : "Sell"} {baseSym}
          </Button>
        </VStack>
      ) : (
        <VStack gap="3" align="stretch">
          <Text fontWeight="semibold">Review {isBuy ? "buy" : "sell"} order</Text>
          <SummaryRow label="Price" value={`${prettyAmount(price)} ${quoteSym}`} />
          <SummaryRow label="Amount" value={`${prettyAmount(amount)} ${baseSym}`} />
          <SummaryRow label={isBuy ? "You pay ≈" : "You receive ≈"} value={`${prettyAmount(total || "0")} ${quoteSym}`} />
          {summary && (
            <Text fontSize="sm" color="fg.muted">
              {summary.fillLevels === 0
                ? `Places a limit order at ${prettyAmount(price)} ${quoteSym}.`
                : summary.hasLeftover
                  ? `Fills ${summary.fillLevels} price level${summary.fillLevels > 1 ? "s" : ""}, then rests ${prettyAmount(uAmountToAmount(summary.leftoverUAmount, baseDecimals))} ${baseSym} as a limit order at ${prettyAmount(price)} ${quoteSym}.`
                  : `Fills ${summary.fillLevels} price level${summary.fillLevels > 1 ? "s" : ""} — fully matched, nothing rests.`}
            </Text>
          )}
          <HStack gap="2">
            <Button flex="1" variant="outline" onClick={() => setStep("form")} disabled={isSubmitting}>
              Back
            </Button>
            <Button
              flex="1"
              colorPalette={isBuy ? "green" : "red"}
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Spinner size="sm" /> : "Confirm"}
            </Button>
          </HStack>
        </VStack>
      )}
    </Box>
  );
}

function SideButton({
  label,
  active,
  palette,
  onClick,
}: {
  label: string;
  active: boolean;
  palette: string;
  onClick: () => void;
}) {
  return (
    <Button
      flex="1"
      size="sm"
      borderRadius="0"
      variant={active ? "subtle" : "ghost"}
      colorPalette={active ? palette : "gray"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text fontSize="xs" color="fg.muted" mb="1">
        {label}
      </Text>
      {children}
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
