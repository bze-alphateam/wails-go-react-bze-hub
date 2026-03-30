import { Box, HStack, Text, Circle, IconButton } from "@chakra-ui/react";
import { useColorMode } from "../hooks/useColorMode";
import { LuSun, LuMoon } from "react-icons/lu";

export function StatusBar() {
  const { colorMode, toggleColorMode } = useColorMode();

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

        <Text>BZE Hub v0.1.0</Text>

        <Box flex="1" />

        <IconButton
          aria-label="Toggle color mode"
          size="2xs"
          variant="ghost"
          onClick={toggleColorMode}
        >
          {colorMode === "light"
            ? LuMoon({}) as React.ReactNode
            : LuSun({}) as React.ReactNode
          }
        </IconButton>
      </HStack>
    </Box>
  );
}
