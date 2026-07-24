import { Center, VStack, Box, Text, Badge } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import type { SectionId } from "../theme";
import { sectionAccent } from "../theme";

interface Props {
  id: SectionId;
  label: string;
  milestone: string;
  icon: IconType;
}

/**
 * A "coming soon" placeholder for sections that have no functionality yet.
 * Uses the section's accent color and names the milestone it will ship in.
 * Intentionally carries no feature buttons (see BZE-48 business rules).
 */
export function PlaceholderSection({ id, label, milestone, icon }: Props) {
  const accent = sectionAccent[id];
  return (
    <Center h="100%" w="100%" p="8" colorPalette={accent}>
      <VStack gap="4" maxW="440px" textAlign="center">
        <Box fontSize="5xl" color="colorPalette.fg" lineHeight="1">
          {icon({}) as React.ReactNode}
        </Box>
        <Text fontSize="2xl" fontWeight="bold">{label}</Text>
        <Badge colorPalette={accent} variant="subtle" size="lg" px="3" py="1" borderRadius="full">
          Coming in {milestone}
        </Badge>
        <Text fontSize="sm" color="fg.muted">
          The {label} section is part of the BZE Hub roadmap and will arrive in milestone {milestone}.
        </Text>
      </VStack>
    </Center>
  );
}
