import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Box, Button, HStack, VStack, Text, Portal, Dialog, Field, Input, Textarea,
  NativeSelect, Spinner,
} from "@chakra-ui/react";
import { LuSend, LuTriangleAlert } from "react-icons/lu";
import type { AssetBalance } from "../../hooks/useAssets";
import { useSendTx } from "../../hooks/useSendTx";
import { EstimateTxFee, GetSpendableBalances } from "../../../wailsjs/go/main/App";
import { toBigNumber, uAmountToAmount } from "../../utils/amount";
import { denomLabel } from "../../utils/stakingHelpers";
import { TokenLogo } from "../TokenLogo";
import {
  validateRecipient, validateSendAmount, maxSendableUAmount,
  FEE_DENOM, FEE_DECIMALS, ADDRESS_PREFIX,
} from "./sendHelpers";

interface SendFormProps {
  isOpen: boolean;
  onClose: () => void;
  /** Active sender address (the `from` of the MsgSend). */
  address: string;
  /** Known assets (metadata + amounts) from the Portfolio's asset engine. */
  assets: AssetBalance[];
  /** Logo data-URL lookup for a denom. */
  logo: (denom: string) => string;
  /** Preselected denom (when opened from an asset row / detail view). */
  presetDenom?: string;
  /** Called once a sent tx confirms on-chain — refresh balances. */
  onSent?: () => void;
}

type Step = "form" | "confirm";

/** Format a base-unit ubze fee as a human "0.0024 BZE" string. */
function feeLabel(feeUbze: string): string {
  return `${uAmountToAmount(feeUbze || "0", FEE_DECIMALS)} BZE`;
}

/**
 * Send form: pick a held asset, enter a recipient and amount (with a fee-aware
 * Max), an optional memo, preview the network fee, confirm, then broadcast a
 * `MsgSend` through the shared tx pipeline (`useSendTx` → `useTx`). Spendable
 * balances (not raw balances) cap the amount, and the fee is a real estimate
 * from the tx path (`EstimateTxFee`), so what's previewed matches what's paid.
 *
 * No optimistic updates: the modal closes on broadcast acceptance and balances
 * refresh only via `onSent` (fired on on-chain confirmation) and the Portfolio's
 * own chain-event refresh.
 */
