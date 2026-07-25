import { useState, useEffect } from "react";
import {
  Box,
  Button,
  HStack,
  Text,
  VStack,
  Portal,
  Dialog,
} from "@chakra-ui/react";
import { LuCopy, LuCheck } from "react-icons/lu";
import { QRCodeSVG } from "qrcode.react";

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The active account's bech32 address — the value shown, copied and encoded. */
  address: string;
}

/**
 * Receive modal: shows the active account's address with a copy-to-clipboard
 * button and a QR code of that same address. The QR is generated locally
 * (qrcode.react → inline SVG, no network). Address only — no amount-request in
 * v1. Because `address` is a prop, switching the active account re-renders the
 * shown address and QR in place.
 */
export function ReceiveModal({ isOpen, onClose, address }: ReceiveModalProps) {
  const [copied, setCopied] = useState(false);

  // Reset the "copied" feedback whenever the modal opens or the address changes.
  useEffect(() => {
    setCopied(false);
  }, [isOpen, address]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e: { open: boolean }) => !e.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="380px" borderRadius="xl">
            <Dialog.Header>
              <Dialog.Title fontWeight="bold">Receive</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <VStack gap="5" align="stretch">
                <Text fontSize="sm" color="fg.muted">
                  Share this address or QR code to receive assets on the BeeZee
                  network.
                </Text>

                {/* QR code — white padded card so it scans in dark mode too. */}
                <Box alignSelf="center" bg="white" p="4" borderRadius="lg">
                  <QRCodeSVG
                    data-testid="receive-qr"
                    value={address}
                    size={200}
                    marginSize={0}
                    level="M"
                    title="Wallet address QR code"
                  />
                </Box>

                {/* Address + copy */}
                <Box>
                  <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="1">
                    Your address
                  </Text>
                  <HStack
                    gap="2"
                    p="3"
                    bg="bg.subtle"
                    borderRadius="md"
                    align="flex-start"
                  >
                    <Text
                      flex="1"
                      fontSize="sm"
                      fontFamily="mono"
                      wordBreak="break-all"
                    >
                      {address}
                    </Text>
                  </HStack>
                </Box>
              </VStack>
            </Dialog.Body>

            <Dialog.Footer>
              <HStack gap="3" width="full">
                <Button flex="1" variant="outline" onClick={onClose}>
                  Close
                </Button>
                <Button
                  flex="1"
                  colorPalette="teal"
                  onClick={handleCopy}
                  disabled={!address}
                >
                  <HStack gap="2">
                    {copied
                      ? (LuCheck({}) as React.ReactNode)
                      : (LuCopy({}) as React.ReactNode)}
                    <Text>{copied ? "Copied!" : "Copy address"}</Text>
                  </HStack>
                </Button>
              </HStack>
            </Dialog.Footer>

            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
