import { useEffect, useMemo, useState } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Input,
  IconButton,
  Center,
  Spinner,
} from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import BigNumber from "bignumber.js";
import { amm } from "../../../../wailsjs/go/models";
import { useLiquidityPools } from "../../../hooks/useLiquidityPools";
import { usePoolTx } from "../../../hooks/usePoolTx";
import { useSharedAssets } from "../../../context/AssetsContext";
import {
  amountToBigNumberUAmount,
  prettyAmount,
  toBigNumber,
  uAmountToAmount,
} from "../../../utils/amount";
import { sanitizeAmountInput, isValidSlippage } from "../swapHelpers";
import { TokenLogo } from "../../TokenLogo";
import {
  calculatePoolOppositeAmount,
  calculatePoolPrice,
  calculateSharesFromAmounts,
  calculateRemoveAmounts,
  calculateUserPoolData,
  SLIPPAGE_PRESETS,
  LP_SHARE_DECIMALS,
} from "./poolHelpers";
import { poolTvlUsd } from "./poolUsd";

interface PoolManageProps {
  poolId: string;
  proxyTarget: string;
  address: string;
  onBack: () => void;
}

type ManageTab = "add" | "remove";

/**
 * The manage view for one liquidity pool: the account's position (shares, share
 * %, underlying token amounts, pool price) over add- and remove-liquidity forms.
 * The pool is read live from `useLiquidityPools` (so reserves/shares stay fresh
 * as the poll refreshes), and balances/position refresh only after a tx confirms
 * — no optimistic updates. Add keeps the pool ratio via the opposite-amount
 * math; remove previews the amounts out before confirming.
 */
