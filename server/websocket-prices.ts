import WebSocket from "ws";
import type { Instrument, LivePrice } from "@shared/schema";
import { instruments } from "@shared/schema";

type PriceCallback = (price: LivePrice) => void;

class LivePriceService {
  private prices: Map<Instrument, LivePrice> = new Map();
  private callbacks: PriceCallback[] = [];
  private simulationInterval: NodeJS.Timeout | null = null;
  private baseSimPrices: Map<Instrument, number> = new Map();
  private simTrends: Map<Instrument, { direction: number; momentum: number }> = new Map();

  constructor() {
    this.initializeSimulatedPrices();
    this.startSimulatedPrices();
  }

  private initializeSimulatedPrices() {
    const basePrices: Record<Instrument, number> = {
      XAUUSD: 3073.00,
      XAGUSD: 32.50,
      EURUSD: 1.0425,
      GBPUSD: 1.2485,
      USDCHF: 0.9125,
      AUDUSD: 0.6245,
      NZDUSD: 0.5685,
    };

    instruments.forEach((inst) => {
      this.baseSimPrices.set(inst, basePrices[inst]);
      this.simTrends.set(inst, {
        direction: Math.random() > 0.5 ? 1 : -1,
        momentum: Math.random() * 0.5 + 0.5,
      });
    });
  }

  private startSimulatedPrices() {
    this.simulationInterval = setInterval(() => {
      instruments.forEach((inst) => {
        const basePrice = this.baseSimPrices.get(inst) || 0;
        const trend = this.simTrends.get(inst)!;
        const isMetal = inst === "XAUUSD" || inst === "XAGUSD";
        const tickSize = inst === "XAUUSD" ? 0.50 : isMetal ? 0.05 : 0.00005;
        const maxDeviation = basePrice * 0.01;
        const currentPrice = this.prices.get(inst)?.bid || basePrice;
        const deviation = currentPrice - basePrice;
        
        if (Math.random() < 0.05) {
          trend.direction *= -1;
          trend.momentum = Math.random() * 0.5 + 0.5;
          this.simTrends.set(inst, trend);
        }

        let priceChange = tickSize * trend.direction * trend.momentum * (Math.random() * 2);
        
        if (Math.abs(deviation) > maxDeviation * 0.8) {
          priceChange = -Math.sign(deviation) * tickSize * Math.random() * 3;
        }

        const newBid = currentPrice + priceChange;
        const spread = inst === "XAUUSD" ? 0.30 : isMetal ? 0.03 : 0.00015;
        const decimals = isMetal ? 2 : 5;

        const livePrice: LivePrice = {
          instrument: inst,
          bid: Number(newBid.toFixed(decimals)),
          ask: Number((newBid + spread).toFixed(decimals)),
          timestamp: new Date().toISOString(),
          source: "simulated",
        };

        this.prices.set(inst, livePrice);
        this.notifyCallbacks(livePrice);
      });
    }, 1000);
  }

  private notifyCallbacks(price: LivePrice) {
    this.callbacks.forEach((cb) => cb(price));
  }

  subscribe(callback: PriceCallback) {
    this.callbacks.push(callback);
  }

  unsubscribe(callback: PriceCallback) {
    this.callbacks = this.callbacks.filter((cb) => cb !== callback);
  }

  getPrice(instrument: Instrument): LivePrice | undefined {
    return this.prices.get(instrument);
  }

  getAllPrices(): LivePrice[] {
    return Array.from(this.prices.values());
  }

  stop() {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }
}

export const livePriceService = new LivePriceService();
