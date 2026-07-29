import { HStack, Text, Button, Box } from "@chakra-ui/react";
import { LuBookOpen } from "react-icons/lu";
import { useOpenOrdersCount } from "../../../hooks/useOpenOrdersCount";

interface OpenOrdersSummaryProps {
  address: string;
  /** Jump to the Advanced tab (where orders can be managed). */
  onGoAdvanced: () => void;
}

/**
 * A compact card shown on the Simple swap view when the user has any open orders
 * on the Advanced tab — the state-visibility rule says Simple must surface active
 * advanced state. Renders nothing when there are no open orders.
 */
export function OpenOrdersSummary({ address, onGoAdvanced }: OpenOrdersSummaryProps) {
  const count = useOpenOrdersCount(address);
  if (count <= 0) return null;

  return (
    <HStack
      justify="space-between"
      borderWidth="1px"
      borderColor="blue.500/30"
      borderRadius="lg"
      bg="blue.500/8"
      p="3"
    >
      <HStack gap="2">
        <Box color="blue.fg">{LuBookOpen({ size: 16 }) as React.ReactNode}</Box>
        <Text fontSize="sm">
          You have {count} open order{count > 1 ? "s" : ""} on the Advanced tab.
        </Text>
      </HStack>
      <Button size="xs" variant="subtle" colorPalette="blue" onClick={onGoAdvanced}>
        View orders
      </Button>
    </HStack>
  );
}
