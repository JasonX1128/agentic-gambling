import "server-only";

import fs from "fs";
import { getEnv, kalshiConfigured } from "@/lib/config/env";
import type { Market, OrderBook } from "@/lib/domain";
import type { KalshiClientConfig, KalshiOrderRequest } from "@/lib/kalshi/types";
import { canonicalKalshiPath, signKalshiRequest } from "@/lib/kalshi/signing";

export class KalshiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KalshiConfigurationError";
  }
}

function normalizePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function loadKalshiPrivateKey(): string | undefined {
  const env = getEnv();
  if (env.KALSHI_PRIVATE_KEY) return normalizePem(env.KALSHI_PRIVATE_KEY);
  if (env.KALSHI_API_SECRET) return normalizePem(env.KALSHI_API_SECRET);
  if (env.KALSHI_PRIVATE_KEY_PATH) return fs.readFileSync(env.KALSHI_PRIVATE_KEY_PATH, "utf8");
  return undefined;
}

export function getKalshiConfig(): KalshiClientConfig {
  const env = getEnv();
  return {
    baseUrl: env.KALSHI_BASE_URL,
    apiKey: env.KALSHI_API_KEY,
    privateKeyPem: loadKalshiPrivateKey()
  };
}

export class KalshiClient {
  private config: KalshiClientConfig;

