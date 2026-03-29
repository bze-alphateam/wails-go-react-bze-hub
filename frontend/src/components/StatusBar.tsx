import { Box, HStack, Text, Circle } from "@chakra-ui/react";

export function StatusBar() {
  return (
    <Box
      borderTopWidth="1px"
      borderColor="border"
      bg="bg.panel"
      px="4"
      py="1.5"
      flexShrink={0}
    >
      <HStack gap="4" fontSize="xs" color="fg.muted">
        <HStack gap="1.5">
          <Circle size="2" bg="gray.500" />
          <Text>Node: not started</Text>
        </HStack>

        <Text>|</Text>

        <Text>Network: Mainnet</Text>

        <Text>|</Text>

        <Text>v0.1.0</Text>
      </HStack>
    </Box>
  );
}
