import { useState } from "react";
import { VStack, Heading, Text, Button, Box, SimpleGrid, Checkbox, HStack } from "@chakra-ui/react";
import { LuCopy, LuCheck } from "react-icons/lu";

interface Props {
  mnemonic: string;
  onNext: () => void;
  onBack: () => void;
}

export function StepShowPhrase({ mnemonic, onNext, onBack }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = mnemonic.split(" ");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <VStack gap="5">
      <Heading size="lg">Your Recovery Phrase</Heading>

      <Text fontSize="sm" color="fg.muted" textAlign="center">
        Write down these {words.length} words in order and store them in a safe place.
        This is the ONLY way to recover your wallet if you lose access to this device.
      </Text>

      <Box
        w="full"
        p="4"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        bg="bg.subtle"
      >
        <SimpleGrid columns={4} gap="2">
          {words.map((word, i) => (
            <Box key={i} p="2" fontSize="sm" textAlign="center">
              <Text as="span" color="fg.muted" fontSize="xs">{i + 1}. </Text>
              <Text as="span" fontWeight="medium">{word}</Text>
            </Box>
          ))}
        </SimpleGrid>
        <HStack justify="center" mt="3">
          <Button size="sm" variant="outline" onClick={handleCopy}>
            {copied
              ? <>{LuCheck({}) as React.ReactNode}<Text ml="1">Copied</Text></>
              : <>{LuCopy({}) as React.ReactNode}<Text ml="1">Copy to clipboard</Text></>
            }
          </Button>
        </HStack>
      </Box>

      <Box w="full" p="3" bg="red.50" borderRadius="md" _dark={{ bg: "red.900/20" }}>
        <VStack gap="1" align="start">
          <Text fontSize="sm" fontWeight="semibold" color="red.600" _dark={{ color: "red.300" }}>
            NEVER share these words with anyone.
          </Text>
          <Text fontSize="sm" color="red.600" _dark={{ color: "red.300" }}>
            BZE Hub will NEVER ask for your recovery phrase except during wallet import.
          </Text>
          <Text fontSize="sm" color="red.600" _dark={{ color: "red.300" }}>
            Anyone with these words can steal your funds.
          </Text>
        </VStack>
      </Box>

      <Checkbox.Root
        checked={confirmed}
        onCheckedChange={(e: { checked: boolean }) => setConfirmed(!!e.checked)}
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label fontSize="sm">
          I have written down my recovery phrase and stored it in a safe place
        </Checkbox.Label>
      </Checkbox.Root>

      <HStack w="full" gap="3" justify="space-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          colorPalette="teal"
          disabled={!confirmed}
          onClick={onNext}
        >
          Continue
        </Button>
      </HStack>
    </VStack>
  );
}
