import { Box, HStack, Button, Text, Spacer, IconButton } from "@chakra-ui/react";
import { LuRefreshCw, LuSettings } from "react-icons/lu";
import { WalletMenu } from "./WalletMenu";
import { SECTIONS } from "../sections";
import { sectionAccent } from "../theme";
import type { SectionId } from "../theme";

interface TabBarProps {
  activeTab: SectionId;
  onTabChange: (tabId: SectionId) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  accountLabel?: string;
  accountAddress?: string;
  onAccountChanged?: () => void;
}

export function TabBar({
  activeTab, onTabChange, onRefresh, onOpenSettings,
  accountLabel, accountAddress, onAccountChanged,
}: TabBarProps) {
  const activeAccent = sectionAccent[activeTab];

  return (
    <Box bg="bg.panel" flexShrink={0} colorPalette={activeAccent}>
      <HStack gap="1" px="4" py="2">
        {SECTIONS.map((section) => {
          const isActive = activeTab === section.id;
          return (
            <Button
              key={section.id}
              size="sm"
              variant={isActive ? "solid" : "ghost"}
              colorPalette={isActive ? sectionAccent[section.id] : "gray"}
              onClick={() => onTabChange(section.id)}
              aria-label={section.label}
              title={section.label}
            >
              {section.icon({}) as React.ReactNode}
              {/* Labels collapse to icons below `lg` so the six sections fit
                  alongside the wallet menu at the 800px minimum window width. */}
              <Text ml="1" display={{ base: "none", lg: "inline" }}>{section.label}</Text>
            </Button>
          );
        })}

        <IconButton
          aria-label="Refresh"
          size="sm"
          variant="ghost"
          onClick={onRefresh}
        >
          {LuRefreshCw({}) as React.ReactNode}
        </IconButton>

        <Spacer />

        {accountLabel && accountAddress && onAccountChanged && (
          <WalletMenu
            activeLabel={accountLabel}
            activeAddress={accountAddress}
            onAccountChanged={onAccountChanged}
          />
        )}

        <IconButton
          aria-label="Settings"
          size="sm"
          variant="ghost"
          onClick={onOpenSettings}
        >
          {LuSettings({}) as React.ReactNode}
        </IconButton>
      </HStack>

      {/* Per-section accent strip beneath the nav (the "section header" accent). */}
      <Box h="2px" bg="colorPalette.solid" />
    </Box>
  );
}