export function PoolManage({ poolId, proxyTarget, address, onBack }: PoolManageProps) {
  const { pools, isLoading, reload: reloadPools } = useLiquidityPools(proxyTarget);
  const { resolve, logo, reload: reloadAssets } = useSharedAssets();
  const [tab, setTab] = useState<ManageTab>("add");

  const pool = useMemo(() => pools.find((p) => p.id === poolId), [pools, poolId]);

  if (!pool) {
    return (
      <Center h="200px">
        {isLoading ? <Spinner size="lg" colorPalette="blue" /> : <Text color="fg.muted">Pool not found</Text>}
      </Center>
    );
  }

  const baseSym = resolve(pool.base)?.symbol ?? pool.base;
  const quoteSym = resolve(pool.quote)?.symbol ?? pool.quote;
  const onConfirmed = () => {
    reloadPools();
    reloadAssets();
  };

  return (
    <VStack gap="4" align="stretch">
      <HStack gap="3">
        <IconButton aria-label="Back to pools" size="sm" variant="ghost" onClick={onBack}>
          {LuArrowLeft({ size: 18 }) as React.ReactNode}
        </IconButton>
        <HStack gap="1">
          <TokenLogo src={logo(pool.base)} symbol={baseSym} size="7" />
          <TokenLogo src={logo(pool.quote)} symbol={quoteSym} size="7" />
        </HStack>
        <Text fontSize="lg" fontWeight="bold">
          {baseSym}/{quoteSym}
        </Text>
        <Text fontSize="sm" color="fg.muted" ml="auto">
          Fee {toBigNumber(pool.fee || 0).multipliedBy(100).toFixed(2)}%
        </Text>
      </HStack>

      <PositionCard pool={pool} />

      <Box borderWidth="1px" borderRadius="lg" p="4">
        <HStack gap="0" mb="4" borderBottomWidth="1px">
          <TabButton label="Add" active={tab === "add"} onClick={() => setTab("add")} />
          <TabButton label="Remove" active={tab === "remove"} onClick={() => setTab("remove")} />
        </HStack>
        {tab === "add" ? (
          <AddLiquidityForm pool={pool} address={address} onConfirmed={onConfirmed} />
        ) : (
          <RemoveLiquidityForm pool={pool} address={address} onConfirmed={onConfirmed} />
        )}
      </Box>
    </VStack>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between">
      <Text color="fg.muted">{label}</Text>
      <Text fontVariantNumeric="tabular-nums">{value}</Text>
    </HStack>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      flex="1"
      size="sm"
      variant="ghost"
      borderRadius="0"
      fontWeight={active ? "semibold" : "normal"}
      color={active ? "blue.fg" : "fg.muted"}
      borderBottomWidth="2px"
      borderColor={active ? "blue.500" : "transparent"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function PositionCard({ pool }: { pool: amm.Pool }) {
  const { resolve, usdValue } = useSharedAssets();
  const lp = resolve(pool.lpDenom);
  const myShares = lp?.amount ?? "0";
  const totalShares = lp?.supply ?? "0";
  const tvl = poolTvlUsd(pool, usdValue);
  const userData = calculateUserPoolData(myShares, totalShares, tvl);
  const hasPosition = toBigNumber(myShares).gt(0);
  const underlying = calculateRemoveAmounts(myShares, totalShares, pool.reserveBase, pool.reserveQuote);
  const baseSym = resolve(pool.base)?.symbol ?? pool.base;
  const quoteSym = resolve(pool.quote)?.symbol ?? pool.quote;
  const baseDec = resolve(pool.base)?.decimals ?? 6;
  const quoteDec = resolve(pool.quote)?.decimals ?? 6;
  const poolPrice = calculatePoolPrice(pool.base, pool);

  if (!hasPosition) {
    return (
      <Box borderWidth="1px" borderRadius="lg" p="4">
        <Text fontWeight="semibold" mb="1">
          Your position
        </Text>
        <Text fontSize="sm" color="fg.muted">
          You have no liquidity in this pool yet. Add liquidity below to open a position.
        </Text>
        {poolPrice && (
          <Text fontSize="xs" color="fg.muted" mt="2">
            1 {baseSym} = {prettyAmount(poolPrice)} {quoteSym}
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box borderWidth="1px" borderRadius="lg" p="4">
      <HStack justify="space-between" mb="3">
        <Text fontWeight="semibold">Your position</Text>
        <Text fontWeight="medium">
          {userData.userLiquidityUsd.gt(0) ? `$${prettyAmount(userData.userLiquidityUsd.toFixed(2))}` : "—"}
        </Text>
      </HStack>
      <VStack gap="1.5" align="stretch" fontSize="sm">
        <Row label="LP shares" value={prettyAmount(uAmountToAmount(myShares, LP_SHARE_DECIMALS))} />
        <Row label="Share of pool" value={`${userData.userSharesPercentage.toFixed(2)}%`} />
        <Row label={`Pooled ${baseSym}`} value={prettyAmount(uAmountToAmount(underlying.base, baseDec))} />
        <Row label={`Pooled ${quoteSym}`} value={prettyAmount(uAmountToAmount(underlying.quote, quoteDec))} />
        {poolPrice && <Row label="Pool price" value={`1 ${baseSym} = ${prettyAmount(poolPrice)} ${quoteSym}`} />}
      </VStack>
    </Box>
  );
}

/** The 0.5 / 1 / 3 % presets plus a custom field (pools parity). */
function PoolSlippage({ slippage, onChange }: { slippage: number; onChange: (v: number) => void }) {
  const [custom, setCustom] = useState(SLIPPAGE_PRESETS.includes(slippage) ? "" : String(slippage));
  useEffect(() => {
    if (SLIPPAGE_PRESETS.includes(slippage)) setCustom("");
  }, [slippage]);

  const handleCustom = (raw: string) => {
    const value = sanitizeAmountInput(raw);
    setCustom(value);
    if (value !== "" && isValidSlippage(value)) onChange(parseFloat(value));
  };

  return (
    <Box>
      <Text fontSize="xs" color="fg.muted" mb="2">
        Slippage tolerance
      </Text>
      <HStack gap="2" wrap="wrap">
        {SLIPPAGE_PRESETS.map((preset) => {
          const active = custom === "" && slippage === preset;
          return (
            <Button
              key={preset}
              size="xs"
              variant={active ? "solid" : "outline"}
              colorPalette="blue"
              onClick={() => {
                setCustom("");
                onChange(preset);
              }}
              aria-pressed={active}
            >
              {preset}%
            </Button>
          );
        })}
        <HStack gap="1">
          <Input
            size="xs"
            w="72px"
            placeholder="Custom"
            value={custom}
            onChange={(e) => handleCustom(e.target.value)}
            aria-label="Custom slippage"
          />
          <Text fontSize="xs" color="fg.muted">
            %
          </Text>
        </HStack>
      </HStack>
      {slippage > 5 && (
        <Text fontSize="xs" color="orange.fg" mt="1">
          High slippage tolerance
        </Text>
      )}
    </Box>
  );
}

/** A labelled amount input with the token symbol and a balance/Max helper. */
function AmountField({
  label,
  symbol,
  value,
  onChange,
  balanceDisplay,
  onMax,
}: {
  label: string;
  symbol: string;
  value: string;
  onChange: (v: string) => void;
  balanceDisplay?: string;
  onMax?: () => void;
}) {
  return (
    <Box>
      <HStack justify="space-between" mb="1">
        <Text fontSize="xs" color="fg.muted">
          {label}
        </Text>
        {balanceDisplay !== undefined && (
          <HStack gap="1">
            <Text fontSize="xs" color="fg.muted">
              Balance {balanceDisplay}
            </Text>
            {onMax && (
              <Button size="2xs" variant="ghost" colorPalette="blue" onClick={onMax}>
                Max
              </Button>
            )}
          </HStack>
        )}
      </HStack>
      <HStack borderWidth="1px" borderRadius="md" px="3" py="1">
        <Input
          variant="flushed"
          border="none"
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(sanitizeAmountInput(e.target.value))}
          aria-label={label}
        />
        <Text fontWeight="medium" color="fg.muted">
          {symbol}
        </Text>
      </HStack>
    </Box>
  );
}

function AddLiquidityForm({
  pool,
  address,
  onConfirmed,
}: {
  pool: amm.Pool;
  address: string;
  onConfirmed: () => void;
}) {
  const { resolve } = useSharedAssets();
  const { addLiquidity, isSubmitting } = usePoolTx(address);

  const baseDec = resolve(pool.base)?.decimals ?? 6;
  const quoteDec = resolve(pool.quote)?.decimals ?? 6;
  const baseSym = resolve(pool.base)?.symbol ?? pool.base;
  const quoteSym = resolve(pool.quote)?.symbol ?? pool.quote;
  const baseBal = toBigNumber(resolve(pool.base)?.amount ?? 0);
  const quoteBal = toBigNumber(resolve(pool.quote)?.amount ?? 0);
  const totalShares = resolve(pool.lpDenom)?.supply ?? "0";

  const [baseInput, setBaseInput] = useState("");
  const [quoteInput, setQuoteInput] = useState("");
  const [slippage, setSlippage] = useState(0.5);

  const onBaseChange = (v: string) => {
    setBaseInput(v);
    if (!v) return setQuoteInput("");
    const opp = calculatePoolOppositeAmount(pool, amountToBigNumberUAmount(v, baseDec), true);
    setQuoteInput(opp.lte(0) ? "" : uAmountToAmount(opp, quoteDec));
  };
  const onQuoteChange = (v: string) => {
    setQuoteInput(v);
    if (!v) return setBaseInput("");
    const opp = calculatePoolOppositeAmount(pool, amountToBigNumberUAmount(v, quoteDec), false);
    setBaseInput(opp.lte(0) ? "" : uAmountToAmount(opp, baseDec));
  };

  const baseU = baseInput ? amountToBigNumberUAmount(baseInput, baseDec) : toBigNumber(0);
  const quoteU = quoteInput ? amountToBigNumberUAmount(quoteInput, quoteDec) : toBigNumber(0);
  const expectedShares = useMemo(
    () => calculateSharesFromAmounts(baseU, quoteU, pool.reserveBase, pool.reserveQuote, totalShares),
    [baseU, quoteU, pool.reserveBase, pool.reserveQuote, totalShares],
  );

  const insufficientBase = baseU.gt(baseBal);
  const insufficientQuote = quoteU.gt(quoteBal);
  const valid =
    baseU.gt(0) && quoteU.gt(0) && expectedShares.gt(0) && !insufficientBase && !insufficientQuote;

  const submit = async () => {
    if (!valid) return;
    const ok = await addLiquidity({
      poolId: pool.id,
      baseAmount: baseU.toFixed(0),
      quoteAmount: quoteU.toFixed(0),
      expectedShares,
      slippage,
      onConfirmed,
    });
    if (ok) {
      setBaseInput("");
      setQuoteInput("");
    }
  };

  return (
    <VStack gap="3" align="stretch">
      <AmountField
        label={`${baseSym} amount`}
        symbol={baseSym}
        value={baseInput}
        onChange={onBaseChange}
        balanceDisplay={prettyAmount(uAmountToAmount(baseBal, baseDec))}
        onMax={() => onBaseChange(uAmountToAmount(baseBal, baseDec))}
      />
      <AmountField
        label={`${quoteSym} amount`}
        symbol={quoteSym}
        value={quoteInput}
        onChange={onQuoteChange}
        balanceDisplay={prettyAmount(uAmountToAmount(quoteBal, quoteDec))}
        onMax={() => onQuoteChange(uAmountToAmount(quoteBal, quoteDec))}
      />

      <PoolSlippage slippage={slippage} onChange={setSlippage} />

      {expectedShares.gt(0) && (
        <HStack justify="space-between" fontSize="sm">
          <Text color="fg.muted">Expected LP shares</Text>
          <Text fontVariantNumeric="tabular-nums">
            {prettyAmount(uAmountToAmount(expectedShares, LP_SHARE_DECIMALS))}
          </Text>
        </HStack>
      )}

      {(insufficientBase || insufficientQuote) && (
        <Text fontSize="sm" color="red.fg">
          Insufficient {insufficientBase ? baseSym : quoteSym} balance
        </Text>
      )}

      <Button colorPalette="blue" disabled={!valid || isSubmitting} loading={isSubmitting} onClick={submit}>
        Add liquidity
      </Button>
    </VStack>
  );
}

function RemoveLiquidityForm({
  pool,
  address,
  onConfirmed,
}: {
  pool: amm.Pool;
  address: string;
  onConfirmed: () => void;
}) {
  const { resolve } = useSharedAssets();
  const { removeLiquidity, isSubmitting } = usePoolTx(address);

  const baseDec = resolve(pool.base)?.decimals ?? 6;
  const quoteDec = resolve(pool.quote)?.decimals ?? 6;
  const baseSym = resolve(pool.base)?.symbol ?? pool.base;
  const quoteSym = resolve(pool.quote)?.symbol ?? pool.quote;
  const lp = resolve(pool.lpDenom);
  const myShares = toBigNumber(lp?.amount ?? 0);
  const totalShares = lp?.supply ?? "0";

  const [pct, setPct] = useState(0);
  const [slippage, setSlippage] = useState(0.5);

  const lpU = myShares.multipliedBy(pct).dividedBy(100).integerValue(BigNumber.ROUND_DOWN);
  const out = useMemo(
    () => calculateRemoveAmounts(lpU, totalShares, pool.reserveBase, pool.reserveQuote),
    [lpU, totalShares, pool.reserveBase, pool.reserveQuote],
  );
  const valid = myShares.gt(0) && lpU.gt(0);

  const submit = async () => {
    if (!valid) return;
    const ok = await removeLiquidity({
      poolId: pool.id,
      lpTokens: lpU.toFixed(0),
      expectedBase: out.base,
      expectedQuote: out.quote,
      slippage,
      onConfirmed,
    });
    if (ok) setPct(0);
  };

  if (myShares.lte(0)) {
    return (
      <Text fontSize="sm" color="fg.muted">
        You have no LP shares in this pool to remove.
      </Text>
    );
  }

  return (
    <VStack gap="3" align="stretch">
      <HStack justify="space-between">
        <Text fontSize="sm" color="fg.muted">
          Amount to remove
        </Text>
        <Text fontSize="sm" fontWeight="medium">
          {pct}%
        </Text>
      </HStack>
      <HStack gap="2">
        {[25, 50, 75, 100].map((p) => (
          <Button
            key={p}
            flex="1"
            size="sm"
            variant={pct === p ? "solid" : "outline"}
            colorPalette="blue"
            onClick={() => setPct(p)}
          >
            {p === 100 ? "Max" : `${p}%`}
          </Button>
        ))}
      </HStack>

      <PoolSlippage slippage={slippage} onChange={setSlippage} />

      {lpU.gt(0) && (
        <VStack gap="1.5" align="stretch" fontSize="sm" borderWidth="1px" borderRadius="md" p="3">
          <Text color="fg.muted" fontSize="xs">
            You will receive (before slippage)
          </Text>
          <Row label={baseSym} value={prettyAmount(uAmountToAmount(out.base, baseDec))} />
          <Row label={quoteSym} value={prettyAmount(uAmountToAmount(out.quote, quoteDec))} />
        </VStack>
      )}

      <Button colorPalette="blue" disabled={!valid || isSubmitting} loading={isSubmitting} onClick={submit}>
        Remove liquidity
      </Button>
    </VStack>
  );
}
