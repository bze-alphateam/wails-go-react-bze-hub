import { useState, useEffect } from "react";
import {
  Box, VStack, HStack, Text, Button, Portal, IconButton,
  NativeSelect,
} from "@chakra-ui/react";
import { LuX, LuSettings, LuCode } from "react-icons/lu";
import {
  GetSettings, UpdateSetting, GetLogPath, ForceReInitNode, ForceReInitCooldownRemaining,
} from "../../wailsjs/go/main/App";

interface SettingsData {
  logLevel: string;
  developerMode: boolean;
  trusted: boolean;
  autoStartNode: boolean;
  theme: string;
  resyncBlockThreshold: number;
  maxBlockAgeSec: number;
  localNodeTimeoutMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownSec: number;
  proxyRestPort: number;
  proxyRpcPort: number;
  fastLoopIntervalSec: number;
  slowLoopIntervalSec: number;
  crossCheckBlockDelta: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [logPath, setLogPath] = useState("");
  const [showDev, setShowDev] = useState(false);

  useEffect(() => {
    if (open) {
      GetSettings().then((s: any) => {
        setSettings(s as SettingsData);
        setShowDev(!!s.developerMode);
      }).catch(() => {});
      GetLogPath().then(setLogPath).catch(() => {});
    }
  }, [open]);

  if (!open || !settings) return null;

  const update = async (key: string, value: any) => {
    try {
      await UpdateSetting(key, value);
      setSettings({ ...settings, [key]: value });
    } catch (e) {
      console.error("update setting:", e);
    }
  };

  return (
    <Portal>
      <Box
        position="fixed" top="0" left="0" right="0" bottom="0"
        bg="blackAlpha.600" zIndex="modal"
        display="flex" alignItems="stretch" justifyContent="stretch"
      >
        <Box
          bg="bg.panel" flex="1" m="0"
          overflowY="auto"
          p="6"
        >
          <HStack justify="space-between" mb="6">
            <HStack gap="2">
              {LuSettings({}) as React.ReactNode}
              <Text fontSize="xl" fontWeight="bold">Settings</Text>
            </HStack>
            <IconButton aria-label="Close" size="sm" variant="ghost" onClick={onClose}>
              {LuX({}) as React.ReactNode}
            </IconButton>
          </HStack>

          <VStack align="stretch" gap="6" maxW="600px">
            {/* General Settings */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb="3">General</Text>
              <VStack align="stretch" gap="3">
                <SettingRow label="Log level" description="Controls how much is written to the log file.">
                  <NativeSelect.Root size="sm" w="140px">
                    <NativeSelect.Field
                      value={settings.logLevel}
                      onChange={(e) => update("logLevel", e.target.value)}
                    >
                      <option value="error">Error</option>
                      <option value="info">Info</option>
                      <option value="debug">Debug</option>
                    </NativeSelect.Field>
                  </NativeSelect.Root>
                </SettingRow>

                <SettingRow label="Device trust" description={settings.trusted ? "Wallet address stored locally." : "Requires auth on every launch."}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => update("trusted", !settings.trusted)}
                  >
                    {settings.trusted ? "Trusted" : "Not trusted"}
                  </Button>
                </SettingRow>
              </VStack>
            </Box>

            {/* Log file location */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb="2">Log file</Text>
              <Text fontSize="xs" fontFamily="mono" color="fg.muted" wordBreak="break-all">
                {logPath}
              </Text>
            </Box>

            {/* Developer mode toggle */}
            <Box>
              <Button
                size="sm"
                variant={showDev ? "solid" : "outline"}
                colorPalette={showDev ? "teal" : "gray"}
                onClick={() => {
                  const newVal = !showDev;
                  setShowDev(newVal);
                  update("developerMode", newVal);
                }}
              >
                {LuCode({}) as React.ReactNode}
                <Text ml="1">{showDev ? "Developer mode ON" : "Developer mode"}</Text>
              </Button>
            </Box>

            {/* Developer Settings */}
            {showDev && (
              <Box>
                <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb="3">Developer</Text>
                <VStack align="stretch" gap="3">
                  <SettingRow label="Node RPC port" description="Local node Tendermint RPC.">
                    <Text fontSize="sm" fontFamily="mono">{settings.proxyRpcPort}</Text>
                  </SettingRow>
                  <SettingRow label="Node REST port" description="Local node REST API.">
                    <Text fontSize="sm" fontFamily="mono">{settings.proxyRestPort}</Text>
                  </SettingRow>
                  <SettingRow label="Max block age" description="Seconds before node is considered out of sync.">
                    <Text fontSize="sm" fontFamily="mono">{settings.maxBlockAgeSec}s</Text>
                  </SettingRow>
                  <SettingRow label="Re-sync threshold" description="Block range before triggering re-sync.">
                    <Text fontSize="sm" fontFamily="mono">{settings.resyncBlockThreshold} blocks</Text>
                  </SettingRow>
                  <SettingRow label="Circuit breaker" description="Failures before switching to public.">
                    <Text fontSize="sm" fontFamily="mono">{settings.circuitBreakerThreshold} failures / {settings.circuitBreakerCooldownSec}s cooldown</Text>
                  </SettingRow>
                  <SettingRow label="Local timeout" description="Per-request timeout for local node.">
                    <Text fontSize="sm" fontFamily="mono">{settings.localNodeTimeoutMs}ms</Text>
                  </SettingRow>
                  <SettingRow label="Health check" description="Fast / slow loop intervals.">
                    <Text fontSize="sm" fontFamily="mono">{settings.fastLoopIntervalSec}s / {settings.slowLoopIntervalSec}s</Text>
                  </SettingRow>

                  <DangerZone onClose={onClose} />
                </VStack>
              </Box>
            )}
          </VStack>
        </Box>
      </Box>
    </Portal>
  );
}

function DangerZone({ onClose }: { onClose: () => void }) {
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    // Check initial cooldown
    ForceReInitCooldownRemaining().then(setCooldown).catch(() => {});
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(timer); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleReInit = async () => {
    setFeedback("");
    try {
      await ForceReInitNode();
      setCooldown(60);
      setFeedback("Re-initialization started...");
      setTimeout(onClose, 1500);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setFeedback(msg);
      // Refresh cooldown from server
      ForceReInitCooldownRemaining().then(setCooldown).catch(() => {});
    }
  };

  return (
    <Box mt="3" pt="3" borderTopWidth="1px" borderColor="border">
      <Text fontSize="sm" fontWeight="semibold" color="red.500" mb="2">Danger zone</Text>
      <Button
        size="sm"
        variant="outline"
        colorPalette="red"
        disabled={cooldown > 0}
        onClick={handleReInit}
      >
        {cooldown > 0 ? `Force Re-Init Node (${cooldown}s)` : "Force Re-Init Node"}
      </Button>
      <Text fontSize="xs" color="fg.muted" mt="1">
        Stops the node, deletes all node data and binary, re-downloads everything.
      </Text>
      {feedback && (
        <Text fontSize="xs" color={feedback.includes("started") ? "green.500" : "orange.500"} mt="1">
          {feedback}
        </Text>
      )}
    </Box>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <HStack justify="space-between" align="center" py="1">
      <Box>
        <Text fontSize="sm" fontWeight="medium">{label}</Text>
        <Text fontSize="xs" color="fg.muted">{description}</Text>
      </Box>
      {children}
    </HStack>
  );
}
