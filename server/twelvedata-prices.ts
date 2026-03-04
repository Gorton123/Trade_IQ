interface LivePrice {
  instrument: string;
  bid: number;
  ask: number;
  timestamp: Date;
  source: 'twelvedata' | 'fallback' | 'connecting';
}

const symbolMapping: Record<string, string> = {
  'XAU/USD': 'XAUUSD',
  'XAG/USD': 'XAGUSD',
  'EUR/USD': 'EURUSD',
  'GBP/USD': 'GBPUSD',
  'USD/CHF': 'USDCHF',
  'AUD/USD': 'AUDUSD',
  'NZD/USD': 'NZDUSD',
  'USD/JPY': 'USDJPY',
  'USD/CAD': 'USDCAD',
  'EUR/GBP': 'EURGBP',
  'EUR/JPY': 'EURJPY',
  'GBP/JPY': 'GBPJPY',
};

const reverseMapping: Record<string, string> = {
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

const spreads: Record<string, number> = {
  'XAUUSD': 0.30,
  'XAGUSD': 0.03,
  'EURUSD': 0.00015,
  'GBPUSD': 0.00015,
  'USDCHF': 0.00015,
  'AUDUSD': 0.00015,
  'NZDUSD': 0.00015,
  'USDJPY': 0.015,
  'USDCAD': 0.00015,
  'EURGBP': 0.00015,
  'EURJPY': 0.015,
  'GBPJPY': 0.025,
};

class TwelveDataPriceService {
  private prices: Map<string, LivePrice> = new Map();
  private apiKey: string | null = null;
  private lastFetchTime: number = 0;
  private isRunning: boolean = false;
  private hasSuccessfulFetch: boolean = false;
  private pricesCacheExpiry: number = 4 * 60 * 60 * 1000; // 4 hours cache for prices to minimize API usage

  constructor() {
    this.apiKey = process.env.TWELVE_DATA_API_KEY || null;
  }

  async connect(): Promise<boolean> {
    if (!this.apiKey) {
      console.log('[TwelveData] No API key configured - using on-demand mode');
      return false;
    }

    console.log('[TwelveData] On-demand mode enabled - NO auto-polling to save API credits');
    console.log('[TwelveData] Prices cached for 2 hours. Use manual refresh for updates.');
    this.isRunning = true;
    
    // Fetch once on startup only
    await this.fetchPrices();
    
    // NO automatic polling - saves ~1400 API calls/day
    
    return this.hasSuccessfulFetch;
  }

  private async fetchPrices() {
    if (!this.apiKey) return;

    const now = Date.now();
    // Prevent fetching too fast
    if (this.lastFetchTime > 0 && now - this.lastFetchTime < 5000) {
      return;
    }

    try {
      // Batch all symbols in one request (counts as 1 API call)
      const symbols = Object.values(reverseMapping).join(',');
      const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols)}&apikey=${this.apiKey}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      this.lastFetchTime = now;
      
      if (data.status === 'error') {
        console.error('[TwelveData] API error:', data.message);
        return;
      }

      let updatedCount = 0;
      
      // Process each symbol's price
      for (const [symbol, priceData] of Object.entries(data)) {
        const instrument = symbolMapping[symbol];
        if (instrument && priceData && typeof priceData === 'object' && 'price' in priceData) {
          const price = parseFloat((priceData as { price: string }).price);
          if (!isNaN(price)) {
            const spread = spreads[instrument] || 0.0001;
            const halfSpread = spread / 2;

            this.prices.set(instrument, {
              instrument,
              bid: price - halfSpread,
              ask: price + halfSpread,
              timestamp: new Date(),
              source: 'twelvedata',
            });
            updatedCount++;
          }
        }
      }
      
      if (updatedCount > 0) {
        this.hasSuccessfulFetch = true;
        console.log(`[TwelveData] Updated ${updatedCount} prices`);
      }
    } catch (error) {
      console.error('[TwelveData] Fetch error:', error);
    }
  }

  getPrice(instrument: string): LivePrice | null {
    return this.prices.get(instrument) || null;
  }

  getAllPrices(): LivePrice[] {
    return Array.from(this.prices.values());
  }

  isActive(): boolean {
    return this.isRunning && this.hasSuccessfulFetch;
  }

  hasApiKey(): boolean {
    return this.apiKey !== null;
  }

  private lastManualRefresh: number = 0;
  private manualRefreshCooldown: number = 60000; // 60 second cooldown between manual refreshes

  // Manual refresh - triggers immediate fetch (rate limited to prevent API abuse)
  async refresh(): Promise<{ success: boolean; message: string; nextRefreshIn?: number }> {
    if (!this.apiKey) {
      return { success: false, message: "No API key configured" };
    }
    
    const now = Date.now();
    const timeSinceLastRefresh = now - this.lastManualRefresh;
    
    if (timeSinceLastRefresh < this.manualRefreshCooldown) {
      const waitTime = Math.ceil((this.manualRefreshCooldown - timeSinceLastRefresh) / 1000);
      return { 
        success: false, 
        message: `Please wait ${waitTime}s before refreshing again`,
        nextRefreshIn: waitTime
      };
    }
    
    this.lastManualRefresh = now;
    this.lastFetchTime = 0; // Allow immediate fetch
    await this.fetchPrices();
    
    return { 
      success: this.hasSuccessfulFetch, 
      message: this.hasSuccessfulFetch ? "Prices refreshed" : "Refresh failed - API may be rate limited"
    };
  }

  disconnect() {
    this.isRunning = false;
  }

  // Get cache age in minutes for UI display
  getCacheAge(): number {
    if (this.lastFetchTime === 0) return -1;
    return Math.round((Date.now() - this.lastFetchTime) / 60000);
  }

  // Check if cache is still valid (within 2 hours)
  isCacheValid(): boolean {
    if (this.lastFetchTime === 0) return false;
    return Date.now() - this.lastFetchTime < this.pricesCacheExpiry;
  }
}

export const twelveDataService = new TwelveDataPriceService();
