import { useState } from "react";
import { Flex } from "@chakra-ui/react";
import { TabBar } from "./components/TabBar";
import { ContentArea } from "./components/ContentArea";
import { StatusBar } from "./components/StatusBar";

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <Flex direction="column" h="100vh">
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <ContentArea />
      <StatusBar />
    </Flex>
  );
}

export default App;
