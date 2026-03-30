import { Box, Flex, HStack, Circle, Text } from "@chakra-ui/react";

interface WizardLayoutProps {
  currentStep: number;
  totalSteps: number;
  children: React.ReactNode;
}

export function WizardLayout({ currentStep, totalSteps, children }: WizardLayoutProps) {
  return (
    <Flex direction="column" h="100vh" bg="bg">
      {/* Step indicator */}
      <Box px="6" py="4" borderBottomWidth="1px" borderColor="border">
        <HStack gap="2" justify="center">
          {Array.from({ length: totalSteps }, (_, i) => (
            <HStack key={i} gap="2">
              <Circle
                size="6"
                bg={i < currentStep ? "teal.500" : i === currentStep ? "teal.500" : "gray.200"}
                color={i <= currentStep ? "white" : "gray.500"}
                fontSize="xs"
                fontWeight="bold"
              >
                {i < currentStep ? "\u2713" : i + 1}
              </Circle>
              {i < totalSteps - 1 && (
                <Box
                  w="8"
                  h="0.5"
                  bg={i < currentStep ? "teal.500" : "gray.200"}
                  borderRadius="full"
                />
              )}
            </HStack>
          ))}
        </HStack>
      </Box>

      {/* Content */}
      <Flex flex="1" align="center" justify="center" p="6">
        <Box w="full" maxW="lg">
          {children}
        </Box>
      </Flex>

      {/* Footer */}
      <Box px="6" py="2" borderTopWidth="1px" borderColor="border">
        <Text fontSize="xs" color="fg.muted" textAlign="center">
          BZE Hub v0.1.0
        </Text>
      </Box>
    </Flex>
  );
}
