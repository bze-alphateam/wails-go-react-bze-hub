import { VStack, Heading, Text, Button } from "@chakra-ui/react";

interface Props {
  onNext: () => void;
}

export function StepWelcome({ onNext }: Props) {
  return (
    <VStack gap="6" textAlign="center">
      <Heading size="2xl">Welcome to BZE Hub</Heading>
      <Text fontSize="lg" color="fg.muted" maxW="md">
        Your self-sovereign gateway to the BZE blockchain.
        BZE Hub runs a local node, manages your wallet,
        and gives you access to all BZE apps in one place.
      </Text>
      <Button size="lg" colorPalette="teal" onClick={onNext}>
        Get Started
      </Button>
    </VStack>
  );
}
