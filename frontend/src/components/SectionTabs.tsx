import { HStack, Button } from "@chakra-ui/react";
import { sectionAccent, type SectionId } from "../theme";
import type { SectionView } from "../hooks/useSectionView";

interface SectionTabsProps {
  /** Section this switch belongs to — drives the accent color. */
  section: SectionId;
  /** Currently selected view. */
  value: SectionView;
  /** Called when the user picks a view. */
  onChange: (v: SectionView) => void;
}

const VIEWS: readonly SectionView[] = ["simple", "advanced"];

/**
 * The app-wide Simple | Advanced segmented control. Presentational: it holds no
 * state — pair it with `useSectionView(section)` for persistence. The active
 * tab is tinted with the section's accent color so each section reads
 * distinctly. Callers compose their own header/title beside it.
 */
export function SectionTabs({ section, value, onChange }: SectionTabsProps) {
  const accent = sectionAccent[section];
  return (
    <HStack gap="0" bg="bg.subtle" borderRadius="md" p="1" role="tablist">
      {VIEWS.map((v) => (
        <Button
          key={v}
          role="tab"
          aria-selected={value === v}
          size="xs"
          variant={value === v ? "solid" : "ghost"}
          colorPalette={value === v ? accent : "gray"}
          onClick={() => onChange(v)}
          textTransform="capitalize"
        >
          {v}
        </Button>
      ))}
    </HStack>
  );
}
