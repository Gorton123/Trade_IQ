import type { Candle, Instrument, Timeframe } from "@shared/schema";

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY || "";
const BASE_URL = "https://www.alphavantage.co/query";

const instrumentMapping: Record<Instrument, { fromCurrency: string; toCurrency: string }> = {
  XAUUSD: { fromCurrency: "XAU", toCurrency: "USD" },
  XAGUSD: { fromCurrency: "XAG", toCurrency: "USD" },
  EURUSD: { fromCurrency: "EUR", toCurrency: "USD" },
  GBPUSD: { fromCurrency: "GBP", toCurrency: "USD" },
  USDCHF: { fromCurrency: "USD", toCurrency: "CHF" },
  AUDUSD: { fromCurrency: "AUD", toCurrency: "USD" },
  NZDUSD: { fromCurrency: "NZD", toCurrency: "USD" },
};

const timeframeMapping: Record<Timeframe, { function: string; interval?: string }> = {
  "1m": { function: "FX_INTRADAY", interval: "1min" },
  "5m": { function: "FX_INTRADAY", interval: "5min" },
  "15m": { function: "FX_INTRADAY", interval: "15min" },
  "1h": { function: "FX_INTRADAY", interval: "60min" },
  "4h": { function: "FX_INTRADAY", interval: "60min" }, // 4h approximated from 1h
  "1D": { function: "FX_DAILY" },
};

interface AlphaVantageResponse {
  "Realtime Currency Exchange Rate"?: {
    "1. From_Currency Code": string;
    "3. To_Currency Code": string;
    "5. Exchange Rate": string;
    "6. Last Refreshed": string;
    "8. Bid Price": string;
    "9. Ask Price": string;
  };
  "Time Series FX (Intraday)"?: Record<string, {
    "1. open": string;
    "2. high": string;
    "3. low": string;
    "4. close": string;
  }>;
  "Time Series FX (Daily)"?: Record<string, {
    "1. open": string;
    "2. high": string;
    "3. low": string;
    "4. close": string;
  }>;
  "Meta Data"?: Record<string, string>;
  Note?: string;
  Information?: string;
}

export async function getRealtimeQuote(instrument: Instrument): Promise<{
  price: number;
  bid: number;
  ask: number;
  timestamp: string;
} | null> {
  const { fromCurrency, toCurrency } = instrumentMapping[instrument];
  
  const params = new URLSearchParams({
    function: "CURRENCY_EXCHANGE_RATE",
    from_currency: fromCurrency,
    to_currency: toCurrency,
    apikey: API_KEY,
  });

  try {
    const response = await fetch(`${BASE_URL}?${params}`);
    const data: AlphaVantageResponse = await response.json();

    if (data.Note || data.Information) {
      console.warn("Alpha Vantage API limit:", data.Note || data.Information);
      return null;
    }

    const quote = data["Realtime Currency Exchange Rate"];
    if (!quote) return null;

    return {
      price: parseFloat(quote["5. Exchange Rate"]),
      bid: parseFloat(quote["8. Bid Price"]) || parseFloat(quote["5. Exchange Rate"]),
      ask: parseFloat(quote["9. Ask Price"]) || parseFloat(quote["5. Exchange Rate"]),
      timestamp: quote["6. Last Refreshed"],
    };
  } catch (error) {
    console.error("Error fetching quote:", error);
    return null;
  }
}

export async function getCandles(
  instrument: Instrument,
  timeframe: Timeframe,
  limit: number = 100
): Promise<Candle[]> {
  const { fromCurrency, toCurrency } = instrumentMapping[instrument];
  const tfConfig = timeframeMapping[timeframe];

  const params = new URLSearchParams({
    function: tfConfig.function,
    from_symbol: fromCurrency,
    to_symbol: toCurrency,
    apikey: API_KEY,
    outputsize: "compact",
  });

  if (tfConfig.interval) {
    params.set("interval", tfConfig.interval);
  }

  try {
    const response = await fetch(`${BASE_URL}?${params}`);
    const data: AlphaVantageResponse = await response.json();

    if (data.Note || data.Information) {
      console.warn("Alpha Vantage API limit:", data.Note || data.Information);
      return [];
    }

    const timeSeries = data["Time Series FX (Intraday)"] || data["Time Series FX (Daily)"];
    if (!timeSeries) return [];

    const candles: Candle[] = Object.entries(timeSeries)
      .slice(0, limit)
      .map(([timestamp, ohlc]) => ({
        timestamp,
        open: parseFloat(ohlc["1. open"]),
        high: parseFloat(ohlc["2. high"]),
        low: parseFloat(ohlc["3. low"]),
        close: parseFloat(ohlc["4. close"]),
      }));

    // For 4H timeframe, aggregate 1H candles
    if (timeframe === "4h") {
      return aggregateCandles(candles, 4);
    }

    return candles;
  } catch (error) {
    console.error("Error fetching candles:", error);
    return [];
  }
}

function aggregateCandles(candles: Candle[], period: number): Candle[] {
  const aggregated: Candle[] = [];
  
  for (let i = 0; i < candles.length; i += period) {
    const group = candles.slice(i, i + period);
    if (group.length === 0) continue;

    aggregated.push({
      timestamp: group[0].timestamp,
      open: group[group.length - 1].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[0].close,
    });
  }

  return aggregated;
}

// Rate limiter for API calls
let lastCallTime = 0;
const MIN_CALL_INTERVAL = 12000; // 12 seconds between calls (5 calls/minute limit)

export async function rateLimitedFetch<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastCall = now - lastCallTime;
  
  if (timeSinceLastCall < MIN_CALL_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_CALL_INTERVAL - timeSinceLastCall));
  }
  
  lastCallTime = Date.now();
  return fn();
}
