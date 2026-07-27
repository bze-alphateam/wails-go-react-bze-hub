import { useState, useEffect, useRef, useCallback } from "react";
import { Flex, Spinner, Center, Text, Box } from "@chakra-ui/react";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { SettingsModal } from "./components/SettingsModal";
import { PlaceholderSection } from "./components/PlaceholderSection";
import { Dashboard } from "./components/dashboard/Dashboard";
import { Wizard } from "./components/wizard/Wizard";
import { IsFirstRun, GetAccounts, GetNodeSnapshot } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import { StakingPage } from "./components/staking/StakingPage";
import { PortfolioSection } from "./components/portfolio/PortfolioSection";
import { TradeSection } from "./components/trade/TradeSection";
import { PLACEHOLDER_SECTIONS } from "./sections";
import type { SectionId } from "./theme";

type AppView = "loading" | "wizard" | "main" | "shutdown";

function App() {
  const [view, setView] = useState<AppView>("loading");
  const [activeTab, setActiveTab] = useState<SectionId>("dashboard");
  const [activeAddress, setActiveAddress] = useState("");
  const [activeLabel, setActiveLabel] = useState("");
  const [proxyTarget, setProxyTarget] = useState("public");
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    // Dashboard does a full reload; staking auto-polls via useStakingData.
    if (activeTabRef.current === "dashboard") window.location.reload();
  }, []);

  function handleTabChange(tabId: string) {
    setActiveTab(tabId as SectionId);
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
        onOpenSettings={() => setSettingsOpen(true)}
        accountLabel={activeLabel}
        accountAddress={activeAddress}
        onAccountChanged={loadAccounts}
      />

      <Box flex="1" bg="bg" overflow="hidden" position="relative">
        {/* Dashboard — kept mounted to preserve state and article polling. */}
        <SectionPane active={activeTab === "dashboard"}>
          <Dashboard
            address={activeAddress}
            label={activeLabel}
            proxyTarget={proxyTarget}
            onNavigate={handleTabChange}
            active={activeTab === "dashboard"}
          />
        </SectionPane>

        {/* Portfolio — asset holdings, kept mounted to preserve its polling. */}
        <SectionPane active={activeTab === "portfolio"}>
          <PortfolioSection address={activeAddress} proxyTarget={proxyTarget} />
        </SectionPane>

        {/* Trade — swap card, kept mounted to preserve quoting and inputs. */}
        <SectionPane active={activeTab === "trade"}>
          <TradeSection address={activeAddress} proxyTarget={proxyTarget} />
        </SectionPane>

        {/* Earn — native staking, kept mounted to preserve its polling. */}
        <SectionPane active={activeTab === "earn"}>
          <StakingPage address={activeAddress} proxyTarget={proxyTarget} />
        </SectionPane>

        {/* Placeholder sections — rendered only when active. */}
        {PLACEHOLDER_SECTIONS.map((section) =>
          activeTab === section.id ? (
            <SectionPane key={section.id} active>
              <PlaceholderSection
                id={section.id}
                label={section.label}
                milestone={section.milestone!}
                icon={section.icon}
              />
            </SectionPane>
          ) : null
        )}
      </Box>

      <StatusBar />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Flex>
  );
}

/** Full-bleed pane for a single section; toggles visibility without unmounting. */
function SectionPane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <Box
      position="absolute"
      top="0" left="0"
      width="100%" height="100%"
      display={active ? "block" : "none"}
      overflow="hidden"
    >
      {children}
    </Box>
  );
}

export default App;