export function SendForm({ isOpen, onClose, address, assets, logo, presetDenom, onSent }: SendFormProps) {
  const { send, isSubmitting } = useSendTx(address);

  const [denom, setDenom] = useState(presetDenom ?? "");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [bypassSelfSend, setBypassSelfSend] = useState(false);

  const [spendable, setSpendable] = useState<Record<string, string>>({});
  const [spendableError, setSpendableError] = useState<string | null>(null);

  const [feeUbze, setFeeUbze] = useState("");
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeError, setFeeError] = useState(false);

  // The assets that can actually be sent: known assets with a positive spendable
  // balance, native first then alphabetical — the denom picker's options.
  const sendable = useMemo(() => {
    return assets
      .filter((a) => toBigNumber(spendable[a.denom] || "0").gt(0))
      .sort((a, b) => {
        if (a.type === "native" && b.type !== "native") return -1;
        if (b.type === "native" && a.type !== "native") return 1;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [assets, spendable]);

  const selected = useMemo(() => assets.find((a) => a.denom === denom), [assets, denom]);
  const decimals = selected?.decimals ?? 6;
  const symbol = selected?.symbol ?? denomLabel(denom);
  const spendableU = spendable[denom] || "0";
  const feeSpendableU = spendable[FEE_DENOM] || "0";

  // Reset the form each time it opens; preselect the requested denom.
  useEffect(() => {
    if (!isOpen) return;
    setDenom(presetDenom ?? "");
    setRecipient("");
    setAmount("");
    setMemo("");
    setStep("form");
    setBypassSelfSend(false);
    setFeeUbze("");
    setFeeError(false);
  }, [isOpen, presetDenom]);

  // Load spendable balances (the send ceiling) whenever the form opens.
  useEffect(() => {
    if (!isOpen || !address) return;
    let cancelled = false;
    setSpendableError(null);
    GetSpendableBalances(address)
      .then((res) => {
        if (!cancelled) setSpendable(res ?? {});
      })
      .catch((err) => {
        if (!cancelled) setSpendableError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, address]);

  // Once balances are in, default the denom to the highest-priority sendable asset
  // if none was preselected (or the preselected one can't be sent).
  useEffect(() => {
    if (!isOpen || sendable.length === 0) return;
    const stillValid = denom && sendable.some((a) => a.denom === denom);
    if (!stillValid) setDenom(sendable[0].denom);
  }, [isOpen, sendable, denom]);

  // Estimate the fee for the current denom/memo. MsgSend gas is independent of the
  // amount and recipient value, so a self-addressed placeholder simulates the same
  // gas — giving a stable preview and enabling the fee-aware Max immediately.
  // Debounced so typing a memo doesn't fire a simulation per keystroke.
  useEffect(() => {
    if (!isOpen || !address || !denom) return;
    let cancelled = false;
    setFeeLoading(true);
    const timer = setTimeout(() => {
      const msg = {
        "@type": "/cosmos.bank.v1beta1.MsgSend",
        from_address: address,
        to_address: address,
        amount: [{ denom, amount: "1" }],
      };
      EstimateTxFee(address, JSON.stringify([msg]), memo.trim())
        .then((res) => {
          if (cancelled) return;
          setFeeUbze(String(res?.amount ?? ""));
          setFeeError(false);
        })
        .catch(() => {
          if (cancelled) return;
          setFeeUbze("");
          setFeeError(true);
        })
        .finally(() => {
          if (!cancelled) setFeeLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, address, denom, memo]);

  const recipientCheck = useMemo(
    () => validateRecipient(recipient, address),
    [recipient, address]
  );
  const amountCheck = useMemo(
    () => validateSendAmount({ amount, denom, decimals, spendableU, feeUbze, feeSpendableU, symbol }),
    [amount, denom, decimals, spendableU, feeUbze, feeSpendableU, symbol]
  );

  const selfSendBlocked = recipientCheck.selfSend && !bypassSelfSend;
  const canReview =
    !!denom && recipientCheck.valid && amountCheck.valid && !selfSendBlocked;

  const handleMax = useCallback(() => {
    const max = maxSendableUAmount(spendableU, denom === FEE_DENOM, feeUbze);
    setAmount(uAmountToAmount(max, decimals));
  }, [spendableU, denom, feeUbze, decimals]);

  const handleConfirm = useCallback(async () => {
    if (!canReview) return;
    const ok = await send({
      to: recipient.trim(),
      denom,
      uAmount: amountCheck.uAmount,
      memo: memo.trim(),
      onConfirmed: onSent,
    });
    // Broadcast accepted → close; the toast tracks confirmation. On rejection stay
    // open so the user can adjust and retry (useTx has already shown the error).
    if (ok) onClose();
  }, [canReview, send, recipient, denom, amountCheck.uAmount, memo, onSent, onClose]);

  // Only surface the recipient error once something's been typed.
  const recipientInvalid = recipient.trim().length > 0 && !recipientCheck.valid;
  // Only surface the amount error once something's been typed.
  const amountInvalid = amount.trim().length > 0 && !amountCheck.valid;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e: { open: boolean }) => !e.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="440px" borderRadius="xl">
            <Dialog.Header>
              <Dialog.Title fontWeight="bold">
                {step === "form" ? "Send" : "Confirm transfer"}
              </Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              {spendableError ? (
                <VStack gap="3" py="4" align="stretch">
                  <Text color="red.500" fontSize="sm">Couldn't load your spendable balances.</Text>
                  <Text color="fg.muted" fontSize="xs">{spendableError}</Text>
                </VStack>
              ) : step === "form" ? (
                <VStack gap="4" align="stretch">
                  {/* Asset */}
                  <Field.Root>
                    <Field.Label>Asset</Field.Label>
                    <HStack gap="2" w="full">
                      {denom && <TokenLogo src={logo(denom)} symbol={symbol} size="8" />}
                      <NativeSelect.Root size="sm" flex="1" disabled={sendable.length === 0}>
                        <NativeSelect.Field
                          data-testid="send-denom"
                          value={denom}
                          onChange={(e) => setDenom(e.target.value)}
                        >
                          {sendable.length === 0 && <option value="">No sendable assets</option>}
                          {sendable.map((a) => (
                            <option key={a.denom} value={a.denom}>
                              {a.symbol} — {denomLabel(a.denom)}
                            </option>
                          ))}
                        </NativeSelect.Field>
                      </NativeSelect.Root>
                    </HStack>
                  </Field.Root>

                  {/* Recipient */}
                  <Field.Root invalid={recipientInvalid}>
                    <Field.Label>Recipient</Field.Label>
                    <Input
                      data-testid="send-recipient"
                      size="sm"
                      fontFamily="mono"
                      placeholder={`${ADDRESS_PREFIX}1…`}
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                    {recipientInvalid && <Field.ErrorText>{recipientCheck.error}</Field.ErrorText>}
                    {recipientCheck.selfSend && (
                      <HStack gap="2" mt="1" color="orange.500" fontSize="xs" align="flex-start">
                        {LuTriangleAlert({ size: 14 }) as React.ReactNode}
                        <Text>
                          This is your own address. You can still send, but it's rarely intended.{" "}
                          <Text
                            as="span"
                            textDecoration="underline"
                            cursor="pointer"
                            onClick={() => setBypassSelfSend(true)}
                          >
                            {bypassSelfSend ? "Acknowledged" : "Send anyway"}
                          </Text>
                        </Text>
                      </HStack>
                    )}
                  </Field.Root>

                  {/* Amount */}
                  <Field.Root invalid={amountInvalid}>
                    <HStack justify="space-between" w="full">
                      <Field.Label>Amount</Field.Label>
                      <Text fontSize="xs" color="fg.muted">
                        Spendable: {uAmountToAmount(spendableU, decimals)} {symbol}
                      </Text>
                    </HStack>
                    <HStack gap="2" w="full">
                      <Input
                        data-testid="send-amount"
                        size="sm"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleMax}
                        disabled={toBigNumber(spendableU).lte(0)}
                      >
                        Max
                      </Button>
                    </HStack>
                    {amountInvalid && <Field.ErrorText>{amountCheck.error}</Field.ErrorText>}
                  </Field.Root>

                  {/* Memo */}
                  <Field.Root>
                    <Field.Label>Memo (optional)</Field.Label>
                    <Textarea
                      data-testid="send-memo"
                      size="sm"
                      rows={2}
                      placeholder="Note attached to the transaction"
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                    />
                  </Field.Root>

                  {/* Fee preview */}
                  <HStack justify="space-between" fontSize="sm">
                    <Text color="fg.muted">Network fee</Text>
                    {feeLoading && !feeUbze ? (
                      <Text color="fg.muted">Estimating…</Text>
                    ) : feeError ? (
                      <Text color="fg.muted">Calculated at signing</Text>
                    ) : (
                      <Text data-testid="send-fee" fontWeight="medium">{feeLabel(feeUbze)}</Text>
                    )}
                  </HStack>
                </VStack>
              ) : (
                /* Confirm step */
                <VStack gap="3" align="stretch">
                  <Text fontSize="sm" color="fg.muted">
                    Review the details below. This transfer is irreversible once confirmed.
                  </Text>
                  <SummaryRow label="Amount">
                    <HStack gap="2">
                      <TokenLogo src={logo(denom)} symbol={symbol} size="5" />
                      <Text fontWeight="semibold">
                        {uAmountToAmount(amountCheck.uAmount, decimals)} {symbol}
                      </Text>
                    </HStack>
                  </SummaryRow>
                  <SummaryRow label="To">
                    <Text fontFamily="mono" fontSize="sm" wordBreak="break-all" textAlign="right">
                      {recipient.trim()}
                    </Text>
                  </SummaryRow>
                  <SummaryRow label="Network fee">
                    <Text fontSize="sm">{feeError ? "Calculated at signing" : feeLabel(feeUbze)}</Text>
                  </SummaryRow>
                  {memo.trim() && (
                    <SummaryRow label="Memo">
                      <Text fontSize="sm" wordBreak="break-word" textAlign="right">{memo.trim()}</Text>
                    </SummaryRow>
                  )}
                </VStack>
              )}
            </Dialog.Body>

            <Dialog.Footer>
              {step === "form" ? (
                <HStack gap="3" width="full">
                  <Button flex="1" variant="outline" onClick={onClose}>Cancel</Button>
                  <Button
                    flex="1"
                    colorPalette="teal"
                    disabled={!canReview}
                    onClick={() => setStep("confirm")}
                  >
                    <HStack gap="2">
                      {LuSend({ size: 16 }) as React.ReactNode}
                      <Text>Review</Text>
                    </HStack>
                  </Button>
                </HStack>
              ) : (
                <HStack gap="3" width="full">
                  <Button flex="1" variant="outline" onClick={() => setStep("form")} disabled={isSubmitting}>
                    Back
                  </Button>
                  <Button
                    flex="1"
                    colorPalette="teal"
                    onClick={handleConfirm}
                    disabled={isSubmitting || !canReview}
                  >
                    {isSubmitting ? <Spinner size="sm" /> : <Text>Confirm & Send</Text>}
                  </Button>
                </HStack>
              )}
            </Dialog.Footer>

            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** A label/value row in the confirmation summary. */
function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <HStack justify="space-between" align="flex-start" gap="4">
      <Text fontSize="sm" color="fg.muted" flexShrink={0}>{label}</Text>
      <Box>{children}</Box>
    </HStack>
  );
}
