import { useState, useEffect } from "react";
import { Flex, Spinner, Center } from "@chakra-ui/react";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { Wizard } from "./components/wizard/Wizard";
import { IsFirstRun, GetAccounts } from "../wailsjs/go/main/App";

type AppView = "loading" | "wizard" | "main";

function App() {
  const [view, setView] = useState<AppView>("loading");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [activeAddress, setActiveAddress] = useState("");
  const [activeLabel, setActiveLabel] = useState("");

  useEffect(() => {
    checkFirstRun();
  }, []);

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
      setView("wizard"); // fallback to wizard on error
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

  // Main shell
  return (
    <Flex direction="column" h="100vh">
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        accountLabel={activeLabel}
        accountAddress={activeAddress}
        onAccountChanged={loadAccounts}
      />
      <Flex flex="1" align="center" justify="center" bg="bg">
        {activeTab === "dashboard" && (
          <DashboardPlaceholder label={activeLabel} address={activeAddress} />
        )}
        {activeTab !== "dashboard" && (
          <Center color="fg.muted">
            {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} — coming in Epic 4
          </Center>
        )}
      </Flex>
      <StatusBar />
    </Flex>
  );
}

// Temporary dashboard showing wallet info until the full panel is built
function DashboardPlaceholder({ label, address }: { label: string; address: string }) {
  const truncated = address.length > 20
    ? `${address.slice(0, 10)}...${address.slice(-6)}`
    : address;

  return (
    <Center>
      <Flex direction="column" gap="2" textAlign="center">
        <span style={{ fontSize: "1.5rem", fontWeight: "bold" }}>Dashboard</span>
        <span style={{ color: "var(--chakra-colors-fg-muted)" }}>
          Wallet: {label}
        </span>
        <span style={{ fontFamily: "monospace", fontSize: "0.875rem" }}>
          {truncated}
        </span>
      </Flex>
    </Center>
  );
}

export default App;
