import type { ApiKeyCreds, TickSize } from "@polymarket/clob-client";

export interface AppState {
  provider: any | null;
  signer: any | null;
  signerAddress: string | null;
  apiCreds: ApiKeyCreds | null;
  client: any | null;
  lastVerify: { tickSize: TickSize; negRisk: boolean; minOrderSize?: number } | null;
}

export interface OpenOrder {
  id: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  price: string;
  original_size: string;
  size_matched: string;
  outcome: string;
  owner: string;
  created_at: number;
  expiration: number;
  order_type: string;
  status: string;
}

export interface Position {
  asset_id: string;
  market: string;
  outcome: string;
  size: string;
  avg_price: string;
  side: string;
  realized_pnl?: string;
  unrealized_pnl?: string;
  cur_price?: string;
}

export interface TradeHistory {
  id: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  timestamp: number;
  status: string;
  fee_rate_bps?: string;
  order_id?: string;
}

export const HOST = "https://clob.polymarket.com";
export const CHAIN_ID = 137;
export const SIGNATURE_TYPE = 0;

export const ADDRESSES = {
  USDCe: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
} as const;
