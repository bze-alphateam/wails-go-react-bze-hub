import { useState, useEffect } from "react";
import { Box, HStack, Text, Circle, IconButton, Button } from "@chakra-ui/react";
import { useColorMode } from "../hooks/useColorMode";
import { LuSun, LuMoon, LuRotateCcw, LuSettings } from "react-icons/lu";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { GetNodeSnapshot, ForceReInitNode } from "../../wailsjs/go/main/App";
import { SettingsModal } from "./SettingsModal";

interface NodeSnapshot {
  status: string;
  height: number;
  targetHeight: number;
  proxyTarget: string;
  currentWork: string;
}

const statusColors: Record<string, string> = {
  synced: "green.500",
  syncing: "yellow.500",
  starting: "blue.500",
  resyncing: "yellow.500",
  error: "red.500",
  stopped: "gray.400",
  not_started: "gray.400",
};

const statusLabels: Record<string, string> = {
  synced: "Synced",
  syncing: "Syncing",
  starting: "Starting",
  resyncing: "Re-syncing",
  error: "Error",
  stopped: "Stopped",
  not_started: "Not started",
};

export function StatusBar() {
  const { colorMode, toggleColorMode } = useColorMode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [node, setNode] = useState<NodeSnapshot>({
    status: "not_started",
    height: 0,
    targetHeight: 0,
    proxyTarget: "public",
    currentWork: "",
  });

  useEffect(() => {
    // Load initial state
    GetNodeSnapshot()
      .then((snap: any) => setNode(snap as NodeSnapshot))
      .catch(() => {});

    // Listen for live updates
    const cancel = EventsOn("state:node-changed", (snap: NodeSnapshot) => {
      setNode(snap);
    });
    return cancel;
  }, []);

  const dotColor = statusColors[node.status] || "gray.400";
  const statusLabel = statusLabels[node.status] || node.status;
  const heightStr = node.height > 0 ? ` (${node.height.toLocaleString()})` : "";

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
          <Circle size="2" bg={dotColor} />
          <Text>Node: {statusLabel}{heightStr}</Text>
        </HStack>

        <Text>|</Text>

        <Text>
          {node.proxyTarget === "local" ? "Local" : "Public"}
        </Text>

        <Text>|</Text>

        <Text>Mainnet</Text>

        <Text>|</Text>

        <Text>BZE Hub v0.1.0</Text>

        {node.currentWork && (
          <>
            <Text>|</Text>
            <Text fontStyle="italic">{node.currentWork}</Text>
          </>
        )}

        {(node.status === "error" || node.status === "not_started") && !node.currentWork && (
          <>
            <Text>|</Text>
            <Button
              size="2xs"
              variant="ghost"
              fontSize="xs"
              onClick={async () => {
                try { await ForceReInitNode(); } catch (e) { console.error("reinit:", e); }
              }}
            >
              {LuRotateCcw({}) as React.ReactNode}
              <Text ml="1">Re-init Node</Text>
            </Button>
          </>
        )}

        <Box flex="1" />

        <IconButton
          aria-label="Settings"
          size="2xs"
          variant="ghost"
          onClick={() => setSettingsOpen(true)}
        >
          {LuSettings({}) as React.ReactNode}
        </IconButton>

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

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Box>
  );
}
