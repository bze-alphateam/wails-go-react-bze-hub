import { useState } from "react";
import {
  Box,
  HStack,
  VStack,
  Text,
  Button,
  Badge,
  Table,
} from "@chakra-ui/react";
import { LuChevronLeft } from "react-icons/lu";
import { formatAmount, ubzeToHuman, truncateAddress } from "../../utils/stakingHelpers";
import { DelegateModal } from "./modals/DelegateModal";
import { UndelegateModal } from "./modals/UndelegateModal";
import { RedelegateModal } from "./modals/RedelegateModal";
import type {
  Validator,
  DelegationResponse,
  UnbondingDelegation,
  DelegatorReward,
} from "../../utils/stakingTypes";

interface NativeStakingAdvancedProps {
  validators: Validator[];
  delegations: DelegationResponse[];
  unbonding: UnbondingDelegation[];
  validatorRewards: DelegatorReward[];
  totalRewardsUbze: string;
  totalDelegatedUbze: string;
  apr: string;
  unbondingDays: number;
  address: string;
  onReload: () => void;
  onSwitchToSimple: () => void;
}

interface ModalState {
  type: "delegate" | "undelegate" | "redelegate" | null;
  validatorAddress: string;
  validatorMoniker: string;
  delegatedAmount: string;
}

export function NativeStakingAdvanced({
  validators,
  delegations,
  validatorRewards,
  unbondingDays,
  address,
  onReload,
  onSwitchToSimple,
}: NativeStakingAdvancedProps) {
  const [modal, setModal] = useState<ModalState>({
    type: null,
    validatorAddress: "",
    validatorMoniker: "",
    delegatedAmount: "0",
  });

  // Build a map of validator address -> delegation amount
  const delegationMap = new Map<string, string>();
  for (const del of delegations) {
    delegationMap.set(
      del.delegation.validator_address,
      del.balance.amount
    );
  }

  // Build a map of validator address -> pending reward
  const rewardMap = new Map<string, string>();
  for (const r of validatorRewards) {
    const ubzeReward = r.reward?.find((c) => c.denom === "ubze");
    if (ubzeReward) {
      rewardMap.set(r.validator_address, ubzeReward.amount.split(".")[0]);
    }
  }

  // Sort: delegated validators first, then by tokens
  const sortedValidators = [...validators].sort((a, b) => {
    const aDel = delegationMap.has(a.operator_address) ? 1 : 0;
    const bDel = delegationMap.has(b.operator_address) ? 1 : 0;
    if (aDel !== bDel) return bDel - aDel;
    return parseFloat(b.tokens) - parseFloat(a.tokens);
  });

  const openModal = (
    type: "delegate" | "undelegate" | "redelegate",
    v: Validator
  ) => {
    setModal({
      type,
      validatorAddress: v.operator_address,
      validatorMoniker: v.description.moniker,
      delegatedAmount: delegationMap.get(v.operator_address) || "0",
    });
  };

  const closeModal = () =>
    setModal({ type: null, validatorAddress: "", validatorMoniker: "", delegatedAmount: "0" });

  return (
    <Box
      p="5"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      mb="4"
    >
      <HStack justify="space-between" mb="4">
        <HStack gap="2">
          <Button size="xs" variant="ghost" onClick={onSwitchToSimple}>
            {LuChevronLeft({}) as React.ReactNode} Simple
          </Button>
          <Text fontSize="md" fontWeight="bold">
            Native Staking — Validators
          </Text>
          <Badge colorPalette="teal" size="sm">
            {validators.length}
          </Badge>
        </HStack>
      </HStack>

      <Box overflowX="auto">
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Validator</Table.ColumnHeader>
              <Table.ColumnHeader>Voting Power</Table.ColumnHeader>
              <Table.ColumnHeader>Commission</Table.ColumnHeader>
              <Table.ColumnHeader>My Delegation</Table.ColumnHeader>
              <Table.ColumnHeader>Rewards</Table.ColumnHeader>
              <Table.ColumnHeader>Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sortedValidators.map((v) => {
              const myDelegation = delegationMap.get(v.operator_address);
              const myReward = rewardMap.get(v.operator_address);
              const isDelegated = !!myDelegation;

              return (
                <Table.Row
                  key={v.operator_address}
                  bg={isDelegated ? "teal.500/5" : undefined}
                >
                  <Table.Cell>
                    <VStack gap="0" align="start">
                      <Text fontSize="sm" fontWeight="medium">
                        {v.description.moniker}
                      </Text>
                      <Text fontSize="xs" color="fg.muted">
                        {truncateAddress(v.operator_address)}
                      </Text>
                    </VStack>
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm">
                      {formatAmount(ubzeToHuman(v.tokens))} BZE
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm">
                      {(parseFloat(v.commission.commission_rates.rate) * 100).toFixed(1)}%
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {myDelegation ? (
                      <Text fontSize="sm" fontWeight="medium" color="teal.500">
                        {formatAmount(ubzeToHuman(myDelegation))} BZE
                      </Text>
                    ) : (
                      <Text fontSize="sm" color="fg.muted">—</Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {myReward ? (
                      <Text fontSize="sm" color="teal.500">
                        {formatAmount(ubzeToHuman(myReward), 4)} BZE
                      </Text>
                    ) : (
                      <Text fontSize="sm" color="fg.muted">—</Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <HStack gap="1">
                      <Button
                        size="xs"
                        variant="outline"
                        colorPalette="teal"
                        onClick={() => openModal("delegate", v)}
                      >
                        Delegate
                      </Button>
                      {isDelegated && (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => openModal("redelegate", v)}
                          >
                            Redelegate
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => openModal("undelegate", v)}
                          >
                            Undelegate
                          </Button>
                        </>
                      )}
                    </HStack>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </Box>

      {/* Modals */}
      <DelegateModal
        isOpen={modal.type === "delegate"}
        onClose={closeModal}
        validatorAddress={modal.validatorAddress}
        validatorMoniker={modal.validatorMoniker}
        address={address}
        onSuccess={onReload}
      />
      <UndelegateModal
        isOpen={modal.type === "undelegate"}
        onClose={closeModal}
        validatorAddress={modal.validatorAddress}
        validatorMoniker={modal.validatorMoniker}
        delegatedAmount={modal.delegatedAmount}
        unbondingDays={unbondingDays}
        address={address}
        onSuccess={onReload}
      />
      <RedelegateModal
        isOpen={modal.type === "redelegate"}
        onClose={closeModal}
        srcValidatorAddress={modal.validatorAddress}
        srcValidatorMoniker={modal.validatorMoniker}
        delegatedAmount={modal.delegatedAmount}
        validators={validators}
        address={address}
        onSuccess={onReload}
      />
    </Box>
  );
}
