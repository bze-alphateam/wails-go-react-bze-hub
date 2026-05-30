// TypeScript interfaces for staking data returned by Go backend.
// These mirror the JSON-serialized protobuf structures.

export interface Validator {
  operator_address: string;
  consensus_pubkey: { "@type": string; key: string };
  jailed: boolean;
  status: string; // BOND_STATUS_BONDED, BOND_STATUS_UNBONDING, BOND_STATUS_UNBONDED
  tokens: string;
  delegator_shares: string;
  description: ValidatorDescription;
  unbonding_height: string;
  unbonding_time: string;
  commission: ValidatorCommission;
  min_self_delegation: string;
}

export interface ValidatorDescription {
  moniker: string;
  identity: string;
  website: string;
  security_contact: string;
  details: string;
}

export interface ValidatorCommission {
  commission_rates: {
    rate: string;
    max_rate: string;
    max_change_rate: string;
  };
  update_time: string;
}

export interface DelegationResponse {
  delegation: {
    delegator_address: string;
    validator_address: string;
    shares: string;
  };
  balance: Coin;
}

export interface UnbondingDelegation {
  delegator_address: string;
  validator_address: string;
  entries: UnbondingEntry[];
}

export interface UnbondingEntry {
  creation_height: string;
  completion_time: string;
  initial_balance: string;
  balance: string;
}

export interface Coin {
  denom: string;
  amount: string;
}

export interface DecCoin {
  denom: string;
  amount: string;
}

export interface DelegationRewardsResponse {
  rewards: DelegatorReward[];
  total: DecCoin[];
}

export interface DelegatorReward {
  validator_address: string;
  reward: DecCoin[];
}

export interface StakingPool {
  pool: {
    not_bonded_tokens: string;
    bonded_tokens: string;
  };
}

export interface StakingParams {
  params: {
    unbonding_time: string; // e.g. "1814400s" (21 days in seconds)
    max_validators: number;
    max_entries: number;
    historical_entries: number;
    bond_denom: string;
  };
}

export interface AnnualProvisionsResponse {
  annual_provisions: string;
}

export interface DistributionParams {
  params: {
    community_tax: string;
    base_proposer_reward: string;
    bonus_proposer_reward: string;
    withdraw_addr_enabled: boolean;
  };
}

// BZE Rewards module types

export interface StakingReward {
  reward_id: string;
  prize_amount: string;
  prize_denom: string;
  staking_denom: string;
  duration: number;
  payouts: number;
  min_stake: string;
  lock: number;
  staked_amount: string;
  distributed_stake: string;
}

export interface StakingRewardParticipant {
  address: string;
  reward_id: string;
  amount: string;
  joined_at: string;
}

export interface PendingUnlockParticipant {
  index: string;
  address: string;
  amount: string;
  denom: string;
}

// Combined overview returned by GetStakingOverview
export interface StakingOverview {
  validators?: Validator[];
  delegations?: DelegationResponse[];
  unbonding?: UnbondingDelegation[];
  rewards?: DelegationRewardsResponse;
  pool?: StakingPool;
  stakingParams?: StakingParams;
  annualProvisions?: AnnualProvisionsResponse;
  distributionParams?: DistributionParams;
  stakingRewards?: StakingReward[];
  rewardParticipants?: StakingRewardParticipant[];
  pendingUnlocks?: PendingUnlockParticipant[];
}

// Computed/derived types for UI

export interface ValidatorWithDelegation extends Validator {
  delegatedAmount?: string;
  pendingReward?: string;
}

export interface GroupedRewardStaking {
  stakingDenom: string;
  rewards: StakingReward[];
  userParticipations: StakingRewardParticipant[];
}