  constructor(config = getKalshiConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.privateKeyPem);
  }

  async listMarkets(limit = 20): Promise<Market[]> {
    const target = Math.max(limit, 1);
    const pageSize = Math.min(target, 1000);
    const markets: Record<string, unknown>[] = [];
    let cursor: string | undefined;

    while (markets.length < target) {
      const params = new URLSearchParams({
        limit: String(pageSize),
        status: "open",
        mve_filter: "exclude"
      });
      if (cursor) params.set("cursor", cursor);

      const response = await this.request<{ markets?: Record<string, unknown>[]; cursor?: string }>("GET", `/markets?${params}`, {
        authOptional: true
      });
      const page = response.markets ?? [];
      markets.push(...page);
      cursor = stringValue(response.cursor);
      if (!cursor || page.length === 0) break;
    }

    return markets.slice(0, target).map((market, index) => normalizeKalshiMarket(market, index));
  }

  async getMarket(ticker: string): Promise<Market> {
    const response = await this.request<{ market?: Record<string, unknown> }>("GET", `/markets/${encodeURIComponent(ticker)}`, {
      authOptional: true
    });
    return normalizeKalshiMarket(response.market ?? {}, 0);
  }

  async getOrderBook(ticker: string, depth = 10): Promise<OrderBook> {
    const response = await this.request<Record<string, any>>(
      "GET",
      `/markets/${encodeURIComponent(ticker)}/orderbook?depth=${depth}`,
      { authOptional: true }
    );
    const book = response.orderbook_fp ?? response.orderbook ?? {};
    return {
      ticker,
      yes: normalizeBookSide(book.yes_dollars ?? book.yes ?? []),
      no: normalizeBookSide(book.no_dollars ?? book.no ?? []),
      updatedAt: new Date().toISOString(),
      source: "kalshi"
    };
  }

  async getBalance(): Promise<Record<string, unknown>> {
    return this.request("GET", "/portfolio/balance", { authOptional: false });
  }

  async getPositions(): Promise<Record<string, unknown>> {
    return this.request("GET", "/portfolio/positions", { authOptional: false });
  }

  async getOrders(): Promise<Record<string, unknown>> {
    return this.request("GET", "/portfolio/orders", { authOptional: false });
  }

  async createOrder(order: KalshiOrderRequest): Promise<Record<string, unknown>> {
    return this.request("POST", "/portfolio/orders", { body: order, authOptional: false });
  }

  async cancelOrder(orderId: string): Promise<Record<string, unknown>> {
    return this.request("DELETE", `/portfolio/orders/${encodeURIComponent(orderId)}`, { authOptional: false });
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    endpointPath: string,
    options: { body?: unknown; authOptional: boolean }
  ): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`}`;
    const headers: Record<string, string> = {
      accept: "application/json"
    };
    if (options.body) headers["content-type"] = "application/json";

    if (this.isConfigured() && !options.authOptional) {
      const timestamp = Date.now().toString();
      const path = canonicalKalshiPath(this.config.baseUrl, endpointPath);
      headers["KALSHI-ACCESS-KEY"] = this.config.apiKey!;
      headers["KALSHI-ACCESS-TIMESTAMP"] = timestamp;
      headers["KALSHI-ACCESS-SIGNATURE"] = signKalshiRequest({
        privateKeyPem: this.config.privateKeyPem!,
        timestamp,
        method,
        path
      });
    } else if (!options.authOptional) {
      throw new KalshiConfigurationError(
        "Kalshi authenticated request blocked: set KALSHI_API_KEY and KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH."
      );
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Kalshi ${method} ${endpointPath} failed with ${response.status}: ${text.slice(0, 300)}`);
    }
    return response.json() as Promise<T>;
  }
}

function normalizeKalshiMarket(raw: Record<string, unknown>, index: number): Market {
  const ticker = stringValue(raw.ticker) || stringValue(raw.market_ticker) || `KALSHI-${index}`;
  const title = stringValue(raw.title) || stringValue(raw.subtitle) || ticker;
  const yesBid = dollarCents(raw.yes_bid_dollars) ?? cents(raw.yes_bid) ?? dollarCents(raw.last_price_dollars) ?? cents(raw.last_price) ?? 0;
  const yesAsk =
    dollarCents(raw.yes_ask_dollars) ?? cents(raw.yes_ask) ?? dollarCents(raw.last_price_dollars) ?? cents(raw.last_price) ?? yesBid;
  const noBid = dollarCents(raw.no_bid_dollars) ?? cents(raw.no_bid) ?? Math.max(0, 100 - yesAsk);
  const noAsk = dollarCents(raw.no_ask_dollars) ?? cents(raw.no_ask) ?? Math.max(0, 100 - yesBid);
  const category = stringValue(raw.category) || stringValue(raw.series_ticker) || "Uncategorized";
  const volume = firstNumber(raw.volume_fp, raw.volume, raw.volume_24h_fp, raw.volume_24h) ?? 0;
  const volume24h = firstNumber(raw.volume_24h_fp, raw.volume_24h) ?? 0;
  const openInterest = firstNumber(raw.open_interest_fp, raw.open_interest) ?? 0;
  const topOfBookSize =
    (firstNumber(raw.yes_bid_size_fp, raw.yes_bid_size) ?? 0) + (firstNumber(raw.yes_ask_size_fp, raw.yes_ask_size) ?? 0);
  const liquidityDollars = firstNumber(raw.liquidity_dollars, raw.liquidity) ?? 0;
  const liquidity = Math.max(liquidityDollars, topOfBookSize, volume24h, Math.min(volume, openInterest));
  return {
    id: ticker,
    ticker,
    eventTicker: stringValue(raw.event_ticker) || stringValue(raw.series_ticker),
    title,
    category,
    sector: classifySector(category, title, ticker),
    status: normalizeStatus(stringValue(raw.status)),
    closeTime: stringValue(raw.close_time) || stringValue(raw.expiration_time),
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    lastPrice: dollarCents(raw.last_price_dollars) ?? cents(raw.last_price) ?? yesBid,
    volume,
    openInterest,
    liquidity,
    ruleSummary: stringValue(raw.rules_primary) || stringValue(raw.settlement_rules) || "Rules available from Kalshi market details.",
    settlementSource: stringValue(raw.settlement_source) || "Kalshi public market settlement source",
    source: "kalshi",
    updatedAt: new Date().toISOString()
  };
}

function normalizeBookSide(levels: Array<[string | number, string | number]>): Array<{ price: number; quantity: number }> {
  return levels.map(([price, quantity]) => ({
    price: Number(price) <= 1 ? Number(price) : Number(price) / 100,
    quantity: Number(quantity)
  }));
}

function classifySector(category: string, title: string, ticker: string): string {
  const text = `${category} ${title} ${ticker}`.toLowerCase();
  if (/\b(fed|cpi|inflation|rates?|economy|economic|economics|recession|gdp)\b/.test(text) || /kx(fed|cpi|gdp)/.test(text)) {
    return "macro";
  }
  if (/election|senate|house|president|politic|congress/.test(text)) return "politics";
  if (/weather|hurricane|temperature|climate|\b(high|low) temp\b|kx(high|low)/.test(text)) return "climate";
  if (/sport|nba|nfl|mlb|nhl|soccer|baseball|basketball|football|tennis|itf|match|game/.test(text)) return "sports";
  if (/crypto|bitcoin|ethereum|\bbtc\b|\beth\b|kx(btc|eth)/.test(text)) return "crypto";
  return "general";
}

function normalizeStatus(value: string): Market["status"] {
  if (value === "active") return "open";
  if (value === "open" || value === "closed" || value === "settled") return value;
  return "unknown";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function cents(value: unknown): number | undefined {
  const numeric = firstNumber(value);
  if (numeric === undefined) return undefined;
  if (numeric <= 1) return Math.round(numeric * 100);
  return Math.round(numeric);
}

function dollarCents(value: unknown): number | undefined {
  const numeric = firstNumber(value);
  return numeric === undefined ? undefined : Math.round(numeric * 100);
}

export function kalshiReadiness() {
  return {
    configured: kalshiConfigured(),
    required: ["KALSHI_API_KEY", "KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH", "KALSHI_BASE_URL"]
  };
}
