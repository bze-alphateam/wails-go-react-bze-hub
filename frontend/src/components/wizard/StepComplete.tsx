import { VStack, Heading, Text, Button, Box, HStack, Circle } from "@chakra-ui/react";

interface Props {
  accountLabel: string;
  address: string;
  onFinish: () => void;
}

export function StepComplete({ accountLabel, address, onFinish }: Props) {
  const truncated = address.length > 20
    ? `${address.slice(0, 10)}...${address.slice(-6)}`
    : address;

  return (
    <VStack gap="6" textAlign="center">
      <Circle size="16" bg="teal.100" color="teal.600" fontSize="2xl" _dark={{ bg: "teal.900/30", color: "teal.300" }}>
        {"\u2713"}
      </Circle>

      <Heading size="lg">You're All Set!</Heading>

      <Box
        w="full"
        p="4"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
      >
        <VStack gap="2">
          <HStack gap="2">
            <Text fontSize="sm" color="fg.muted">Wallet:</Text>
            <Text fontSize="sm" fontWeight="semibold">{accountLabel}</Text>
          </HStack>
          <HStack gap="2">
            <Text fontSize="sm" color="fg.muted">Address:</Text>
            <Text fontSize="sm" fontFamily="mono">{truncated}</Text>
          </HStack>
        </VStack>
      </Box>

      <Box w="full" p="3" bg="bg.subtle" borderRadius="md">
        <HStack gap="2" justify="center">
          <Circle size="2" bg="gray.400" />
          <Text fontSize="sm" color="fg.muted">
            Node setup will begin on the next launch
          </Text>
        </HStack>
      </Box>

      <Button size="lg" w="full" colorPalette="teal" onClick={onFinish}>
        Open BZE Hub
      </Button>
    </VStack>
  );
}
