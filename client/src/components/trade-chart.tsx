import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Eye, EyeOff, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createSeriesMarkers,
} from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  SeriesMarker,
} from "lightweight-charts";
import type { Instrument, Timeframe, SimulatedTrade } from "@shared/schema";

type TradeDisplayMode = "all" | "oanda-only" | "paper-only";

interface TradeChartProps {
  instrument: Instrument;
  timeframe: Timeframe;
  mode?: TradeDisplayMode;
}

interface HistoricalCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface OandaTrade {
  id: string;
  instrument: string;
  currentUnits: string;
  price: string;
  unrealizedPL: string;
  state: string;
  openTime?: string;
  stopLossOrder?: { price: string };
  takeProfitOrder?: { price: string };
}

const AVAILABLE_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h"];

function getTimeframeSeconds(tf: Timeframe): number {
  switch (tf) {
    case "1m": return 60;
    case "5m": return 300;
    case "15m": return 900;
    case "1h": return 3600;
    case "4h": return 14400;
    case "1D": return 86400;
    default: return 3600;
  }
}

function oandaToStandard(inst: string): string {
  return inst.replaceAll("_", "");
}

export function TradeChart({ instrument, timeframe: initialTimeframe, mode = "all" }: TradeChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<any>(null);
  const priceLineRefs = useRef<any[]>([]);
  const [showTrades, setShowTrades] = useState(true);
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>(initialTimeframe);

  const { data: historicalData, isLoading: loadingCandles } = useQuery<{ data: HistoricalCandle[] }>({
    queryKey: ["/api/historical", instrument, activeTimeframe, "trade-chart"],
    queryFn: async () => {
      const res = await fetch(`/api/historical/${instrument}/${activeTimeframe}?size=500`);
      if (!res.ok) throw new Error("Failed to fetch historical data");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: trades } = useQuery<SimulatedTrade[]>({
    queryKey: ["/api/simulation/trades"],
    enabled: mode !== "oanda-only",
  });

  const { data: oandaData } = useQuery<{ trades: OandaTrade[] }>({
    queryKey: ["/api/oanda/trades"],
    queryFn: async () => {
      const res = await fetch("/api/oanda/trades", { credentials: "include" });
      if (!res.ok) return { trades: [] };
      return res.json();
    },
    refetchInterval: 30000,
    retry: false,
    enabled: mode !== "paper-only",
  });

  const allInstrumentTrades = trades?.filter(t => t.instrument === instrument) || [];

  const paperOnlyTrades = allInstrumentTrades.filter(t => !t.oandaTradeId);
  const oandaLinkedTrades = allInstrumentTrades.filter(t => !!t.oandaTradeId);

  const oandaTrades = (oandaData?.trades || []).filter(t => oandaToStandard(t.instrument) === instrument);

  const oandaOnlyTrades = oandaTrades.filter(ot => {
    const alreadyLinked = allInstrumentTrades.some(st => st.oandaTradeId === ot.id && st.status === "open");
    return !alreadyLinked;
  });

  const visibleSimTrades = mode === "oanda-only" ? oandaLinkedTrades : mode === "paper-only" ? paperOnlyTrades : allInstrumentTrades;
  const visibleOandaOnly = mode === "paper-only" ? [] : oandaOnlyTrades;

  const oandaDataKey = oandaTrades.map(t => `${t.id}:${t.unrealizedPL}:${t.stopLossOrder?.price}:${t.takeProfitOrder?.price}`).join(",");
  const simTradesKey = visibleSimTrades.map(t => `${t.id}:${t.status}:${t.oandaTradeId || ""}:${t.pnlPips ?? ""}`).join(",");
  const oandaOnlyKey = visibleOandaOnly.map(t => t.id).join(",");

  const formatPrice = useCallback((price: number) => {
    const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
    return price.toFixed(isMetal ? 2 : 5);
  }, [instrument]);

  useEffect(() => {
    if (!chartContainerRef.current || !historicalData?.data?.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      priceLineRefs.current = [];
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0f" },
        textColor: "#9ca3af",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1a1a2e" },
        horzLines: { color: "#1a1a2e" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#4f46e5", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#4f46e5" },
        horzLine: { color: "#4f46e5", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#4f46e5" },
      },
      rightPriceScale: {
        borderColor: "#1a1a2e",
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        borderColor: "#1a1a2e",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const candleData: CandlestickData[] = historicalData.data
      .map(c => ({
        time: (Math.floor(new Date(c.timestamp).getTime() / 1000)) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    const uniqueCandles = candleData.filter((c, i, arr) =>
      i === 0 || (c.time as number) !== (arr[i - 1].time as number)
    );

    series.setData(uniqueCandles);

    chartRef.current = chart;
    seriesRef.current = series;

    if (showTrades) {
      addTradeOverlay(series, visibleSimTrades, uniqueCandles, visibleOandaOnly);

      const tradePrices: number[] = [];
      for (const t of visibleSimTrades) {
        if (t.status === "open") {
          tradePrices.push(t.entryPrice);
          if (t.stopLoss) tradePrices.push(t.stopLoss);
          if (t.takeProfit1) tradePrices.push(t.takeProfit1);
        }
      }
      for (const ot of visibleOandaOnly) {
        tradePrices.push(parseFloat(ot.price));
        if (ot.stopLossOrder) tradePrices.push(parseFloat(ot.stopLossOrder.price));
        if (ot.takeProfitOrder) tradePrices.push(parseFloat(ot.takeProfitOrder.price));
      }

      if (tradePrices.length > 0) {
        const candlePrices = uniqueCandles.flatMap(c => [c.high, c.low]);
        const allPrices = [...candlePrices, ...tradePrices];
        const minPrice = Math.min(...allPrices);
        const maxPrice = Math.max(...allPrices);
        const padding = (maxPrice - minPrice) * 0.1;

        series.applyOptions({
          autoscaleInfoProvider: () => ({
            priceRange: {
              minValue: minPrice - padding,
              maxValue: maxPrice + padding,
            },
          }),
        });
      }
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(chartContainerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      priceLineRefs.current = [];
    };
  }, [historicalData, instrument, activeTimeframe, showTrades, simTradesKey, oandaDataKey, oandaOnlyKey, mode]);

  function addTradeOverlay(
    series: ISeriesApi<"Candlestick">,
    trades: SimulatedTrade[],
    candles: CandlestickData[],
    oandaOnly: OandaTrade[]
  ) {
    if (!candles.length) return;

    const markers: SeriesMarker<Time>[] = [];
    const tfSeconds = getTimeframeSeconds(activeTimeframe);
    const firstCandleTime = candles[0].time as number;
    const lastCandleTime = candles[candles.length - 1].time as number;

    function snapToCandle(timestamp: string): Time | null {
      const tradeTime = Math.floor(new Date(timestamp).getTime() / 1000);
      if (tradeTime < firstCandleTime - tfSeconds || tradeTime > lastCandleTime + tfSeconds) return null;
      let closest = candles[0];
      let minDiff = Math.abs((candles[0].time as number) - tradeTime);
      for (const c of candles) {
        const diff = Math.abs((c.time as number) - tradeTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = c;
        }
      }
      return closest.time;
    }

    priceLineRefs.current = [];

    for (const trade of trades) {
      if (!trade.openedAt) continue;

      const entryTime = snapToCandle(trade.openedAt);
      if (!entryTime) continue;

      const isBuy = trade.direction === "buy";
      const isOpen = trade.status === "open";
      const isWin = (trade.pnlPips ?? 0) > 0;
      const isOandaLinked = !!trade.oandaTradeId;

      const isPaper = !isOandaLinked;
      const markerColor = isOandaLinked
        ? "#f59e0b"
        : isBuy ? "#3b82f6" : "#ef4444";

      const label = isOandaLinked ? "LIVE" : "PAPER";
      const tfLabel = trade.timeframe ? ` [${trade.timeframe}]` : "";

      markers.push({
        time: entryTime,
        position: isBuy ? "belowBar" : "aboveBar",
        color: markerColor,
        shape: isBuy ? "arrowUp" : "arrowDown",
        text: `${label} ${isBuy ? "BUY" : "SELL"} ${formatPrice(trade.entryPrice)}${tfLabel}`,
      });

      if (trade.closedAt && trade.closePrice != null && !isOpen) {
        const exitTime = snapToCandle(trade.closedAt);
        if (exitTime) {
          const pnlText = trade.pnlMoney != null
            ? `${isWin ? "+" : ""}£${trade.pnlMoney.toFixed(2)}`
            : `${isWin ? "+" : ""}${(trade.pnlPips ?? 0).toFixed(1)}p`;

          markers.push({
            time: exitTime,
            position: isBuy ? "aboveBar" : "belowBar",
            color: isWin ? "#22c55e" : "#ef4444",
            shape: "circle",
            text: pnlText,
          });
        }
      }

      if (isOpen) {
        if (trade.stopLoss) {
          const sl = series.createPriceLine({
            price: trade.stopLoss,
            color: "#ef4444",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${isPaper ? "" : "LIVE "}SL ${formatPrice(trade.stopLoss)}`,
          });
          priceLineRefs.current.push(sl);
        }
        if (trade.takeProfit1) {
          const tp = series.createPriceLine({
            price: trade.takeProfit1,
            color: "#22c55e",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${isPaper ? "" : "LIVE "}TP ${formatPrice(trade.takeProfit1)}`,
          });
          priceLineRefs.current.push(tp);
        }
        const entry = series.createPriceLine({
          price: trade.entryPrice,
          color: isOandaLinked ? "#f59e0b" : isBuy ? "#3b82f6" : "#f97316",
          lineWidth: isOandaLinked ? 2 : 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: isOandaLinked ? "LIVE Entry" : "Paper Entry",
        });
        priceLineRefs.current.push(entry);
      }
    }

    for (const ot of oandaOnly) {
      const entryPrice = parseFloat(ot.price);
      const units = parseFloat(ot.currentUnits);
      const isBuy = units > 0;
      const pl = parseFloat(ot.unrealizedPL);

      if (ot.openTime) {
        const entryTime = snapToCandle(ot.openTime);
        if (entryTime) {
          markers.push({
            time: entryTime,
            position: isBuy ? "belowBar" : "aboveBar",
            color: "#f59e0b",
            shape: isBuy ? "arrowUp" : "arrowDown",
            text: `OANDA ${isBuy ? "BUY" : "SELL"} ${formatPrice(entryPrice)}`,
          });
        }
      }

      const oandaEntry = series.createPriceLine({
        price: entryPrice,
        color: "#f59e0b",
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `OANDA ${formatPrice(entryPrice)} (${pl >= 0 ? "+" : ""}${pl.toFixed(2)})`,
      });
      priceLineRefs.current.push(oandaEntry);

      if (ot.stopLossOrder) {
        const slPrice = parseFloat(ot.stopLossOrder.price);
        const sl = series.createPriceLine({
          price: slPrice,
          color: "#dc2626",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `OANDA SL ${formatPrice(slPrice)}`,
        });
        priceLineRefs.current.push(sl);
      }
      if (ot.takeProfitOrder) {
        const tpPrice = parseFloat(ot.takeProfitOrder.price);
        const tp = series.createPriceLine({
          price: tpPrice,
          color: "#16a34a",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `OANDA TP ${formatPrice(tpPrice)}`,
        });
        priceLineRefs.current.push(tp);
      }
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    if (markers.length > 0) {
      markersRef.current = createSeriesMarkers(series, markers);
    }
  }

  const openCount = visibleSimTrades.filter(t => t.status === "open").length;
  const closedCount = visibleSimTrades.filter(t => t.status !== "open").length;
  const wins = visibleSimTrades.filter(t => t.status !== "open" && (t.pnlPips ?? 0) > 0).length;
  const oandaCount = visibleOandaOnly.length;
  const linkedCount = visibleSimTrades.filter(t => t.status === "open" && t.oandaTradeId).length;
  const totalLive = oandaCount + linkedCount;
  const paperCount = visibleSimTrades.filter(t => !t.oandaTradeId).length;

  const modeLabel = mode === "oanda-only" ? "OANDA Trades" : mode === "paper-only" ? "Paper Trades" : "All Trades";

  return (
    <Card data-testid="card-trade-chart">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span>{instrument}</span>
            <Badge variant="outline" className="text-xs">{modeLabel}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {(visibleSimTrades.length > 0 || totalLive > 0) && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-trade-summary">
                {closedCount > 0 ? `${closedCount} closed (${wins}W)` : ""}
                {openCount > 0 ? ` ${closedCount > 0 ? "| " : ""}${openCount} open` : ""}
                {totalLive > 0 ? ` | ${totalLive} LIVE` : ""}
                {mode === "all" && paperCount > 0 ? ` | ${paperCount} paper` : ""}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowTrades(!showTrades)}
              data-testid="button-toggle-trades"
            >
              {showTrades ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
          </div>
        </CardTitle>
        <div className="flex items-center gap-1 mt-1" data-testid="timeframe-selector">
          {AVAILABLE_TIMEFRAMES.map(tf => (
            <Button
              key={tf}
              variant={activeTimeframe === tf ? "default" : "outline"}
              size="sm"
              className={`h-7 px-2.5 text-xs font-medium ${
                activeTimeframe === tf
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTimeframe(tf)}
              data-testid={`btn-timeframe-${tf}`}
            >
              {tf}
            </Button>
          ))}
          {activeTimeframe !== initialTimeframe && (
            <span className="text-[10px] text-muted-foreground ml-1">
              Signal: {initialTimeframe}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {loadingCandles && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0a0a0f]">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <div
            ref={chartContainerRef}
            className="h-[450px] w-full rounded-lg overflow-hidden bg-[#0a0a0f]"
            data-testid="trade-chart-container"
          />
        </div>
        {showTrades && (visibleSimTrades.length > 0 || totalLive > 0) && (
          <div className="flex items-center justify-center gap-4 mt-3 text-xs flex-wrap">
            {mode !== "oanda-only" && (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-b-[8px] border-transparent border-b-[#3b82f6]" />
                  <span className="text-muted-foreground">Paper Buy</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[8px] border-transparent border-t-[#ef4444]" />
                  <span className="text-muted-foreground">Paper Sell</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />
              <span className="text-muted-foreground">Win</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
              <span className="text-muted-foreground">Loss</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0 border-t border-dashed border-[#ef4444]" />
              <span className="text-muted-foreground">SL</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0 border-t border-dashed border-[#22c55e]" />
              <span className="text-muted-foreground">TP</span>
            </div>
            {(totalLive > 0 || mode === "oanda-only") && (
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0 border-t-2 border-dotted border-[#f59e0b]" />
                <span className="text-muted-foreground">OANDA Live</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
