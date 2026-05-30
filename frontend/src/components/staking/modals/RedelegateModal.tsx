import { useState, useMemo } from "react";
import {
  Box,
  Button,
  HStack,
  Input,
  Text,
  VStack,
  Portal,
  Dialog,
  NativeSelect,
} from "@chakra-ui/react";
import { humanToUbze, ubzeToHuman, formatAmount } from "../../../utils/stakingHelpers";
import { useStakingTx } from "../../../hooks/useStakingTx";
import type { Validator } from "../../../utils/stakingTypes";

interface RedelegateModalProps {
  isOpen: boolean;
  onClose: () => void;
  srcValidatorAddress: string;
  srcValidatorMoniker: string;
  delegatedAmount: string; // ubze
  validators: Validator[];
  address: string;
  onSuccess: () => void;
}

export function RedelegateModal({
  isOpen,
  onClose,
  srcValidatorAddress,
  srcValidatorMoniker,
  delegatedAmount,
  validators,
  address,
  onSuccess,
}: RedelegateModalProps) {
  const [amount, setAmount] = useState("");
  const [dstValidator, setDstValidator] = useState("");
  const [error, setError] = useState("");
  const { redelegate, isSubmitting } = useStakingTx(address);

  const otherValidators = useMemo(
    () => validators.filter(
      (v) => v.operator_address !== srcValidatorAddress && v.status === "BOND_STATUS_BONDED"
    ),
    [validators, srcValidatorAddress]
  );

  const handleClose = () => {
    if (isSubmitting) return;
    setAmount("");
    setDstValidator("");
    setError("");
    onClose();
  };

  const handleRedelegate = async () => {
    if (!dstValidator) {
      setError("Please select a destination validator");
      return;
    }

    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    const ubze = humanToUbze(amount);
    if (BigInt(ubze) > BigInt(delegatedAmount)) {
      setError("Amount exceeds delegation");
      return;
    }

    setError("");
    const success = await redelegate(srcValidatorAddress, dstValidator, ubze);
    if (success) {
      handleClose();
      onSuccess();
    } else {
      setError("Transaction failed");
    }
  };

  const handleMax = () => {
    setAmount(ubzeToHuman(delegatedAmount));
    setError("");
  };

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(e: { open: boolean }) => !isSubmitting && !e.open && handleClose()}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="450px" borderRadius="xl">
            <Dialog.Header>
              <Dialog.Title fontWeight="bold">Redelegate</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <VStack gap="4" align="stretch">
                <Box p="3" bg="bg.subtle" borderRadius="md">
                  <Text fontSize="xs" color="fg.muted">From</Text>
                  <Text fontSize="sm" fontWeight="medium">{srcValidatorMoniker}</Text>
                  <HStack justify="space-between" mt="1">
                    <Text fontSize="xs" color="fg.muted">Delegated</Text>
                    <Text fontSize="xs" fontWeight="medium">
                      {formatAmount(ubzeToHuman(delegatedAmount))} BZE
                    </Text>
                  </HStack>
                </Box>

                <Box>
                  <Text fontSize="sm" fontWeight="medium" mb="2">
                    To Validator
                  </Text>
                  <NativeSelect.Root size="sm" disabled={isSubmitting}>
                    <NativeSelect.Field
                      value={dstValidator}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                        setDstValidator(e.target.value);
                        setError("");
                      }}
                    >
                      <option value="">Select validator...</option>
                      {otherValidators.map((v) => (
                        <option key={v.operator_address} value={v.operator_address}>
                          {v.description.moniker} ({(parseFloat(v.commission.commission_rates.rate) * 100).toFixed(1)}% commission)
                        </option>
                      ))}
                    </NativeSelect.Field>
                  </NativeSelect.Root>
                </Box>

                <Box>
                  <Text fontSize="sm" fontWeight="medium" mb="2">
                    Amount (BZE)
                  </Text>
                  <HStack gap="2">
                    <Input
                      size="lg"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setAmount(e.target.value);
                        setError("");
                      }}
                      disabled={isSubmitting}
                    />
                    <Button size="lg" variant="outline" onClick={handleMax} disabled={isSubmitting}>
                      MAX
                    </Button>
                  </HStack>
                  {error && (
                    <Text fontSize="xs" color="red.500" mt="1">{error}</Text>
                  )}
                </Box>
              </VStack>
            </Dialog.Body>

            <Dialog.Footer>
              <HStack gap="3" width="full">
                <Button flex="1" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  flex="1"
                  colorPalette="teal"
                  onClick={handleRedelegate}
                  loading={isSubmitting}
                  disabled={!amount || !dstValidator || isSubmitting}
                >
                  Redelegate
                </Button>
              </HStack>
            </Dialog.Footer>

            <Dialog.CloseTrigger disabled={isSubmitting} />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
