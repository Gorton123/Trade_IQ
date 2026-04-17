interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface HistoricalDataResult {
  instrument: string;
  timeframe: string;
  data: OHLCV[];
  source: 'oanda' | 'twelvedata' | 'cache' | 'generated';
}

const timeframeToTwelveDataInterval: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1D': '1day',
  '1W': '1week',
  '1M': '1month',
};

const timeframeToOandaGranularity: Record<string, string> = {
  '1m': 'M1',
  '5m': 'M5',
  '15m': 'M15',
  '1h': 'H1',
  '4h': 'H4',
  '1D': 'D',
  '1W': 'W',
  '1M': 'M',
};

const symbolMapping: Record<string, string> = {
  'XAUUSD': 'XAU/USD',
  'XAGUSD': 'XAG/USD',
  'EURUSD': 'EUR/USD',
  'GBPUSD': 'GBP/USD',
  'USDCHF': 'USD/CHF',
  'AUDUSD': 'AUD/USD',
  'NZDUSD': 'NZD/USD',
  'USDJPY': 'USD/JPY',
  'USDCAD': 'USD/CAD',
  'EURGBP': 'EUR/GBP',
  'EURJPY': 'EUR/JPY',
  'GBPJPY': 'GBP/JPY',
};

const oandaInstrumentMapping: Record<string, string> = {
  'XAUUSD': 'XAU_USD',
  'XAGUSD': 'XAG_USD',
  'EURUSD': 'EUR_USD',
  'GBPUSD': 'GBP_USD',
  'USDCHF': 'USD_CHF',
  'AUDUSD': 'AUD_USD',
  'NZDUSD': 'NZD_USD',
  'USDJPY': 'USD_JPY',
  'USDCAD': 'USD_CAD',
  'EURGBP': 'EUR_GBP',
  'EURJPY': 'EUR_JPY',
  'GBPJPY': 'GBP_JPY',
};

const OANDA_DEMO_URL = "https://api-fxpractice.oanda.com";
const OANDA_LIVE_URL = "https://api-fxtrade.oanda.com";

class HistoricalDataService {
  private cache: Map<string, { data: OHLCV[]; timestamp: number }> = new Map();
  private twelveDataApiKey: string | null = null;
  private oandaApiKey: string | null = null;
  private oandaAccountId: string | null = null;
  private oandaIsLive: boolean = false;
  private lastTwelveDataCallTime: number = 0;
  private twelveDataCallsThisMinute: number = 0;
  private minuteResetTime: number = 0;
  private oandaFailCount: number = 0;
  private lastOandaFailTime: number = 0;

