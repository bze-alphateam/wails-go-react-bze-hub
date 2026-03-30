import { useState, useEffect } from "react";
import {
  VStack, HStack, Text, Box, Image, Spinner, Center, IconButton, Portal, Button,
} from "@chakra-ui/react";
import { LuInfo, LuX, LuExternalLink } from "react-icons/lu";
import { GetArticles, OpenURL } from "../../../wailsjs/go/main/App";

interface Article {
  id: string;
  title: string;
  url: string;
  picture: string;
  publisher: string;
  publisherName: string;
  paid: boolean;
  created_at: string;
}

const DEFAULT_THUMBNAIL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' fill='%23718096'%3E%3Crect width='60' height='60' rx='8' fill='%23E2E8F0'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.35em' font-size='12' fill='%23718096'%3EBZE%3C/text%3E%3C/svg%3E";

function timeAgo(unixStr: string): string {
  const ts = parseInt(unixStr, 10);
  if (isNaN(ts) || ts === 0) return "";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function ArticleList() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (!showInfo) return;
    const timer = setTimeout(() => setShowInfo(false), 60_000);
    return () => clearTimeout(timer);
  }, [showInfo]);

  useEffect(() => {
    loadArticles();
    // Refresh every 5 minutes
    const interval = setInterval(loadArticles, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function loadArticles() {
    try {
      const result = await GetArticles(25);
      setArticles(result as Article[] || []);
    } catch (e) {
      console.error("articles fetch:", e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Center h="200px">
        <Spinner size="sm" color="teal.500" />
      </Center>
    );
  }

  if (articles.length === 0) {
    return (
      <Center h="200px">
        <Text fontSize="sm" color="fg.muted">No articles yet</Text>
      </Center>
    );
  }

  return (
    <VStack align="stretch" gap="0">
      <HStack px="4" py="3" borderBottomWidth="1px" borderColor="border" justify="space-between">
        <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
          {showInfo ? "About These Articles" : "Latest Articles"}
        </Text>
        <IconButton
          aria-label={showInfo ? "Close info" : "About CoinTrunk articles"}
          size="2xs"
          variant="ghost"
          onClick={() => setShowInfo(!showInfo)}
        >
          {showInfo
            ? LuX({}) as React.ReactNode
            : LuInfo({}) as React.ReactNode
          }
        </IconButton>
      </HStack>

      {showInfo && (
        <Box px="4" py="4" overflowY="auto" flex="1">
          <VStack align="stretch" gap="4" fontSize="sm" color="fg.muted">
            <Text>
              These articles are published on the <strong>BeeZee blockchain</strong> through <strong>CoinTrunk</strong> — a decentralized, censorship-resistant content system.
            </Text>
            <Text>
              Content is shared by community-approved publishers and curated through on-chain governance. Only articles from approved domains are accepted.
            </Text>
            <Box
              p="3"
              borderWidth="1px"
              borderColor="orange.300"
              borderRadius="md"
              bg="orange.50"
              _dark={{ bg: "orange.900/20", borderColor: "orange.700" }}
            >
              <Text fontSize="sm">
                Articles marked <Text as="span" fontWeight="semibold" color="orange.800" _dark={{ color: "orange.200" }}>Sponsored</Text> are submitted anonymously by paying a fee. They are not verified by a trusted publisher — always review the source before trusting the content.
              </Text>
            </Box>
            <Text>Learn more or publish your own:</Text>
            <VStack align="stretch" gap="2">
              <Box
                px="4" py="3" borderWidth="1px" borderColor="border" borderRadius="lg"
                cursor="pointer" _hover={{ bg: "bg.subtle", borderColor: "border" }}
                transition="all 0.15s" onClick={() => OpenURL("https://cointrunk.io")}
              >
                <HStack gap="3">
                  <Box color="fg.muted" flexShrink={0}>{LuInfo({}) as React.ReactNode}</Box>
                  <Box flex="1">
                    <Text fontSize="sm" fontWeight="semibold">cointrunk.io</Text>
                    <Text fontSize="xs" color="fg.muted">About CoinTrunk</Text>
                  </Box>
                  <Box color="fg.muted" fontSize="xs">{LuExternalLink({}) as React.ReactNode}</Box>
                </HStack>
              </Box>
              <Box
                px="4" py="3" borderWidth="1px" borderColor="border" borderRadius="lg"
                cursor="pointer" _hover={{ bg: "bg.subtle", borderColor: "border" }}
                transition="all 0.15s" onClick={() => OpenURL("https://app.cointrunk.io")}
              >
                <HStack gap="3">
                  <Box color="fg.muted" flexShrink={0}>{LuInfo({}) as React.ReactNode}</Box>
                  <Box flex="1">
                    <Text fontSize="sm" fontWeight="semibold">app.cointrunk.io</Text>
                    <Text fontSize="xs" color="fg.muted">Read & publish articles</Text>
                  </Box>
                  <Box color="fg.muted" fontSize="xs">{LuExternalLink({}) as React.ReactNode}</Box>
                </HStack>
              </Box>
            </VStack>
          </VStack>
        </Box>
      )}

      {!showInfo && articles.map((article) => (
        <HStack
          key={article.id}
          px="4"
          py="3"
          gap="3"
          cursor="pointer"
          _hover={{ bg: "bg.subtle" }}
          borderBottomWidth="1px"
          borderColor="border"
          onClick={() => OpenURL(article.url)}
          align="start"
        >
          <Image
            src={article.picture || DEFAULT_THUMBNAIL}
            alt=""
            w="48px"
            h="48px"
            borderRadius="md"
            objectFit="cover"
            flexShrink={0}
            onError={(e: any) => { e.target.src = DEFAULT_THUMBNAIL; }}
          />
          <Box flex="1" minW="0">
            <HStack gap="1.5">
              <Text fontSize="sm" fontWeight="medium" lineClamp={2} flex="1">
                {article.title}
              </Text>
              {article.paid && (
                <Text
                  fontSize="2xs"
                  color="orange.800"
                  fontWeight="semibold"
                  flexShrink={0}
                  px="1.5"
                  py="0.5"
                  bg="orange.200"
                  borderRadius="sm"
                  _dark={{ color: "orange.200", bg: "orange.800" }}
                >
                  Sponsored
                </Text>
              )}
            </HStack>
            <HStack gap="2" mt="0.5">
              <Text fontSize="2xs" color="fg.muted">
                By {article.publisherName || "Unknown"}
              </Text>
              <Text fontSize="2xs" color="fg.muted">
                {timeAgo(article.created_at)}
              </Text>
            </HStack>
          </Box>
        </HStack>
      ))}
    </VStack>
  );
}
