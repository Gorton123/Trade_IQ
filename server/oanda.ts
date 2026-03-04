import { storage } from "./storage";

const OANDA_DEMO_URL = "https://api-fxpractice.oanda.com";
const OANDA_LIVE_URL = "https://api-fxtrade.oanda.com";

interface OandaConfig {
  apiKey: string;
  accountId: string;
  isLive: boolean;
}

interface OandaTrade {
  id: string;
  instrument: string;
  currentUnits: string;
  initialUnits?: string;
  price: string;
  unrealizedPL: string;
  state: string;
  openTime?: string;
  stopLossOrder?: { price: string };
  takeProfitOrder?: { price: string };
}

interface OandaAccountSummary {
  balance: string;
  unrealizedPL: string;
  pl: string;
  openTradeCount: number;
  currency: string;
  NAV: string;
  marginUsed: string;
  marginAvailable: string;
  marginRate: string;
  positionValue: string;
}

class OandaService {
  private config: OandaConfig | null = null;
  private initialized: boolean = false;

  async initFromEnv(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    
    const apiKey = process.env.OANDA_API_KEY;
    const accountId = process.env.OANDA_ACCOUNT_ID;
    
    if (apiKey && accountId) {
      console.log("[OANDA] Auto-configuring from environment variables...");
      const success = await this.configure(apiKey, accountId, false); // Default to demo
      if (success) {
        console.log("[OANDA] Successfully connected to demo account");
      } else {
        console.log("[OANDA] Failed to auto-connect - check credentials");
      }
    }
  }

  private getBaseUrl(): string {
    if (!this.config) throw new Error("OANDA not configured");
    return this.config.isLive ? OANDA_LIVE_URL : OANDA_DEMO_URL;
  }

