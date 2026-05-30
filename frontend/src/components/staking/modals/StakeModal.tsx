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
import {
  scoreValidators,
  selectTopValidators,
} from "../../../utils/validatorScoring";
import type { Validator } from "../../../utils/stakingTypes";

interface StakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStake: (ubzeAmount: string) => Promise<boolean>;
  isSubmitting: boolean;
  validators: Validator[];
}

export function StakeModal({
  isOpen,
  onClose,
  onStake,
  isSubmitting,
  validators,
}: StakeModalProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const handleClose = () => {
    if (isSubmitting) return;
    setAmount("");
    setError("");
    onClose();
  };

  const handleStake = async () => {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    const ubze = humanToUbze(amount);
    if (BigInt(ubze) <= 0n) {
      setError("Amount too small");
      return;
    }

    setError("");
    const success = await onStake(ubze);
    if (success) {
      setAmount("");
      handleClose();
    }
  };

  // Preview which validators will be selected
  const scores = scoreValidators(validators);
  const top = selectTopValidators(scores);

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
              <Dialog.Title fontWeight="bold">Stake BZE</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <VStack gap="4" align="stretch">
                {/* Info */}
                <Box p="3" bg="teal.50" _dark={{ bg: "teal.950/30" }} borderRadius="md">
                  <Text fontSize="xs" color="teal.700" _dark={{ color: "teal.300" }}>
                    Your stake will be automatically split across {top.length} top
                    validators with the lowest voting power for optimal
                    decentralization.
                  </Text>
                </Box>

                {/* Amount Input */}
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
                    <Text fontSize="xs" color="red.500" mt="1">
                      {error}
                    </Text>
                  )}
                </Box>

                {/* Validator Preview */}
                {top.length > 0 && (
                  <Box>
                    <Text fontSize="xs" color="fg.muted" mb="2">
                      Selected validators:
                    </Text>
                    {top.map((v) => (
                      <HStack key={v.operatorAddress} justify="space-between" mb="1">
                        <Text fontSize="xs">{v.moniker}</Text>
                        <Text fontSize="xs" color="fg.muted">
                          {amount ? (parseFloat(amount) / top.length).toFixed(2) : "—"} BZE
                        </Text>
                      </HStack>
                    ))}
                  </Box>
                )}
              </VStack>
            </Dialog.Body>

            <Dialog.Footer>
              <HStack gap="3" width="full">
                <Button
                  flex="1"
                  variant="outline"
                  onClick={handleClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  flex="1"
                  colorPalette="teal"
                  onClick={handleStake}
                  loading={isSubmitting}
                  disabled={!amount || isSubmitting}
                >
                  Stake
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