  private getCacheExpiry(timeframe: string): number {
    const expiryMap: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '1W': 48 * 60 * 60 * 1000,
      '1M': 72 * 60 * 60 * 1000,
    };
    return expiryMap[timeframe] || 60 * 60 * 1000;
  }

  private async respectTwelveDataRateLimit(): Promise<void> {
    const now = Date.now();
    if (now - this.minuteResetTime > 60000) {
      this.twelveDataCallsThisMinute = 0;
      this.minuteResetTime = now;
    }
    if (this.twelveDataCallsThisMinute >= 7) {
      const waitTime = 60000 - (now - this.minuteResetTime) + 500;
      if (waitTime > 0) {
        console.log(`[HistoricalData] Twelve Data rate limit approaching, waiting ${(waitTime / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.twelveDataCallsThisMinute = 0;
        this.minuteResetTime = Date.now();
      }
    }
    this.twelveDataCallsThisMinute++;
    this.lastTwelveDataCallTime = Date.now();
  }

  constructor() {
    this.twelveDataApiKey = process.env.TWELVE_DATA_API_KEY || null;
    this.oandaApiKey = process.env.OANDA_API_KEY || null;
    this.oandaAccountId = process.env.OANDA_ACCOUNT_ID || null;
    
    if (this.oandaApiKey && this.oandaAccountId) {
      console.log('[HistoricalData] OANDA configured as PRIMARY candle data source');
    }
    if (this.twelveDataApiKey) {
      console.log('[HistoricalData] Twelve Data configured as FALLBACK candle data source');
    }
  }

  private isOandaAvailable(): boolean {
    if (!this.oandaApiKey || !this.oandaAccountId) return false;
    if (this.oandaFailCount >= 5 && Date.now() - this.lastOandaFailTime < 60000) {
      return false;
    }
    return true;
  }

  private getOandaBaseUrl(): string {
    return this.oandaIsLive ? OANDA_LIVE_URL : OANDA_DEMO_URL;
  }

  private async fetchOandaCandles(instrument: string, timeframe: string, count: number): Promise<OHLCV[] | null> {
    if (!this.isOandaAvailable()) return null;

    const oandaInstrument = oandaInstrumentMapping[instrument];
    if (!oandaInstrument) {
      console.warn(`[HistoricalData] No OANDA mapping for instrument: ${instrument}`);
      return null;
    }

    const granularity = timeframeToOandaGranularity[timeframe];
    if (!granularity) {
      console.warn(`[HistoricalData] No OANDA granularity mapping for timeframe: ${timeframe}`);
      return null;
    }

    try {
      const url = `${this.getOandaBaseUrl()}/v3/instruments/${oandaInstrument}/candles?granularity=${granularity}&count=${count}&price=M`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.oandaApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[HistoricalData] OANDA candles error ${response.status}: ${errorText}`);
        this.oandaFailCount++;
        this.lastOandaFailTime = Date.now();
        return null;
      }

      const data = await response.json();

      if (!data.candles || !Array.isArray(data.candles) || data.candles.length === 0) {
        console.warn(`[HistoricalData] OANDA returned no candles for ${instrument}/${timeframe}`);
        return null;
      }

      const completedCandles = data.candles.filter((c: any) => c.complete);

      const ohlcvData: OHLCV[] = completedCandles.map((candle: any) => ({
        timestamp: new Date(candle.time),
        open: parseFloat(candle.mid.o),
        high: parseFloat(candle.mid.h),
        low: parseFloat(candle.mid.l),
        close: parseFloat(candle.mid.c),
        volume: candle.volume ? parseInt(candle.volume) : undefined,
      }));

      this.oandaFailCount = 0;
      return ohlcvData;
    } catch (error) {
      console.error(`[HistoricalData] OANDA fetch error for ${instrument}/${timeframe}:`, error);
      this.oandaFailCount++;
      this.lastOandaFailTime = Date.now();
      return null;
    }
  }

  private async fetchTwelveDataCandles(instrument: string, timeframe: string, count: number): Promise<OHLCV[] | null> {
    if (!this.twelveDataApiKey) return null;

    try {
      await this.respectTwelveDataRateLimit();

      const symbol = symbolMapping[instrument] || instrument;
      const interval = timeframeToTwelveDataInterval[timeframe] || '1h';

      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${count}&apikey=${this.twelveDataApiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'error') {
        console.error('[HistoricalData] Twelve Data API error:', data.message);
        return null;
      }

      if (!data.values || !Array.isArray(data.values)) {
        return null;
      }

      const ohlcvData: OHLCV[] = data.values.map((v: any) => ({
        timestamp: new Date(v.datetime),
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: v.volume ? parseFloat(v.volume) : undefined,
      })).reverse();

      return ohlcvData;
    } catch (error) {
      console.error('[HistoricalData] Twelve Data fetch error:', error);
      return null;
    }
  }

  async getHistoricalData(
    instrument: string, 
    timeframe: string, 
    outputSize: number = 100
  ): Promise<HistoricalDataResult> {
    const cacheKey = `${instrument}_${timeframe}`;
    const cached = this.cache.get(cacheKey);
    const cacheExpiry = this.getCacheExpiry(timeframe);
    
    if (cached && Date.now() - cached.timestamp < cacheExpiry) {
      return {
        instrument,
        timeframe,
        data: cached.data,
        source: 'cache'
      };
    }

    const oandaData = await this.fetchOandaCandles(instrument, timeframe, outputSize);
    if (oandaData && oandaData.length > 0) {
      this.cache.set(cacheKey, { data: oandaData, timestamp: Date.now() });
      return {
        instrument,
        timeframe,
        data: oandaData,
        source: 'oanda'
      };
    }

    console.log(`[HistoricalData] OANDA unavailable for ${instrument}/${timeframe}, trying Twelve Data fallback...`);
    const twelveData = await this.fetchTwelveDataCandles(instrument, timeframe, outputSize);
    if (twelveData && twelveData.length > 0) {
      this.cache.set(cacheKey, { data: twelveData, timestamp: Date.now() });
      return {
        instrument,
        timeframe,
        data: twelveData,
        source: 'twelvedata'
      };
    }

    if (cached) {
      console.log(`[HistoricalData] Using stale cache for ${instrument}/${timeframe}`);
      return { instrument, timeframe, data: cached.data, source: 'cache' };
    }

    console.warn(`[HistoricalData] All sources failed for ${instrument}/${timeframe}, using generated data`);
    return {
      instrument,
      timeframe,
      data: this.generateHistoricalData(instrument, outputSize),
      source: 'generated'
    };
  }

  private generateHistoricalData(instrument: string, count: number): OHLCV[] {
    const isMetal = instrument === 'XAUUSD' || instrument === 'XAGUSD';
    const isJpy = instrument.includes('JPY');
    const basePrice = instrument === 'XAUUSD' ? 2860 :
      instrument === 'XAGUSD' ? 32.50 :
      instrument === 'EURUSD' ? 1.0380 :
      instrument === 'GBPUSD' ? 1.2520 :
      instrument === 'USDCHF' ? 0.9010 :
      instrument === 'AUDUSD' ? 0.6310 :
      instrument === 'USDJPY' ? 149.50 :
      instrument === 'USDCAD' ? 1.3620 :
      instrument === 'EURGBP' ? 0.8560 :
      instrument === 'EURJPY' ? 162.30 :
      instrument === 'GBPJPY' ? 189.80 :
      0.5680;
    
    const volatility = instrument === 'XAUUSD' ? 8 : isMetal ? 0.5 : isJpy ? 0.3 : 0.003;
    const data: OHLCV[] = [];
    let currentPrice = basePrice;
    const now = Date.now();
    const interval = 3600000;

    for (let i = count - 1; i >= 0; i--) {
      const change = (Math.random() - 0.5) * volatility;
      const open = currentPrice;
      const close = currentPrice + change;
      const high = Math.max(open, close) + Math.random() * (volatility / 2);
      const low = Math.min(open, close) - Math.random() * (volatility / 2);
      
      data.push({
        timestamp: new Date(now - i * interval),
        open,
        high,
        low,
        close,
      });
      
      currentPrice = close;
    }

    return data;
  }

  setOandaCredentials(apiKey: string, accountId: string, isLive: boolean = false): void {
    this.oandaApiKey = apiKey;
    this.oandaAccountId = accountId;
    this.oandaIsLive = isLive;
    this.oandaFailCount = 0;
    console.log(`[HistoricalData] OANDA credentials updated (${isLive ? 'live' : 'demo'}) — signals will use real candle data`);
  }

  clearCache() {
    this.cache.clear();
  }
}

export const historicalDataService = new HistoricalDataService();
