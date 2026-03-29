import { Flex, Heading, Text, VStack } from "@chakra-ui/react";

export function ContentArea() {
  return (
    <Flex flex="1" align="center" justify="center" bg="bg">
      <VStack gap="4">
        <Heading size="2xl" color="fg">
          Welcome to BZE Hub
        </Heading>
        <Text fontSize="lg" color="fg.muted">
          Let's get you started
        </Text>
      </VStack>
    </Flex>
  );
}
