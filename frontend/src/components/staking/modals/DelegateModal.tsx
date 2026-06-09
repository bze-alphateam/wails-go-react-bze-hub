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
import { humanToUbze } from "../../../utils/stakingHelpers";
import { useStakingTx } from "../../../hooks/useStakingTx";

interface DelegateModalProps {
  isOpen: boolean;
  onClose: () => void;
  validatorAddress: string;
  validatorMoniker: string;
  address: string;
  onSuccess: () => void;
}

export function DelegateModal({
  isOpen,
  onClose,
  validatorAddress,
  validatorMoniker,
  address,
  onSuccess,
}: DelegateModalProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const { delegate, isSubmitting } = useStakingTx(address);

  const handleClose = () => {
    if (isSubmitting) return;
    setAmount("");
    setError("");
    onClose();
  };

  const handleDelegate = async () => {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    const ubze = humanToUbze(amount);
    setError("");
    // The outcome (success + explorer link, or failure + raw_log) surfaces as a
    // global toast; close the modal once the tx is submitted.
    const success = await delegate(validatorAddress, ubze);
    if (success) {
      onSuccess();
      handleClose();
    }
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
              <Dialog.Title fontWeight="bold">Delegate to Validator</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <VStack gap="4" align="stretch">
                <Box p="3" bg="bg.subtle" borderRadius="md">
                  <Text fontSize="xs" color="fg.muted">Validator</Text>
                  <Text fontSize="sm" fontWeight="medium">{validatorMoniker}</Text>
                  <Text fontSize="xs" color="fg.muted">{validatorAddress}</Text>
                </Box>

                <Box>
                  <Text fontSize="sm" fontWeight="medium" mb="2">
                    Amount (BZE)
                  </Text>
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
                  onClick={handleDelegate}
                  loading={isSubmitting}
                  disabled={!amount || isSubmitting}
                >
                  Delegate
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
