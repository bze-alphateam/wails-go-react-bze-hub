import { useState, useEffect } from "react";
import {
  Box, VStack, HStack, Text, Button, Portal, IconButton, Code,
} from "@chakra-ui/react";
import { LuX, LuShield, LuChevronDown, LuChevronUp, LuTriangleAlert, LuFlame } from "react-icons/lu";

export interface SignApprovalRequest {
  id: string;
  method: string;
  chainId: string;
  signer: string;
  signDocJSON: string;
  resolve: (approved: boolean) => void;
}

interface Props {
  request: SignApprovalRequest;
}

interface ParsedTx {
  summary: string;
  warning: string | null;
  details: { label: string; value: string }[];
  fee: string;
  rawJSON: string;
}

function formatAmount(amount: string, denom: string): string {
  if (denom === "ubze") {
    const bze = Number(amount) / 1_000_000;
    return `${bze.toLocaleString()} BZE`;
  }
  // Try to make other denoms readable
  if (denom.startsWith("u")) {
    const readable = denom.slice(1).toUpperCase();
    const val = Number(amount) / 1_000_000;
    return `${val.toLocaleString()} ${readable}`;
  }
  return `${amount} ${denom}`;
}

function truncateAddr(addr: string): string {
  if (addr.length > 20) return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  return addr;
}

function parseTx(signDocJSON: string): ParsedTx {
  try {
    const doc = JSON.parse(signDocJSON);
    const msgs = doc.msgs || [];
    const fee = doc.fee;
    const memo = doc.memo || "";

    const feeStr = fee?.amount?.length > 0
      ? fee.amount.map((a: any) => formatAmount(a.amount, a.denom)).join(" + ")
      : "No fee";

    if (msgs.length === 0) {
      return { summary: "Empty transaction", warning: null, details: [], fee: feeStr, rawJSON: signDocJSON };
    }

    if (msgs.length === 1) {
      const parsed = parseMessage(msgs[0], memo);
      return { ...parsed, fee: feeStr, rawJSON: signDocJSON };
    }

    // Multiple messages
    const summaries = msgs.map((m: any) => parseMessage(m, memo).summary);
    return {
      summary: `${msgs.length} actions`,
      warning: null,
      details: summaries.map((s: string, i: number) => ({ label: `Action ${i + 1}`, value: s })),
      fee: feeStr,
      rawJSON: signDocJSON,
    };
  } catch {
    return { summary: "Transaction", warning: null, details: [], fee: "Unknown", rawJSON: signDocJSON };
  }
}

