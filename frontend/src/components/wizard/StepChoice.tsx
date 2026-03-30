import { VStack, Heading, Text, Button, Box, HStack } from "@chakra-ui/react";
import { LuPlus, LuDownload } from "react-icons/lu";

interface Props {
  onCreateNew: () => void;
  onImport: () => void;
  onBack: () => void;
}

export function StepChoice({ onCreateNew, onImport, onBack }: Props) {
  return (
    <VStack gap="6">
      <Heading size="lg">Set Up Your Wallet</Heading>

      <VStack gap="3" w="full">
        <Box
          as="button"
          w="full"
          p="4"
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          textAlign="left"
          _hover={{ borderColor: "teal.500", bg: "bg.subtle" }}
          onClick={onCreateNew}
          cursor="pointer"
        >
          <HStack gap="3">
            {LuPlus({}) as React.ReactNode}
            <Box>
              <Text fontWeight="semibold">Create a new wallet</Text>
              <Text fontSize="sm" color="fg.muted">
                Generate a fresh recovery phrase
              </Text>
            </Box>
          </HStack>
        </Box>

        <Box
          as="button"
          w="full"
          p="4"
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          textAlign="left"
          _hover={{ borderColor: "teal.500", bg: "bg.subtle" }}
          onClick={onImport}
          cursor="pointer"
        >
          <HStack gap="3">
            {LuDownload({}) as React.ReactNode}
            <Box>
              <Text fontWeight="semibold">Import existing wallet</Text>
              <Text fontSize="sm" color="fg.muted">
                Enter a recovery phrase you already have
              </Text>
            </Box>
          </HStack>
        </Box>
      </VStack>

      <Button variant="ghost" size="sm" onClick={onBack}>
        Back
      </Button>
    </VStack>
  );
}
