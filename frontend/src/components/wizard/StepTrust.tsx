import { useState } from "react";
import { VStack, Heading, Text, Button, Box, HStack } from "@chakra-ui/react";
import { LuShield, LuShieldOff } from "react-icons/lu";

interface Props {
  onComplete: (trusted: boolean) => void;
  onBack: () => void;
  loading: boolean;
}

export function StepTrust({ onComplete, onBack, loading }: Props) {
  const [trusted, setTrusted] = useState<boolean | null>(null);

  return (
    <VStack gap="6">
      <Heading size="lg">Device Trust</Heading>

      <Text fontSize="sm" color="fg.muted" textAlign="center">
        Do you want BZE Hub to remember your wallet on this device?
      </Text>

      <Text fontSize="sm" fontWeight="bold" textAlign="center">
        Your private keys and recovery phrase are never stored in plain text, regardless of which option you choose.
      </Text>

      <VStack gap="3" w="full">
        <Box
          as="button"
          w="full"
          p="4"
          borderWidth="2px"
          borderColor={trusted === true ? "teal.500" : "border"}
          borderRadius="lg"
          textAlign="left"
          bg={trusted === true ? "teal.50" : "transparent"}
          _dark={trusted === true ? { bg: "teal.900/20" } : {}}
          _hover={{ borderColor: "teal.500" }}
          onClick={() => setTrusted(true)}
          cursor="pointer"
        >
          <HStack gap="3">
            {LuShield({}) as React.ReactNode}
            <Box>
              <Text fontWeight="semibold">Remember me (recommended)</Text>
              <Text fontSize="sm" color="fg.muted">
                Your wallet name and public address are stored locally so the app opens ready to use.
                Signing still requires authentication.
              </Text>
            </Box>
          </HStack>
        </Box>

        <Box
          as="button"
          w="full"
          p="4"
          borderWidth="2px"
          borderColor={trusted === false ? "teal.500" : "border"}
          borderRadius="lg"
          textAlign="left"
          bg={trusted === false ? "teal.50" : "transparent"}
          _dark={trusted === false ? { bg: "teal.900/20" } : {}}
          _hover={{ borderColor: "teal.500" }}
          onClick={() => setTrusted(false)}
          cursor="pointer"
        >
          <HStack gap="3">
            {LuShieldOff({}) as React.ReactNode}
            <Box>
              <Text fontWeight="semibold">Don't remember me</Text>
              <Text fontSize="sm" color="fg.muted">
                No wallet data stored locally at all. You'll need to authenticate every
                time you open the app. More secure if others access this device.
              </Text>
            </Box>
          </HStack>
        </Box>
      </VStack>

      <Text fontSize="xs" color="fg.muted" textAlign="center">
        You can change this setting later in the Dashboard.
      </Text>

      <HStack w="full" gap="3" justify="space-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          colorPalette="teal"
          disabled={trusted === null || loading}
          loading={loading}
          onClick={() => trusted !== null && onComplete(trusted)}
        >
          Continue
        </Button>
      </HStack>
    </VStack>
  );
}
