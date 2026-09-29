import type { Address } from 'viem';

export type EntryPointVersion = '0.8' | '0.9';

// GIWA's bundler serves only EntryPoint v0.9 (eth_supportedEntryPoints, checked 2026-09-29).
export const ENTRY_POINT_V09: Address = '0x433709009B8330FDa32311DF1C2AFA402eD8D009';
export const DETERMINISTIC_DEPLOYER: Address = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
// Canonical eth-infinitism Simple7702Account addresses (same as viem's defaults).
export const SIMPLE_7702_ACCOUNT: Record<EntryPointVersion, Address> = {
  '0.8': '0xe6Cae83BdE06E4c305530e199D7217f42808555B',
  '0.9': '0xa46cc63eBF4Bd77888AA327837d20b23A63a56B5',
};