function parseMessage(msg: any, memo: string): { summary: string; warning: string | null; details: { label: string; value: string }[] } {
  const type = msg.type || msg["@type"] || "";
  const value = msg.value || msg;

  switch (type) {
    case "cosmos-sdk/MsgSend": {
      const amount = value.amount?.[0];
      const amountStr = amount ? formatAmount(amount.amount, amount.denom) : "tokens";
      return {
        summary: `Send ${amountStr} to ${truncateAddr(value.to_address || "")}`,
        warning: null,
        details: [
          { label: "From", value: value.from_address || "" },
          { label: "To", value: value.to_address || "" },
          ...(value.amount || []).map((a: any) => ({ label: "Amount", value: formatAmount(a.amount, a.denom) })),
        ],
      };
    }

    case "cosmos-sdk/MsgDelegate": {
      const amount = value.amount;
      return {
        summary: `Delegate ${amount ? formatAmount(amount.amount, amount.denom) : "tokens"} to validator`,
        warning: null,
        details: [
          { label: "Validator", value: truncateAddr(value.validator_address || "") },
          amount && { label: "Amount", value: formatAmount(amount.amount, amount.denom) },
        ].filter(Boolean) as any,
      };
    }

    case "cosmos-sdk/MsgUndelegate": {
      const amount = value.amount;
      return {
        summary: `Undelegate ${amount ? formatAmount(amount.amount, amount.denom) : "tokens"} from validator`,
        warning: "Undelegated tokens take 21 days to become available.",
        details: [
          { label: "Validator", value: truncateAddr(value.validator_address || "") },
          amount && { label: "Amount", value: formatAmount(amount.amount, amount.denom) },
        ].filter(Boolean) as any,
      };
    }

    case "cosmos-sdk/MsgBeginRedelegate": {
      return {
        summary: "Redelegate stake to a different validator",
        warning: null,
        details: [
          { label: "From validator", value: truncateAddr(value.validator_src_address || "") },
          { label: "To validator", value: truncateAddr(value.validator_dst_address || "") },
        ],
      };
    }

    case "cosmos-sdk/MsgWithdrawDelegationReward":
    case "cosmos-sdk/MsgWithdrawDelegatorReward": {
      return {
        summary: "Claim staking rewards",
        warning: null,
        details: [
          { label: "Validator", value: truncateAddr(value.validator_address || "") },
        ],
      };
    }

    case "cosmos-sdk/MsgVote": {
      const options: Record<string, string> = { "1": "Yes", "2": "Abstain", "3": "No", "4": "No with Veto" };
      return {
        summary: `Vote ${options[value.option] || value.option} on proposal #${value.proposal_id}`,
        warning: null,
        details: [],
      };
    }

    // BZE DEX
    case "/bze.tradebin.v1.MsgCreateOrder": {
      const orderType = value.order_type === "buy" ? "Buy" : "Sell";
      return {
        summary: `${orderType} order: ${value.amount || "?"} at price ${value.price || "?"}`,
        warning: null,
        details: [
          { label: "Market", value: value.market_id || "" },
          { label: "Type", value: orderType },
          { label: "Amount", value: value.amount || "" },
          { label: "Price", value: value.price || "" },
        ],
      };
    }

    case "/bze.tradebin.v1.MsgCancelOrder": {
      return {
        summary: "Cancel DEX order",
        warning: null,
        details: [
          { label: "Market", value: value.market_id || "" },
          { label: "Order ID", value: value.order_id || "" },
        ],
      };
    }

    // BZE Burner
    case "/bze.burner.v1.MsgFundBurner": {
      const amount = value.amount;
      return {
        summary: `Burn ${amount ? formatAmount(amount.amount, amount.denom) : "tokens"}`,
        warning: "This action permanently destroys coins. It cannot be undone.",
        details: [
          amount && { label: "Amount", value: formatAmount(amount.amount, amount.denom) },
        ].filter(Boolean) as any,
      };
    }

    // BZE Rewards
    case "/bze.rewards.v1.MsgJoinStaking": {
      return {
        summary: "Join staking reward program",
        warning: null,
        details: [],
      };
    }

    case "/bze.rewards.v1.MsgExitStaking": {
      return {
        summary: "Exit staking reward program",
        warning: null,
        details: [],
      };
    }

    case "/bze.rewards.v1.MsgClaimStakingRewards": {
      return {
        summary: "Claim staking rewards",
        warning: null,
        details: [],
      };
    }

    // BZE CoinTrunk
    case "/bze.cointrunk.v1.MsgAddArticle": {
      return {
        summary: "Publish article on CoinTrunk",
        warning: null,
        details: [
          { label: "Title", value: value.title || "" },
          { label: "URL", value: value.url || "" },
        ],
      };
    }

    case "/bze.cointrunk.v1.MsgPayPublisherRespect": {
      return {
        summary: `Tip publisher ${value.amount || ""}`,
        warning: null,
        details: [
          { label: "Publisher", value: truncateAddr(value.address || "") },
        ],
      };
    }

    // IBC
    case "cosmos-sdk/MsgTransfer":
    case "/ibc.applications.transfer.v1.MsgTransfer": {
      const token = value.token;
      return {
        summary: `IBC Transfer ${token ? formatAmount(token.amount, token.denom) : "tokens"}`,
        warning: null,
        details: [
          { label: "To", value: truncateAddr(value.receiver || "") },
          { label: "Channel", value: value.source_channel || "" },
        ],
      };
    }

    // Token Factory
    case "/bze.tokenfactory.v1.MsgCreateDenom": {
      return {
        summary: `Create new token: ${value.subdenom || ""}`,
        warning: null,
        details: [],
      };
    }

    case "/bze.tokenfactory.v1.MsgMint": {
      return {
        summary: `Mint ${value.amount ? formatAmount(value.amount.amount, value.amount.denom) : "tokens"}`,
        warning: null,
        details: [],
      };
    }

    default: {
      return {
        summary: `Transaction: ${type || "unknown"}`,
        warning: "Unknown transaction type — review the details carefully before approving.",
        details: [],
      };
    }
  }
}

