import { useState, useEffect } from "react";
import { Flex, Spinner, Center } from "@chakra-ui/react";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { Dashboard } from "./components/dashboard/Dashboard";
import { Wizard } from "./components/wizard/Wizard";
import { IsFirstRun, GetAccounts, GetNodeSnapshot } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";

type AppView = "loading" | "wizard" | "main";

function App() {
  const [view, setView] = useState<AppView>("loading");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [activeAddress, setActiveAddress] = useState("");
  const [activeLabel, setActiveLabel] = useState("");
  const [proxyTarget, setProxyTarget] = useState("public");

  useEffect(() => {
    checkFirstRun();

    // Listen for node state changes to track proxy target
    GetNodeSnapshot()
      .then((snap: any) => setProxyTarget(snap?.proxyTarget || "public"))
      .catch(() => {});

    const cancel = EventsOn("state:node-changed", (snap: any) => {
      setProxyTarget(snap?.proxyTarget || "public");
    });
    return cancel;
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
        onTabChange={setActiveTab}
        accountLabel={activeLabel}
        accountAddress={activeAddress}
        onAccountChanged={loadAccounts}
      />
      <Flex flex="1" bg="bg" overflow="hidden">
        {activeTab === "dashboard" && (
          <Dashboard
            address={activeAddress}
            label={activeLabel}
            proxyTarget={proxyTarget}
            onNavigate={setActiveTab}
          />
        )}
        {activeTab !== "dashboard" && (
          <Center flex="1" color="fg.muted">
            {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} — coming in Epic 4
          </Center>
        )}
      </Flex>
      <StatusBar />
    </Flex>
  );
}

export default App;
