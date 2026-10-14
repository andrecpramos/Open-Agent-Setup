// Types for _usage.mjs, for the CLI's TypeScript (src/ imports the module from kit/hooks/ so
// the tiers, prices and cost math exist once). Never installed: the installer copies only
// *.mjs hooks. Change this file with _usage.mjs.

import type { SubagentRun, TokenBucket } from './_transcript.mjs';

export type Tier = 'frontier' | 'high' | 'medium' | 'low';

/** USD per million tokens. `cacheWrite` is the 5-minute write; `long` applies to prompts over `above` tokens. */
export interface PriceCard {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
  long?: { above: number; input: number; output: number; cacheRead?: number; cacheWrite?: number; cacheWrite1h?: number };
}

/** The model and reasoning effort one provider runs a tier on; `alias` is Claude Code's name for it. */
export interface TierModel {
  model: string;
  alias?: string;
  effort?: string;
}

export interface Provider {
  label: string;
  /** The install targets (agents) that run on this provider's models. */
  agents: string[];
  source?: string;
  tiers: Partial<Record<Tier, TierModel>>;
}

/** kit/models.json, after a project's overrides. */
export interface ModelTable {
  asOf?: string;
  tiers?: Partial<Record<Tier, { use: string }>>;
  families?: Record<string, string>;
  providers: Record<string, Provider>;
  prices: Record<string, PriceCard>;
  /** What the report compares against: 'main', a tier or a model id. */
  reference?: string;
}

/** A project's `models` section in sdlc.config.json. */
export interface ModelOverrides {
  prices?: Record<string, Partial<PriceCard>>;
  tiers?: Record<string, Partial<Record<Tier, string | Partial<TierModel>>>>;
  reference?: string;
}

export interface UsageModelRow {
  model: string;
  tier: string | null;
  calls: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost: number | null;
  share: number | null;
  /** 'main' and the subagent types that used the model. */
  where: string[];
}

export interface RoutingSide {
  runs: Record<string, number>;
  cost: number;
  /** The same tokens priced on each window's main model. */
  atMain: number;
}

export interface QualitySide {
  windows: number;
  checked: number | null;
  passed: number | null;
  corrections: number | null;
  unverified: number | null;
  failed: number | null;
}

export interface UsageReport {
  asOf: string | null;
  windows: number;
  from: string | null;
  to: string | null;
  models: UsageModelRow[];
  total: number;
  unpriced: string[];
  reported: number | null;
  routing: { main: { cost: number }; down: RoutingSide; up: RoutingSide; same: RoutingSide };
  reference: { name: string; label: string; cost: number; priced: boolean; saved: number; share: number | null };
  quality: { routed: QualitySide; single: QualitySide };
}

export type AgentsUsage = Record<string, { runs: number; models: Record<string, TokenBucket> }>;

export const TIERS: Tier[];
export function readModels(file: string): ModelTable | null;
export function mergeModels(base: unknown, overrides: unknown): ModelTable;
export function projectModels(root: string, config?: unknown): ModelTable;
export function normalizeModel(id: unknown): string;
export function priceFor(table: ModelTable | null | undefined, id: string): PriceCard | null;
export function tiersOf(table: ModelTable | null | undefined, id: string): Tier[];
export function tierOf(table: ModelTable | null | undefined, id: string): Tier | null;
export function providerOf(table: ModelTable | null | undefined, id: string): string | null;
export function costOf(price: PriceCard | null | undefined, bucket: TokenBucket | Record<string, unknown> | null | undefined): number | null;
export function addBucket(into: Record<string, unknown>, b: unknown): TokenBucket;
export function subagentUsage(transcriptPath: string, runs: SubagentRun[], state?: { depth: number; seen: Set<string> }): AgentsUsage;
export function usageReport(rows: unknown[], table: ModelTable, opts?: { reference?: string; reported?: number | null }): UsageReport;
export function formatUsd(v: number | null | undefined): string;
export function usageText(rep: UsageReport): string;
export function usageLine(rep: UsageReport): string;
