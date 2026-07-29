import { useEffect, useMemo, useState } from "react";
import { VStack, HStack, Text, Button, Center, Spinner } from "@chakra-ui/react";
import BigNumber from "bignumber.js";
import { amm, tradebin } from "../../../../wailsjs/go/models";
import { GetPoolsStats } from "../../../../wailsjs/go/main/App";
import { EventsOn } from "../../../../wailsjs/runtime/runtime";
import { useLiquidityPools } from "../../../hooks/useLiquidityPools";
import { useSharedAssets } from "../../../context/AssetsContext";
import { prettyAmount, toBigNumber } from "../../../utils/amount";
import { TokenLogo } from "../../TokenLogo";
import { calculateUserPoolData, type UserPoolData } from "./poolHelpers";
import { indexPoolStats, findPoolStat, poolTvlUsd, poolVolumeUsd, poolApr } from "./poolUsd";

/** How the pool list can be ordered. */
type PoolSort = "tvl" | "apr" | "volume";

interface PoolListProps {
  proxyTarget: string;
  onSelect: (pool: amm.Pool) => void;
}

interface PoolRow {
  pool: amm.Pool;
  tvl: BigNumber | null;
  volume: BigNumber | null;
  apr: number;
  hasPosition: boolean;
  userData: UserPoolData;
}

/** Format a USD BigNumber, or an em dash when unknown. */
function usd(v: BigNumber | null): string {
  return v ? `$${prettyAmount(v.toFixed(2))}` : "—";
}

/** APR color bucket, mirroring the web (green > 15, yellow > 10). */
function aprColor(apr: number): string {
  if (apr > 15) return "green.fg";
  if (apr > 10) return "yellow.fg";
  return "fg";
}

/**
 * The Advanced-tab pools list: every tradebin liquidity pool with TVL, APR and
 * 24h volume (computed the same way as the web from asset prices, reserves and
 * the aggregator pool stats), plus the signed-in account's position. Sortable by
 * TVL / APR / volume; pools the user is in are surfaced in a "My positions"
 * section. Clicking a row opens that pool's manage view.
 */
export function PoolList({ proxyTarget, onSelect }: PoolListProps) {
  const { pools, isLoading } = useLiquidityPools(proxyTarget);
  const { resolve, price, usdValue } = useSharedAssets();
  const [stats, setStats] = useState<tradebin.PoolStat[]>([]);
  const [sort, setSort] = useState<PoolSort>("tvl");

  // Pool stats come from the aggregator; refresh them alongside asset prices.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await GetPoolsStats();
        if (!cancelled) setStats(res ?? []);
      } catch {
        if (!cancelled) setStats([]);
      }
    };
    void load();
    const off = EventsOn("assets:updated", () => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const rows = useMemo<PoolRow[]>(() => {
    const index = indexPoolStats(stats);
    const enriched = pools.map((pool) => {
      const stat = findPoolStat(pool, index);
      const tvl = poolTvlUsd(pool, usdValue);
      const volume = poolVolumeUsd(pool, stat, price);
      const apr = poolApr(pool, tvl, volume);
      const lp = resolve(pool.lpDenom);
      const myShares = lp?.amount ?? "0";
      const totalShares = lp?.supply ?? "0";
      const userData = calculateUserPoolData(myShares, totalShares, tvl);
      return { pool, tvl, volume, apr, hasPosition: toBigNumber(myShares).gt(0), userData };
    });

    const metric = (r: PoolRow): number => {
      if (sort === "apr") return r.apr;
      const bn = sort === "tvl" ? r.tvl : r.volume;
      return bn ? bn.toNumber() : -1; // unknown metric sorts last
    };
    return enriched.sort((a, b) => metric(b) - metric(a));
  }, [pools, stats, sort, resolve, price, usdValue]);

  const myPools = rows.filter((r) => r.hasPosition);
  const allPools = rows;

  if (isLoading && pools.length === 0) {
    return (
      <Center h="200px">
        <Spinner size="lg" colorPalette="blue" />
      </Center>
    );
  }

  if (pools.length === 0) {
    return (
      <Center py="12">
        <Text color="fg.muted">No liquidity pools</Text>
      </Center>
    );
  }

  return (
    <VStack gap="3" align="stretch">
      <HStack gap="2" justify="flex-end">
        <Text fontSize="sm" color="fg.muted" mr="auto">
          Sort by
        </Text>
        <SortButton label="TVL" active={sort === "tvl"} onClick={() => setSort("tvl")} />
        <SortButton label="APR" active={sort === "apr"} onClick={() => setSort("apr")} />
        <SortButton label="Volume" active={sort === "volume"} onClick={() => setSort("volume")} />
      </HStack>

      {myPools.length > 0 && (
        <VStack gap="2" align="stretch">
          <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
            My positions
          </Text>
          {myPools.map((r) => (
            <PoolRowItem key={`my-${r.pool.id}`} row={r} onClick={() => onSelect(r.pool)} />
          ))}
        </VStack>
      )}

      <VStack gap="2" align="stretch">
        {myPools.length > 0 && (
          <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
            All pools
          </Text>
        )}
        {allPools.map((r) => (
          <PoolRowItem key={r.pool.id} row={r} onClick={() => onSelect(r.pool)} />
        ))}
      </VStack>
    </VStack>
  );
}

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant={active ? "subtle" : "outline"}
      colorPalette={active ? "blue" : "gray"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <VStack gap="0" align="end" minW="20">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontWeight="medium" fontVariantNumeric="tabular-nums" color={color}>
        {value}
      </Text>
    </VStack>
  );
}

function PoolRowItem({ row, onClick }: { row: PoolRow; onClick: () => void }) {
  const { resolve, logo } = useSharedAssets();
  const { pool } = row;
  const baseSym = resolve(pool.base)?.symbol ?? pool.base;
  const quoteSym = resolve(pool.quote)?.symbol ?? pool.quote;
  const feePct = toBigNumber(pool.fee || 0).multipliedBy(100);

  return (
    <HStack
      justify="space-between"
      borderWidth="1px"
      borderRadius="lg"
      p="3"
      gap="4"
      cursor="pointer"
      _hover={{ bg: "bg.subtle", borderColor: "blue.500/40" }}
      onClick={onClick}
      role="button"
      aria-label={`Manage ${baseSym}/${quoteSym} pool`}
    >
      <HStack gap="3" minW="0">
        <HStack gap="1">
          <TokenLogo src={logo(pool.base)} symbol={baseSym} size="7" />
          <TokenLogo src={logo(pool.quote)} symbol={quoteSym} size="7" />
        </HStack>
        <VStack gap="0" align="start" minW="0">
          <Text fontWeight="semibold">
            {baseSym}/{quoteSym}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {row.hasPosition
              ? `My liquidity ${usd(row.userData.userLiquidityUsd)}`
              : `Fee ${feePct.toFixed(feePct.lt(1) ? 2 : 1)}%`}
          </Text>
        </VStack>
      </HStack>

      <HStack gap="5">
        <Stat label="TVL" value={usd(row.tvl)} />
        <Stat label="APR" value={row.apr > 0 ? `${row.apr.toFixed(2)}%` : "—"} color={aprColor(row.apr)} />
        <Stat label="Vol 24h" value={usd(row.volume)} />
        <Button size="sm" variant="subtle" colorPalette="blue">
          {row.hasPosition ? "Manage" : "View"}
        </Button>
      </HStack>
    </HStack>
  );
}