  private getHeaders(): Record<string, string> {
    if (!this.config) throw new Error("OANDA not configured");
    return {
      "Authorization": `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private convertInstrument(instrument: string): string {
    // Convert TradeIQ format to OANDA format
    // Special cases for metals/commodities
    const specialInstruments: Record<string, string> = {
      "XAUUSD": "XAU_USD",
      "XAGUSD": "XAG_USD",
    };
    
    if (specialInstruments[instrument]) {
      return specialInstruments[instrument];
    }
    
    // Standard forex pairs: GBPUSD -> GBP_USD, EURUSD -> EUR_USD, etc.
    // Match 6-character currency pairs and insert underscore
    const match = instrument.match(/^([A-Z]{3})([A-Z]{3})$/);
    if (match) {
      return `${match[1]}_${match[2]}`;
    }
    
    // Fallback for already formatted or unknown instruments
    return instrument.replace("/", "_");
  }

  private revertInstrument(oandaInstrument: string): string {
    // Convert OANDA format back to TradeIQ format
    // Special cases for metals/commodities
    const specialInstruments: Record<string, string> = {
      "XAU_USD": "XAUUSD",
      "XAG_USD": "XAGUSD",
    };
    
    if (specialInstruments[oandaInstrument]) {
      return specialInstruments[oandaInstrument];
    }
    
    // Standard forex pairs: GBP_USD -> GBPUSD
    return oandaInstrument.replace("_", "");
  }

  async configure(apiKey: string, accountId: string, isLive: boolean = false): Promise<boolean> {
    this.config = { apiKey, accountId, isLive };
    
    try {
      const account = await this.getAccountSummary();
      console.log(`[OANDA] Connected to ${isLive ? 'LIVE' : 'DEMO'} account: ${accountId}`);
      console.log(`[OANDA] Balance: ${account.currency} ${account.balance}`);
      return true;
    } catch (error) {
      console.error("[OANDA] Connection failed:", error);
      this.config = null;
      return false;
    }
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  async getAccountSummary(): Promise<OandaAccountSummary> {
    if (!this.config) throw new Error("OANDA not configured");

    const response = await fetch(
      `${this.getBaseUrl()}/v3/accounts/${this.config.accountId}/summary`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OANDA API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.account as OandaAccountSummary;
  }

  async getOpenTrades(): Promise<OandaTrade[]> {
    if (!this.config) throw new Error("OANDA not configured");

    const response = await fetch(
      `${this.getBaseUrl()}/v3/accounts/${this.config.accountId}/openTrades`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OANDA API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.trades as OandaTrade[];
  }

  async placeMarketOrder(
    instrument: string,
    units: number,
    stopLoss: number,
    takeProfit: number
  ): Promise<{ success: boolean; orderId?: string; tradeId?: string; error?: string }> {
    if (!this.config) return { success: false, error: "OANDA not configured" };

    const oandaInstrument = this.convertInstrument(instrument);
    
    // Get proper decimal precision for instrument
    const getDecimalPlaces = (inst: string): number => {
      if (inst === "XAUUSD") return 2;
      if (inst === "USDJPY" || inst.includes("JPY")) return 3;
      return 5; // Standard forex pairs
    };
    
    const decimals = getDecimalPlaces(instrument);
    
    const orderData = {
      order: {
        type: "MARKET",
        instrument: oandaInstrument,
        units: units.toString(),
        stopLossOnFill: {
          price: stopLoss.toFixed(decimals),
        },
        takeProfitOnFill: {
          price: takeProfit.toFixed(decimals),
        },
        timeInForce: "FOK",
        positionFill: "OPEN_ONLY",
      },
    };

    console.log(`[OANDA] Placing order: ${JSON.stringify(orderData)}`);

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/v3/accounts/${this.config.accountId}/orders`,
        {
          method: "POST",
          headers: this.getHeaders(),
          body: JSON.stringify(orderData),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error("[OANDA] Order failed:", data);
        return { success: false, error: data.errorMessage || "Order rejected" };
      }

      if (data.orderFillTransaction) {
        console.log(`[OANDA] Order filled! Trade ID: ${data.orderFillTransaction.tradeOpened?.tradeID}`);
        return {
          success: true,
          orderId: data.orderCreateTransaction?.id,
          tradeId: data.orderFillTransaction.tradeOpened?.tradeID,
        };
      }

      if (data.orderCancelTransaction) {
        console.error(`[OANDA] Order cancelled: ${data.orderCancelTransaction.reason}`, data.orderCancelTransaction);
        return { success: false, error: `Order cancelled: ${data.orderCancelTransaction.reason}` };
      }

      return { success: true, orderId: data.orderCreateTransaction?.id };
    } catch (error) {
      console.error("[OANDA] Order error:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async closeTrade(tradeId: string, units?: number): Promise<{ success: boolean; error?: string }> {
    if (!this.config) return { success: false, error: "OANDA not configured" };

    try {
      const body = units ? { units: units.toString() } : {};
      
      const response = await fetch(
        `${this.getBaseUrl()}/v3/accounts/${this.config.accountId}/trades/${tradeId}/close`,
        {
          method: "PUT",
          headers: this.getHeaders(),
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      console.log(`[OANDA] Trade ${tradeId} closed`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async getPrice(instrument: string): Promise<{ bid: number; ask: number } | null> {
    if (!this.config) return null;

    const oandaInstrument = this.convertInstrument(instrument);

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/v3/accounts/${this.config.accountId}/pricing?instruments=${oandaInstrument}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) return null;

      const data = await response.json();
      const price = data.prices?.[0];
      
      if (!price) return null;

      return {
        bid: parseFloat(price.bids[0].price),
        ask: parseFloat(price.asks[0].price),
      };
    } catch {
      return null;
    }
  }

  // Get prices for multiple instruments at once - more efficient than calling getPrice repeatedly
  async getAllPrices(instrumentList: string[]): Promise<Record<string, { bid: number; ask: number; mid: number }>> {
    if (!this.config) return {};

    const oandaInstruments = instrumentList.map(i => this.convertInstrument(i)).join(",");

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/v3/accounts/${this.config.accountId}/pricing?instruments=${oandaInstruments}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) return {};

      const data = await response.json();
      const result: Record<string, { bid: number; ask: number; mid: number }> = {};

      for (const price of data.prices || []) {
        const tradeIqInstrument = this.revertInstrument(price.instrument);
        const bid = parseFloat(price.bids?.[0]?.price || "0");
        const ask = parseFloat(price.asks?.[0]?.price || "0");
        result[tradeIqInstrument] = {
          bid,
          ask,
          mid: (bid + ask) / 2,
        };
      }

      return result;
    } catch (error) {
      console.error("[OANDA] Failed to get bulk prices:", error);
      return {};
    }
  }

  calculateUnits(
    instrument: string,
    accountBalance: number,
    riskPercent: number,
    entryPrice: number,
    stopLoss: number
  ): number {
    const riskAmount = accountBalance * (riskPercent / 100);
    const isJpy = instrument.includes("JPY");
    const pipValue = instrument === "XAUUSD" ? 0.1 : isJpy ? 0.01 : 0.0001;
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const pipsRisk = stopDistance / pipValue;
    
    if (pipsRisk === 0) return 0;
    
    const unitsPerPip = instrument === "XAUUSD" ? 1 : 10;
    const units = Math.floor((riskAmount / pipsRisk) * unitsPerPip);
    
    return units;
  }

  async executeSignal(signal: {
    instrument: string;
    direction: "buy" | "sell";
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number;
    confidence: number;
    signalId: string;
  }): Promise<{ success: boolean; tradeId?: string; error?: string }> {
    if (!this.config) return { success: false, error: "OANDA not configured" };

    try {
      // Validate required signal parameters
      if (!signal.stopLoss || signal.stopLoss <= 0) {
        return { success: false, error: "Invalid stop loss value" };
      }
      if (!signal.takeProfit1 || signal.takeProfit1 <= 0) {
        return { success: false, error: "Invalid take profit value" };
      }
      
      // Always get real price from OANDA - fallback prices may be wrong
      const quote = await this.getPrice(signal.instrument);
      if (!quote) {
        return { success: false, error: "Failed to get current price from OANDA" };
      }
      
      const realEntryPrice = signal.direction === "buy" ? quote.ask : quote.bid;
      
      // Calculate SL/TP distances as percentages from the signal's entry
      // Then apply those same percentages to the real OANDA price
      const signalEntry = signal.entryPrice > 0 ? signal.entryPrice : realEntryPrice;
      
      // Calculate SL/TP distances in pips/points from signal
      const slDistance = Math.abs(signalEntry - signal.stopLoss);
      const tpDistance = Math.abs(signal.takeProfit1 - signalEntry);
      
      // Calculate percentage distances for proportion-based adjustment
      const slPercent = slDistance / signalEntry;
      const tpPercent = tpDistance / signalEntry;
      
      // Apply distances to real price
      let realStopLoss: number;
      let realTakeProfit: number;
      
      if (signal.direction === "buy") {
        realStopLoss = realEntryPrice * (1 - slPercent);
        realTakeProfit = realEntryPrice * (1 + tpPercent);
      } else {
        realStopLoss = realEntryPrice * (1 + slPercent);
        realTakeProfit = realEntryPrice * (1 - tpPercent);
      }
      
      console.log(`[OANDA] Price adjustment: Signal entry ${signalEntry} -> Real entry ${realEntryPrice}`);
      console.log(`[OANDA] SL: ${signal.stopLoss} -> ${realStopLoss.toFixed(5)}, TP: ${signal.takeProfit1} -> ${realTakeProfit.toFixed(5)}`);

      // Validate adjusted stop loss
      if (realStopLoss <= 0) {
        return { success: false, error: "Invalid stop loss after price adjustment" };
      }

      const account = await this.getAccountSummary();
      const balance = parseFloat(account.balance);
      
      const riskPercent = 1;
      
      // Use auto-scaling based on account balance
      const scaled = this.calculateScaledUnits(
        signal.instrument,
        balance,
        riskPercent,
        realEntryPrice,
        realStopLoss
      );
      
      let units = scaled.units;

      if (signal.direction === "sell") {
        units = -units;
      }

      if (units === 0) {
        return { success: false, error: "Position size too small for risk parameters" };
      }

      console.log(`[OANDA] Executing signal: ${signal.instrument} ${signal.direction} ${Math.abs(units)} units (${scaled.lotSize} lots) - ${scaled.scaleTier}`);
      
      const result = await this.placeMarketOrder(
        signal.instrument,
        units,
        realStopLoss,
        realTakeProfit
      );

      if (result.success && result.tradeId) {
        console.log(`[OANDA] Signal executed successfully. Trade ID: ${result.tradeId}`);
      }

      return result;
    } catch (error) {
      console.error("[OANDA] Execute signal error:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  getConfig(): OandaConfig | null {
    return this.config;
  }

  disconnect(): void {
    this.config = null;
    console.log("[OANDA] Disconnected");
  }

  // Move trailing stop loss to lock in profits
  async modifyTradeStopLoss(tradeId: string, newStopLoss: number, instrument: string): Promise<{ success: boolean; error?: string }> {
    if (!this.config) return { success: false, error: "OANDA not configured" };

    try {
      const decimals = instrument === "XAUUSD" ? 2 : (instrument.includes("JPY") ? 3 : 5);
      
      const response = await fetch(
        `${this.getBaseUrl()}/v3/accounts/${this.config.accountId}/trades/${tradeId}/orders`,
        {
          method: "PUT",
          headers: this.getHeaders(),
          body: JSON.stringify({
            stopLoss: {
              price: newStopLoss.toFixed(decimals),
              timeInForce: "GTC"
            }
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      console.log(`[OANDA] Trade ${tradeId} SL moved to ${newStopLoss.toFixed(decimals)}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  // Close partial position (for partial TP)
  async closePartialTrade(tradeId: string, percentToClose: number = 50): Promise<{ success: boolean; error?: string }> {
    if (!this.config) return { success: false, error: "OANDA not configured" };

    try {
      // Get current trade details
      const trades = await this.getOpenTrades();
      const trade = trades.find(t => t.id === tradeId);
      
      if (!trade) {
        return { success: false, error: "Trade not found" };
      }

      const currentUnits = parseInt(trade.currentUnits);
      const unitsToClose = Math.floor(Math.abs(currentUnits) * (percentToClose / 100));
      
      if (unitsToClose < 1) {
        return { success: false, error: "Position too small for partial close" };
      }

      // For sell trades, units are negative
      const closeUnits = currentUnits < 0 ? -unitsToClose : unitsToClose;

      const result = await this.closeTrade(tradeId, closeUnits);
      
      if (result.success) {
        console.log(`[OANDA] Closed ${percentToClose}% of trade ${tradeId} (${closeUnits} units)`);
      }

      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  // Calculate units with auto-scaling based on balance tiers
  calculateScaledUnits(
    instrument: string,
    accountBalance: number,
    riskPercent: number,
    entryPrice: number,
    stopLoss: number
  ): { units: number; lotSize: number; scaleTier: string } {
    // Auto lot scaling based on balance tiers
    let lotMultiplier = 1;
    let scaleTier = "Standard (1x)";
    
    if (accountBalance >= 5000) {
      lotMultiplier = 4;
      scaleTier = "Aggressive (4x) - £5,000+ tier";
    } else if (accountBalance >= 2500) {
      lotMultiplier = 2;
      scaleTier = "Moderate (2x) - £2,500+ tier";
    } else if (accountBalance >= 1000) {
      lotMultiplier = 1;
      scaleTier = "Standard (1x) - £1,000+ tier";
    } else {
      lotMultiplier = 0.5;
      scaleTier = "Conservative (0.5x) - Small account";
    }

    const baseUnits = this.calculateUnits(instrument, accountBalance, riskPercent, entryPrice, stopLoss);
    const scaledUnits = Math.floor(baseUnits * lotMultiplier);
    
    // Calculate lot size for display (1 lot = 100,000 units for forex, 100 for gold)
    const lotDivisor = instrument === "XAUUSD" ? 100 : 100000;
    const lotSize = Math.round((scaledUnits / lotDivisor) * 100) / 100;

    console.log(`[OANDA] Auto-scaling: Balance £${accountBalance.toFixed(0)} -> ${scaleTier} -> ${scaledUnits} units (${lotSize} lots)`);

    return { units: scaledUnits, lotSize, scaleTier };
  }
}

export const oandaService = new OandaService();

// =====================================================
// STATELESS OANDA HELPERS - Safe for multi-user operations
// These functions accept credentials per-call to avoid race conditions
// =====================================================

export interface OandaCredentials {
  apiKey: string;
  accountId: string;
  isLive: boolean;
}

function getOandaBaseUrl(isLive: boolean): string {
  return isLive ? OANDA_LIVE_URL : OANDA_DEMO_URL;
}

function getOandaHeaders(apiKey: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function convertInstrumentToOanda(instrument: string): string {
  const specialInstruments: Record<string, string> = {
    "XAUUSD": "XAU_USD",
    "XAGUSD": "XAG_USD",
  };
  if (specialInstruments[instrument]) return specialInstruments[instrument];
  const match = instrument.match(/^([A-Z]{3})([A-Z]{3})$/);
  if (match) return `${match[1]}_${match[2]}`;
  return instrument.replace("/", "_");
}

export async function oandaGetCurrentPrice(creds: OandaCredentials, instrument: string): Promise<{ bid: number; ask: number; price: number } | null> {
  try {
    const oandaInstrument = toOandaInstrument(instrument);
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/pricing?instruments=${oandaInstrument}`,
      { headers: getOandaHeaders(creds.apiKey) }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data.prices && data.prices.length > 0) {
      const p = data.prices[0];
      const bid = parseFloat(p.bids?.[0]?.price || p.closeoutBid || "0");
      const ask = parseFloat(p.asks?.[0]?.price || p.closeoutAsk || "0");
      return { bid, ask, price: (bid + ask) / 2 };
    }
    return null;
  } catch {
    return null;
  }
}

export async function oandaTestConnection(creds: OandaCredentials): Promise<boolean> {
  try {
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/summary`,
      { headers: getOandaHeaders(creds.apiKey) }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function oandaGetAccountSummary(creds: OandaCredentials): Promise<OandaAccountSummary> {
  const response = await fetch(
    `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/summary`,
    { headers: getOandaHeaders(creds.apiKey) }
  );
  if (!response.ok) {
    throw new Error(`OANDA API error: ${response.status}`);
  }
  const data = await response.json();
  return data.account as OandaAccountSummary;
}

export async function oandaGetOpenTrades(creds: OandaCredentials): Promise<OandaTrade[]> {
  const response = await fetch(
    `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/openTrades`,
    { headers: getOandaHeaders(creds.apiKey) }
  );
  if (!response.ok) {
    throw new Error(`OANDA API error: ${response.status}`);
  }
  const data = await response.json();
  return data.trades as OandaTrade[];
}

export async function oandaGetTradeDetails(creds: OandaCredentials, tradeId: string): Promise<{ realizedPL?: number; closePrice?: number; state?: string } | null> {
  try {
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/trades/${tradeId}`,
      { headers: getOandaHeaders(creds.apiKey) }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const trade = data.trade;
    if (!trade) return null;
    return {
      realizedPL: trade.realizedPL ? parseFloat(trade.realizedPL) : undefined,
      closePrice: trade.averageClosePrice ? parseFloat(trade.averageClosePrice) : (trade.price ? parseFloat(trade.price) : undefined),
      state: trade.state,
    };
  } catch {
    return null;
  }
}

export async function oandaCloseTrade(creds: OandaCredentials, tradeId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/trades/${tradeId}/close`,
      { method: "PUT", headers: getOandaHeaders(creds.apiKey) }
    );
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function oandaPlaceMarketOrder(
  creds: OandaCredentials,
  instrument: string,
  units: number,
  stopLoss: number,
  takeProfit: number
): Promise<{ success: boolean; orderId?: string; tradeId?: string; error?: string }> {
  const oandaInstrument = convertInstrumentToOanda(instrument);
  
  const getDecimalPlaces = (inst: string): number => {
    if (inst === "XAUUSD") return 2;
    if (inst === "USDJPY" || inst.includes("JPY")) return 3;
    return 5;
  };
  
  const decimals = getDecimalPlaces(instrument);
  
  const orderData = {
    order: {
      type: "MARKET",
      instrument: oandaInstrument,
      units: units.toString(),
      stopLossOnFill: { price: stopLoss.toFixed(decimals) },
      takeProfitOnFill: { price: takeProfit.toFixed(decimals) },
      timeInForce: "FOK",
      positionFill: "OPEN_ONLY",
    },
  };

  try {
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/orders`,
      {
        method: "POST",
        headers: getOandaHeaders(creds.apiKey),
        body: JSON.stringify(orderData),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.errorMessage || "Order rejected" };
    }

    if (data.orderCancelTransaction) {
      console.error(`[OANDA] Order cancelled: ${data.orderCancelTransaction.reason}`, data.orderCancelTransaction);
      return { success: false, error: `Order cancelled: ${data.orderCancelTransaction.reason}` };
    }

    if (data.orderFillTransaction) {
      return {
        success: true,
        orderId: data.orderCreateTransaction?.id,
        tradeId: data.orderFillTransaction.tradeOpened?.tradeID,
      };
    }

    return { success: true, orderId: data.orderCreateTransaction?.id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Stateless helper to modify trade stop loss (for trailing stops)
export async function oandaModifyTradeStopLoss(
  creds: OandaCredentials,
  tradeId: string,
  newStopLoss: number,
  instrument: string
): Promise<{ success: boolean; error?: string }> {
  const getDecimalPlaces = (inst: string): number => {
    if (inst === "XAUUSD") return 2;
    if (inst === "USDJPY" || inst.includes("JPY")) return 3;
    return 5;
  };
  
  const decimals = getDecimalPlaces(instrument);
  
  try {
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/trades/${tradeId}/orders`,
      {
        method: "PUT",
        headers: getOandaHeaders(creds.apiKey),
        body: JSON.stringify({
          stopLoss: {
            price: newStopLoss.toFixed(decimals),
            timeInForce: "GTC"
          }
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    console.log(`[OANDA] Trade ${tradeId} SL moved to ${newStopLoss.toFixed(decimals)}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export interface OandaTransaction {
  id: string;
  type: string;
  time: string;
  accountBalance?: string;
  pl?: string;
  instrument?: string;
}

export async function oandaGetTransactionsSinceId(creds: OandaCredentials, sinceId: string): Promise<OandaTransaction[]> {
  try {
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/transactions/sinceid?id=${sinceId}`,
      { headers: getOandaHeaders(creds.apiKey) }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.transactions || []) as OandaTransaction[];
  } catch {
    return [];
  }
}

export async function oandaGetTransactionIdRange(creds: OandaCredentials): Promise<{ firstId: string; lastId: string } | null> {
  try {
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/transactions`,
      { headers: getOandaHeaders(creds.apiKey) }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const pages = data.pages || [];
    if (pages.length === 0) return null;
    const firstPage = pages[0] as string;
    const lastPage = pages[pages.length - 1] as string;
    const firstMatch = firstPage.match(/from=(\d+)/);
    const lastMatch = lastPage.match(/to=(\d+)/);
    if (!firstMatch || !lastMatch) return null;
    return { firstId: firstMatch[1], lastId: lastMatch[1] };
  } catch {
    return null;
  }
}

export async function oandaGetTransactionsByDateRange(creds: OandaCredentials, from: string, to: string): Promise<OandaTransaction[]> {
  try {
    const response = await fetch(
      `${getOandaBaseUrl(creds.isLive)}/v3/accounts/${creds.accountId}/transactions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=ORDER_FILL,DAILY_FINANCING,TRANSFER_FUNDS`,
      { headers: getOandaHeaders(creds.apiKey) }
    );
    if (!response.ok) {
      console.error(`[OANDA] Transaction range error: ${response.status}`);
      return [];
    }
    const data = await response.json();
    const pages: string[] = data.pages || [];
    const allTransactions: OandaTransaction[] = [];
    for (const pageUrl of pages) {
      try {
        const pageRes = await fetch(pageUrl, { headers: getOandaHeaders(creds.apiKey) });
        if (pageRes.ok) {
          const pageData = await pageRes.json();
          allTransactions.push(...(pageData.transactions || []));
        }
      } catch { /* skip failed pages */ }
    }
    return allTransactions;
  } catch {
    return [];
  }
}
