import type { OrderAction, OrderSide } from "@/lib/domain";

export type KalshiClientConfig = {
  baseUrl: string;
  apiKey?: string;
  privateKeyPem?: string;
};

export type KalshiMarketResponse = {
  markets?: Array<Record<string, unknown>>;
  market?: Record<string, unknown>;
  cursor?: string;
};

export type KalshiOrderRequest = {
  ticker: string;
  action: OrderAction;
  side: OrderSide;
  count: number;
  type: "limit" | "market";
  client_order_id: string;
  yes_price?: number;
  no_price?: number;
};

export type KalshiOrderResponse = {
  order?: Record<string, unknown>;
  error?: unknown;
};
