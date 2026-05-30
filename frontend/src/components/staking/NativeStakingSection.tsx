import { useState } from "react";
import { NativeStakingSimple } from "./NativeStakingSimple";
import { NativeStakingAdvanced } from "./NativeStakingAdvanced";
import type {
  Validator,
  DelegationResponse,
  UnbondingDelegation,
  DelegatorReward,
} from "../../utils/stakingTypes";

interface NativeStakingSectionProps {
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
}

export function NativeStakingSection(props: NativeStakingSectionProps) {
  const [isAdvanced, setIsAdvanced] = useState(false);

  if (isAdvanced) {
    return (
      <NativeStakingAdvanced
        {...props}
        onSwitchToSimple={() => setIsAdvanced(false)}
      />
    );
  }

  return (
    <NativeStakingSimple
      {...props}
      onSwitchToAdvanced={() => setIsAdvanced(true)}
    />
  );
}
