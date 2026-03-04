import { db } from "./db";
import { simulatedTradesTable } from "@shared/schema";
import { eq, and, notInArray } from "drizzle-orm";

const OANDA_DEMO_URL = "https://api-fxpractice.oanda.com";

const PIP_VALUES: Record<string, number> = {
  EURUSD: 0.0001, GBPUSD: 0.0001, USDCHF: 0.0001,
  AUDUSD: 0.0001, NZDUSD: 0.0001, USDJPY: 0.01,
  EURJPY: 0.01, XAUUSD: 0.1, XAGUSD: 0.01,
};

const oandaMapping: Record<string, string> = {
  XAUUSD: "XAU_USD", XAGUSD: "XAG_USD", EURUSD: "EUR_USD",
  GBPUSD: "GBP_USD", USDCHF: "USD_CHF", AUDUSD: "AUD_USD",
  NZDUSD: "NZD_USD", USDJPY: "USD_JPY", EURJPY: "EUR_JPY",
};

interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

async function fetchOandaCandles(
  instrument: string,
  granularity: string,
  from: string,
  to: string,
  count?: number
): Promise<OHLCV[]> {
  const apiKey = process.env.OANDA_API_KEY;
  if (!apiKey) throw new Error("OANDA_API_KEY not set");

  const oandaInst = oandaMapping[instrument] || instrument;
  let url = `${OANDA_DEMO_URL}/v3/instruments/${oandaInst}/candles?granularity=${granularity}&price=M`;

  if (from && to) {
    url += `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  } else if (count) {
    url += `&count=${count}`;
  }

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`OANDA error ${resp.status}: ${err}`);
    return [];
  }

  const data = await resp.json();
  if (!data.candles) return [];

  return data.candles
    .filter((c: any) => c.complete !== false)
    .map((c: any) => ({
      timestamp: new Date(c.time),
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
    }));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface Trade {
  instrument: string;
  direction: string;
  timeframe: string;
  entryPrice: number;
  closePrice: number;
  pnlPips: number;
  pnlMoney: number;
  trendStrength: number;
  openedAt: string;
  isWin: boolean;
}

async function runMomentumConfirmationBacktest() {
  console.log("\n" + "=".repeat(80));
  console.log("OPTION A: MOMENTUM CONFIRMATION FILTER BACKTEST");
  console.log("=".repeat(80));
  console.log("\nUsing 1-minute candle data to simulate momentum at trade entry time");
  console.log("For each trade, checking if price moved in the trade direction in the minutes before entry\n");

  const trades = await db
    .select()
    .from(simulatedTradesTable)
    .where(
      and(
        eq(simulatedTradesTable.userId, "kKEj9v"),
        notInArray(simulatedTradesTable.status, ["open", "pending"])
      )
    );

  const closedTrades: Trade[] = trades
    .filter((t) => t.pnlPips !== null && t.pnlPips !== undefined)
    .map((t) => {
      const conditions = typeof t.conditions === "string" ? JSON.parse(t.conditions) : t.conditions;
      return {
        instrument: t.instrument,
        direction: t.direction,
        timeframe: t.timeframe,
        entryPrice: parseFloat(String(t.entryPrice)),
        closePrice: parseFloat(String(t.closePrice || t.entryPrice)),
        pnlPips: parseFloat(String(t.pnlPips || 0)),
        pnlMoney: parseFloat(String(t.pnlMoney || 0)),
        trendStrength: parseInt(conditions?.trendStrength || "50"),
        openedAt: String(t.openedAt),
        isWin: parseFloat(String(t.pnlMoney || 0)) > 0,
      };
    });

  console.log(`Total closed trades: ${closedTrades.length}`);
  console.log(`Wins: ${closedTrades.filter((t) => t.isWin).length}`);
  console.log(`Losses: ${closedTrades.filter((t) => !t.isWin).length}`);
  console.log(
    `Current win rate: ${((closedTrades.filter((t) => t.isWin).length / closedTrades.length) * 100).toFixed(1)}%`
  );

  const confirmedTrades: (Trade & { momentumAligned: boolean; momentumPips: number })[] = [];

  const uniqueInstruments = [...new Set(closedTrades.map((t) => t.instrument))];
  const candleCache: Map<string, OHLCV[]> = new Map();

  for (const inst of uniqueInstruments) {
    console.log(`\nFetching 1m candle data for ${inst}...`);
    const instTrades = closedTrades.filter((t) => t.instrument === inst);
    const earliest = instTrades.reduce(
      (min, t) => (t.openedAt < min ? t.openedAt : min),
      instTrades[0].openedAt
    );
    const latest = instTrades.reduce(
      (max, t) => (t.openedAt > max ? t.openedAt : max),
      instTrades[0].openedAt
    );

    const fromDate = new Date(new Date(earliest).getTime() - 15 * 60000);
    const toDate = new Date(new Date(latest).getTime() + 15 * 60000);

    const candles = await fetchOandaCandles(
      inst,
      "M1",
      fromDate.toISOString(),
      toDate.toISOString()
    );
    candleCache.set(inst, candles);
    console.log(`  Got ${candles.length} candles for ${inst}`);
    await sleep(500);
  }

  for (const trade of closedTrades) {
    const candles = candleCache.get(trade.instrument) || [];
    const pipValue = PIP_VALUES[trade.instrument] || 0.0001;
    const entryTime = new Date(trade.openedAt).getTime();

    const windowConfigs = [
      { name: "3min", minutes: 3 },
      { name: "5min", minutes: 5 },
      { name: "10min", minutes: 10 },
    ];

    const recentCandles = candles.filter((c) => {
      const t = c.timestamp.getTime();
      return t >= entryTime - 5 * 60000 && t <= entryTime;
    });

    let momentumPips = 0;
    let momentumAligned = false;

    if (recentCandles.length >= 2) {
      const first = recentCandles[0];
      const last = recentCandles[recentCandles.length - 1];
      const move = (last.close - first.open) / pipValue;
      momentumPips = move;

      if (trade.direction === "buy") {
        momentumAligned = move > 0;
      } else {
        momentumAligned = move < 0;
      }
    } else {
      momentumAligned = true;
    }

    confirmedTrades.push({ ...trade, momentumAligned, momentumPips: Math.abs(momentumPips) });
  }

  const aligned = confirmedTrades.filter((t) => t.momentumAligned);
  const against = confirmedTrades.filter((t) => !t.momentumAligned);

  console.log("\n" + "-".repeat(60));
  console.log("RESULTS: Momentum Confirmation Filter (5-min window)");
  console.log("-".repeat(60));

  const alignedWins = aligned.filter((t) => t.isWin).length;
  const againstWins = against.filter((t) => t.isWin).length;

  console.log(`\nTrades WITH momentum aligned: ${aligned.length}`);
  console.log(`  Wins: ${alignedWins}, Losses: ${aligned.length - alignedWins}`);
  console.log(`  Win rate: ${aligned.length > 0 ? ((alignedWins / aligned.length) * 100).toFixed(1) : 0}%`);
  console.log(`  Total P&L: £${aligned.reduce((s, t) => s + t.pnlMoney, 0).toFixed(2)}`);

  console.log(`\nTrades AGAINST momentum: ${against.length}`);
  console.log(`  Wins: ${againstWins}, Losses: ${against.length - againstWins}`);
  console.log(`  Win rate: ${against.length > 0 ? ((againstWins / against.length) * 100).toFixed(1) : 0}%`);
  console.log(`  Total P&L: £${against.reduce((s, t) => s + t.pnlMoney, 0).toFixed(2)}`);

  console.log(`\n--- Would-have-blocked winners (false negatives) ---`);
  const blockedWinners = against.filter((t) => t.isWin);
  for (const t of blockedWinners) {
    console.log(
      `  ${t.instrument} ${t.direction} ${t.timeframe} @ ${t.openedAt.substring(0, 16)} | +${t.pnlMoney.toFixed(2)} GBP | momentum was ${t.momentumPips.toFixed(1)} pips against`
    );
  }

  console.log(`\n--- Would-have-blocked losers (true negatives - GOOD) ---`);
  const blockedLosers = against.filter((t) => !t.isWin);
  for (const t of blockedLosers) {
    console.log(
      `  ${t.instrument} ${t.direction} ${t.timeframe} @ ${t.openedAt.substring(0, 16)} | ${t.pnlMoney.toFixed(2)} GBP | momentum was ${t.momentumPips.toFixed(1)} pips against`
    );
  }

  const savedLosses = blockedLosers.reduce((s, t) => s + Math.abs(t.pnlMoney), 0);
  const missedWins = blockedWinners.reduce((s, t) => s + t.pnlMoney, 0);
  console.log(`\n--- NET IMPACT ---`);
  console.log(`  Losses avoided: £${savedLosses.toFixed(2)}`);
  console.log(`  Wins missed: £${missedWins.toFixed(2)}`);
  console.log(`  Net benefit: £${(savedLosses - missedWins).toFixed(2)}`);
  console.log(
    `  New win rate would be: ${aligned.length > 0 ? ((alignedWins / aligned.length) * 100).toFixed(1) : 0}% (was ${((closedTrades.filter((t) => t.isWin).length / closedTrades.length) * 100).toFixed(1)}%)`
  );

  return confirmedTrades;
}

async function runMetalsFastSwingBacktest() {
  console.log("\n" + "=".repeat(80));
  console.log("OPTION B: METALS FAST-SWING BACKTEST");
  console.log("=".repeat(80));
  console.log("\nTesting fast-swing approach on XAGUSD and XAUUSD");
  console.log("Using 1-minute candles to simulate momentum burst detection + swing targets\n");

  const instruments = ["XAGUSD", "XAUUSD"];
  const configs = [
    { name: "Conservative", momentumWindow: 10, momentumThreshold: 8, tpPips: 30, slPips: 15, maxMinutes: 30 },
    { name: "Balanced", momentumWindow: 5, momentumThreshold: 5, tpPips: 25, slPips: 12, maxMinutes: 20 },
    { name: "Aggressive", momentumWindow: 3, momentumThreshold: 3, tpPips: 20, slPips: 10, maxMinutes: 15 },
    { name: "XL Swing", momentumWindow: 15, momentumThreshold: 12, tpPips: 50, slPips: 20, maxMinutes: 45 },
    { name: "Tight Swing", momentumWindow: 5, momentumThreshold: 6, tpPips: 15, slPips: 8, maxMinutes: 10 },
  ];

  for (const inst of instruments) {
    console.log(`\n${"=".repeat(40)}`);
    console.log(`${inst} FAST-SWING BACKTEST`);
    console.log(`${"=".repeat(40)}`);

    console.log(`Fetching recent 1m candle data for ${inst}...`);
    const candles = await fetchOandaCandles(inst, "M1", "", "", 5000);
    console.log(`Got ${candles.length} candles (${candles.length > 0 ? candles[0].timestamp.toISOString().substring(0, 16) : "N/A"} to ${candles.length > 0 ? candles[candles.length - 1].timestamp.toISOString().substring(0, 16) : "N/A"})`);
    await sleep(500);

    if (candles.length < 100) {
      console.log("Not enough candle data, skipping...");
      continue;
    }

    const pipValue = PIP_VALUES[inst] || 0.01;

    for (const config of configs) {
      const results = simulateFastSwing(candles, pipValue, config);
      console.log(`\n--- ${config.name} (window=${config.momentumWindow}m, threshold=${config.momentumThreshold}p, TP=${config.tpPips}p, SL=${config.slPips}p, max=${config.maxMinutes}min) ---`);
      console.log(`  Total trades: ${results.totalTrades}`);
      console.log(`  Wins: ${results.wins} | Losses: ${results.losses} | Expired: ${results.expired}`);
      console.log(`  Win rate: ${results.totalTrades > 0 ? ((results.wins / results.totalTrades) * 100).toFixed(1) : 0}%`);
      console.log(`  Total P&L (pips): ${results.totalPnlPips.toFixed(1)}`);
      console.log(`  Avg win (pips): ${results.avgWinPips.toFixed(1)} | Avg loss (pips): ${results.avgLossPips.toFixed(1)}`);
      console.log(`  Profit factor: ${results.profitFactor.toFixed(2)}`);
      console.log(`  Max drawdown (pips): ${results.maxDrawdownPips.toFixed(1)}`);
      console.log(`  Best trade: ${results.bestTrade.toFixed(1)}p | Worst trade: ${results.worstTrade.toFixed(1)}p`);

      if (results.sampleTrades.length > 0) {
        console.log(`  Sample trades:`);
        for (const st of results.sampleTrades.slice(0, 5)) {
          console.log(`    ${st.direction.toUpperCase()} @ ${st.entryTime} | ${st.pnlPips > 0 ? "+" : ""}${st.pnlPips.toFixed(1)}p | ${st.exitReason}`);
        }
      }
    }
  }
}

interface SwingResult {
  totalTrades: number;
  wins: number;
  losses: number;
  expired: number;
  totalPnlPips: number;
  avgWinPips: number;
  avgLossPips: number;
  profitFactor: number;
  maxDrawdownPips: number;
  bestTrade: number;
  worstTrade: number;
  sampleTrades: { direction: string; entryTime: string; pnlPips: number; exitReason: string }[];
}

function simulateFastSwing(
  candles: OHLCV[],
  pipValue: number,
  config: { momentumWindow: number; momentumThreshold: number; tpPips: number; slPips: number; maxMinutes: number }
): SwingResult {
  const trades: { direction: string; entryTime: string; pnlPips: number; exitReason: string }[] = [];
  let i = config.momentumWindow;
  let lastTradeEnd = 0;
  const cooldownCandles = 5;

  while (i < candles.length - 1) {
    if (i <= lastTradeEnd + cooldownCandles) {
      i++;
      continue;
    }

    const windowStart = candles[i - config.momentumWindow];
    const windowEnd = candles[i];
    const movePips = (windowEnd.close - windowStart.open) / pipValue;
    const absPips = Math.abs(movePips);

    if (absPips < config.momentumThreshold) {
      i++;
      continue;
    }

    let consistent = 0;
    for (let j = i - config.momentumWindow + 1; j <= i; j++) {
      if (movePips > 0 && candles[j].close >= candles[j - 1].close) consistent++;
      else if (movePips < 0 && candles[j].close <= candles[j - 1].close) consistent++;
    }
    const consistencyRatio = consistent / config.momentumWindow;
    if (consistencyRatio < 0.55) {
      i++;
      continue;
    }

    const direction = movePips > 0 ? "buy" : "sell";
    const entryPrice = windowEnd.close;
    const tpDistance = config.tpPips * pipValue;
    const slDistance = config.slPips * pipValue;

    let tp: number, sl: number;
    if (direction === "buy") {
      tp = entryPrice + tpDistance;
      sl = entryPrice - slDistance;
    } else {
      tp = entryPrice - tpDistance;
      sl = entryPrice + slDistance;
    }

    let exitReason = "expired";
    let pnlPips = 0;
    let breakEvenApplied = false;
    let trailingStop = sl;
    let highestFav = 0;

    for (let k = i + 1; k < Math.min(i + config.maxMinutes + 1, candles.length); k++) {
      const candle = candles[k];

      const favPips =
        direction === "buy"
          ? (candle.high - entryPrice) / pipValue
          : (entryPrice - candle.low) / pipValue;

      if (favPips > highestFav) highestFav = favPips;

      if (!breakEvenApplied && highestFav >= config.tpPips * 0.4) {
        breakEvenApplied = true;
        if (direction === "buy") {
          trailingStop = Math.max(trailingStop, entryPrice + 1 * pipValue);
        } else {
          trailingStop = Math.min(trailingStop, entryPrice - 1 * pipValue);
        }
      }

      if (breakEvenApplied && highestFav >= config.tpPips * 0.6) {
        const trailDist = config.slPips * 0.5 * pipValue;
        if (direction === "buy") {
          const newTrail = candle.high - trailDist;
          trailingStop = Math.max(trailingStop, newTrail);
        } else {
          const newTrail = candle.low + trailDist;
          trailingStop = Math.min(trailingStop, newTrail);
        }
      }

      if (direction === "buy") {
        if (candle.low <= trailingStop) {
          pnlPips = (trailingStop - entryPrice) / pipValue;
          exitReason = breakEvenApplied ? "trailing_stop" : "sl_hit";
          lastTradeEnd = k;
          break;
        }
        if (candle.high >= tp) {
          pnlPips = config.tpPips;
          exitReason = "tp_hit";
          lastTradeEnd = k;
          break;
        }
      } else {
        if (candle.high >= trailingStop) {
          pnlPips = (entryPrice - trailingStop) / pipValue;
          exitReason = breakEvenApplied ? "trailing_stop" : "sl_hit";
          lastTradeEnd = k;
          break;
        }
        if (candle.low <= tp) {
          pnlPips = config.tpPips;
          exitReason = "tp_hit";
          lastTradeEnd = k;
          break;
        }
      }

      if (k === Math.min(i + config.maxMinutes, candles.length - 1)) {
        pnlPips = direction === "buy"
          ? (candle.close - entryPrice) / pipValue
          : (entryPrice - candle.close) / pipValue;
        exitReason = "expired";
        lastTradeEnd = k;
      }
    }

    trades.push({
      direction,
      entryTime: windowEnd.timestamp.toISOString().substring(0, 16),
      pnlPips: Math.round(pnlPips * 10) / 10,
      exitReason,
    });

    i = lastTradeEnd + 1;
  }

  const wins = trades.filter((t) => t.pnlPips > 0);
  const losses = trades.filter((t) => t.pnlPips < 0);
  const expired = trades.filter((t) => t.pnlPips === 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnlPips, 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlPips, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPips, 0));

  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.pnlPips;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    expired: expired.length,
    totalPnlPips: totalPnl,
    avgWinPips: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLossPips: losses.length > 0 ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0,
    maxDrawdownPips: maxDD,
    bestTrade: trades.length > 0 ? Math.max(...trades.map((t) => t.pnlPips)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map((t) => t.pnlPips)) : 0,
    sampleTrades: trades,
  };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  TRADEIQ MOMENTUM STRATEGY BACKTEST REPORT             ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Report generated: ${new Date().toISOString()}`);

  try {
    await runMomentumConfirmationBacktest();
    await runMetalsFastSwingBacktest();
  } catch (err) {
    console.error("Backtest error:", err);
  }

  console.log("\n" + "=".repeat(80));
  console.log("BACKTEST COMPLETE");
  console.log("=".repeat(80));

  process.exit(0);
}

main();
