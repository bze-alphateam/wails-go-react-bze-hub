import { Box, HStack, Button, Text, Spacer } from "@chakra-ui/react";
import { LuHouse, LuChartColumn, LuFlame, LuLock } from "react-icons/lu";

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "dex", label: "DEX" },
  { id: "burner", label: "Burner" },
  { id: "staking", label: "Staking" },
] as const;

const tabIcons: Record<string, React.ReactNode> = {
  dashboard: LuHouse({}) as React.ReactNode,
  dex: LuChartColumn({}) as React.ReactNode,
  burner: LuFlame({}) as React.ReactNode,
  staking: LuLock({}) as React.ReactNode,
};

interface TabBarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <Box
      borderBottomWidth="1px"
      borderColor="border"
      bg="bg.panel"
      px="4"
      py="2"
      flexShrink={0}
    >
      <HStack gap="1">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            size="sm"
            variant={activeTab === tab.id ? "solid" : "ghost"}
            colorPalette={activeTab === tab.id ? "teal" : "gray"}
            onClick={() => onTabChange(tab.id)}
          >
            {tabIcons[tab.id]}
            <Text ml="1">{tab.label}</Text>
          </Button>
        ))}

        <Spacer />

        <Text fontSize="xs" color="fg.muted">
          BZE Hub v0.1.0
        </Text>
      </HStack>
    </Box>
  );
}
