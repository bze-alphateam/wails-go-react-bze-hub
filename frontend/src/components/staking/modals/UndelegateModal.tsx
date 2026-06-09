import { useState } from "react";
import {
  Box,
  Button,
  HStack,
  Input,
  Text,
  VStack,
  Portal,
  Dialog,
} from "@chakra-ui/react";
import { humanToUbze, ubzeToHuman, formatAmount } from "../../../utils/stakingHelpers";
import { useStakingTx } from "../../../hooks/useStakingTx";

interface UndelegateModalProps {
  isOpen: boolean;
  onClose: () => void;
  validatorAddress: string;
  validatorMoniker: string;
  delegatedAmount: string; // ubze
  unbondingDays: number;
  address: string;
  onSuccess: () => void;
}

export function UndelegateModal({
  isOpen,
  onClose,
  validatorAddress,
  validatorMoniker,
  delegatedAmount,
  unbondingDays,
  address,
  onSuccess,
}: UndelegateModalProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const { undelegate, isSubmitting } = useStakingTx(address);

  const handleClose = () => {
    if (isSubmitting) return;
    setAmount("");
    setError("");
    onClose();
  };

  const handleUndelegate = async () => {
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
    // Outcome surfaces as a global toast; close the modal once submitted.
    const success = await undelegate(validatorAddress, ubze);
    if (success) {
      onSuccess();
      handleClose();
    }
  };

  const handleMax = () => {
    setAmount(ubzeToHuman(delegatedAmount));
    setError("");
  };

  const delegatedHuman = formatAmount(ubzeToHuman(delegatedAmount));

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
              <Dialog.Title fontWeight="bold">Undelegate</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <VStack gap="4" align="stretch">
                {/* Warning */}
                <Box p="3" bg="orange.50" _dark={{ bg: "orange.950/30" }} borderRadius="md">
                  <Text fontSize="xs" color="orange.700" _dark={{ color: "orange.300" }}>
                    Undelegated tokens will be locked for {unbondingDays} days before becoming available.
                  </Text>
                </Box>

                <Box p="3" bg="bg.subtle" borderRadius="md">
                  <Text fontSize="xs" color="fg.muted">Validator</Text>
                  <Text fontSize="sm" fontWeight="medium">{validatorMoniker}</Text>
                  <HStack justify="space-between" mt="1">
                    <Text fontSize="xs" color="fg.muted">Delegated</Text>
                    <Text fontSize="xs" fontWeight="medium">{delegatedHuman} BZE</Text>
                  </HStack>
                </Box>

                <Box>
                  <Text fontSize="sm" fontWeight="medium" mb="2">
                    Amount to Undelegate (BZE)
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
                  colorPalette="orange"
                  onClick={handleUndelegate}
                  loading={isSubmitting}
                  disabled={!amount || isSubmitting}
                >
                  Undelegate
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