export function ApprovalDialog({ request }: Props) {
  const [timeLeft, setTimeLeft] = useState(60);
  const [expanded, setExpanded] = useState(false);
  const parsed = parseTx(request.signDocJSON);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          request.resolve(false);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [request]);

  return (
    <Portal>
      <Box
        position="fixed"
        top="0" left="0" right="0" bottom="0"
        bg="blackAlpha.700"
        zIndex="modal"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Box
          bg="bg.panel"
          borderRadius="xl"
          p="5"
          w="400px"
          maxW="95vw"
          maxH="80vh"
          overflowY="auto"
          shadow="2xl"
        >
          {/* Header */}
          <HStack justify="space-between" mb="4">
            <HStack gap="2">
              {LuShield({}) as React.ReactNode}
              <Text fontWeight="bold" fontSize="md">Approve Transaction</Text>
            </HStack>
            <IconButton
              aria-label="Reject"
              size="xs"
              variant="ghost"
              onClick={() => request.resolve(false)}
            >
              {LuX({}) as React.ReactNode}
            </IconButton>
          </HStack>

          <VStack align="stretch" gap="3">
            {/* Summary */}
            <Text fontSize="md" fontWeight="semibold">{parsed.summary}</Text>

            {/* Warning */}
            {parsed.warning && (
              <HStack
                px="3" py="2"
                bg="orange.50" _dark={{ bg: "orange.900/20" }}
                borderRadius="md"
                borderWidth="1px"
                borderColor="orange.200"
                gap="2"
              >
                <Box color="orange.600" _dark={{ color: "orange.300" }} flexShrink={0}>
                  {parsed.warning.includes("permanently") || parsed.warning.includes("cannot be undone")
                    ? LuFlame({}) as React.ReactNode
                    : LuTriangleAlert({}) as React.ReactNode
                  }
                </Box>
                <Text fontSize="xs" color="orange.800" _dark={{ color: "orange.200" }}>
                  {parsed.warning}
                </Text>
              </HStack>
            )}

            {/* Key details */}
            {parsed.details.length > 0 && (
              <VStack align="stretch" gap="1" fontSize="xs" color="fg.muted">
                {parsed.details.map((d, i) => (
                  <HStack key={i} justify="space-between">
                    <Text fontWeight="medium">{d.label}</Text>
                    <Text fontFamily="mono" maxW="220px" truncate>{d.value}</Text>
                  </HStack>
                ))}
              </VStack>
            )}

            {/* Fee + Signer */}
            <VStack align="stretch" gap="1" fontSize="xs" color="fg.muted" pt="1" borderTopWidth="1px" borderColor="border">
              <HStack justify="space-between">
                <Text fontWeight="medium">Fee</Text>
                <Text>{parsed.fee}</Text>
              </HStack>
              <HStack justify="space-between">
                <Text fontWeight="medium">Signer</Text>
                <Code fontSize="xs">{truncateAddr(request.signer)}</Code>
              </HStack>
            </VStack>

            {/* Expandable raw details */}
            <Box>
              <Button
                size="xs"
                variant="ghost"
                w="full"
                onClick={() => setExpanded(!expanded)}
                justifyContent="space-between"
              >
                <Text fontSize="xs" color="fg.muted">Raw transaction data</Text>
                {expanded
                  ? LuChevronUp({}) as React.ReactNode
                  : LuChevronDown({}) as React.ReactNode
                }
              </Button>
              {expanded && (
                <Box
                  mt="1"
                  p="3"
                  bg="bg.subtle"
                  borderRadius="md"
                  maxH="200px"
                  overflowY="auto"
                  fontSize="2xs"
                  fontFamily="mono"
                  whiteSpace="pre-wrap"
                  wordBreak="break-all"
                >
                  {JSON.stringify(JSON.parse(parsed.rawJSON), null, 2)}
                </Box>
              )}
            </Box>

            {/* Buttons */}
            <HStack gap="3" justify="space-between">
              <Button flex="1" variant="outline" size="sm" onClick={() => request.resolve(false)}>
                Reject
              </Button>
              <Button flex="1" colorPalette="teal" size="sm" onClick={() => request.resolve(true)}>
                Approve
              </Button>
            </HStack>

            <Text fontSize="2xs" color="fg.muted" textAlign="center">
              Auto-reject in {timeLeft}s
            </Text>
          </VStack>
        </Box>
      </Box>
    </Portal>
  );
}
