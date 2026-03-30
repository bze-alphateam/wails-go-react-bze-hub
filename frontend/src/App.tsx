import { useState, useEffect, useRef, useCallback } from "react";
import { Flex, Spinner, Center, Text, Box } from "@chakra-ui/react";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { Dashboard } from "./components/dashboard/Dashboard";
import { DAppFrame } from "./components/DAppFrame";
import { Wizard } from "./components/wizard/Wizard";
import { IsFirstRun, GetAccounts, GetNodeSnapshot } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";

type AppView = "loading" | "wizard" | "main" | "shutdown";

const DAPP_TABS = [
  { id: "dex", label: "DEX", url: "https://dex.getbze.com" },
  { id: "burner", label: "Burner", url: "https://burner.getbze.com" },
  { id: "staking", label: "Staking", url: "https://staking.getbze.com" },
] as const;

function App() {
  const [view, setView] = useState<AppView>("loading");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [activeAddress, setActiveAddress] = useState("");
  const [activeLabel, setActiveLabel] = useState("");
  const [proxyTarget, setProxyTarget] = useState("public");

  // Track which dApp tabs have been activated (for lazy loading)
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set());
  // Increment to force iframe reload
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    checkFirstRun();

    GetNodeSnapshot()
      .then((snap: any) => setProxyTarget(snap?.proxyTarget || "public"))
      .catch(() => {});

    const cancelNode = EventsOn("state:node-changed", (snap: any) => {
      setProxyTarget(snap?.proxyTarget || "public");
    });

    const cancelShutdown = EventsOn("app:shutting-down", () => {
      setView("shutdown");
    });

    // Keyboard shortcut: Cmd+R / Ctrl+R to refresh
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        handleRefresh();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelNode();
      cancelShutdown();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const handleRefresh = useCallback(() => {
    if (activeTabRef.current === "dashboard") {
      window.location.reload();
    } else {
      setRefreshKey((k) => k + 1);
    }
  }, []);

  // When a dApp tab is activated for the first time, mount its iframe
  function handleTabChange(tabId: string) {
    setActiveTab(tabId);
    if (tabId !== "dashboard" && !mountedTabs.has(tabId)) {
      setMountedTabs((prev) => new Set([...prev, tabId]));
    }
  }

  async function checkFirstRun() {
    try {
      const firstRun = await IsFirstRun();
      if (firstRun) {
        setView("wizard");
      } else {
        await loadAccounts();
        setView("main");
      }
    } catch (e) {
      console.error("startup check failed:", e);
      setView("wizard");
    }
  }

  async function loadAccounts() {
    try {
      const data = await GetAccounts();
      setActiveAddress(data.activeAddress as string || "");
      const accounts = data.accounts as any[];
      if (accounts && accounts.length > 0) {
        const active = accounts.find((a: any) => a.bech32Address === data.activeAddress);
        setActiveLabel(active?.label || "");
      }
    } catch (e) {
      console.error("load accounts failed:", e);
    }
  }

  function handleWizardComplete() {
    loadAccounts().then(() => setView("main"));
  }

  if (view === "shutdown") {
    return (
      <Center h="100vh" flexDirection="column" gap="4">
        <Spinner size="xl" color="teal.500" />
        <Text fontSize="lg" fontWeight="semibold" color="fg">Shutting down...</Text>
        <Text fontSize="sm" color="fg.muted">Stopping node and cleaning up. Please wait.</Text>
      </Center>
    );
  }

  if (view === "loading") {
    return (
      <Center h="100vh">
        <Spinner size="xl" color="teal.500" />
      </Center>
    );
  }

  if (view === "wizard") {
    return <Wizard onComplete={handleWizardComplete} />;
  }

  return (
    <Flex direction="column" h="100vh">
      <TabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onRefresh={handleRefresh}
        accountLabel={activeLabel}
        accountAddress={activeAddress}
        onAccountChanged={loadAccounts}
      />

      {/* Content area — dashboard + dApp iframes */}
      <Box flex="1" bg="bg" overflow="hidden" position="relative">
        {/* Dashboard */}
        <Box
          position="absolute"
          top="0" left="0"
          width="100%" height="100%"
          display={activeTab === "dashboard" ? "block" : "none"}
          overflow="hidden"
        >
          <Dashboard
            address={activeAddress}
            label={activeLabel}
            proxyTarget={proxyTarget}
            onNavigate={handleTabChange}
          />
        </Box>

        {/* dApp iframes — lazy mounted, kept alive via display:none */}
        {DAPP_TABS.map((tab) =>
          mountedTabs.has(tab.id) ? (
            <DAppFrame
              key={tab.id}
              url={tab.url}
              label={tab.label}
              isActive={activeTab === tab.id}
              refreshKey={activeTab === tab.id ? refreshKey : undefined}
            />
          ) : null
        )}
      </Box>

      <StatusBar />
    </Flex>
  );
}

export default App;
