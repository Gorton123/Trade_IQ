import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Candle, SRLevel, TradeSignal } from "@shared/schema";

interface CandlestickChartProps {
  candles: Candle[];
  supportLevels: SRLevel[];
  resistanceLevels: SRLevel[];
  signal?: TradeSignal | null;
  currentPrice: number;
  instrument: string;
}

export function CandlestickChart({
  candles,
  supportLevels,
  resistanceLevels,
  signal,
  currentPrice,
  instrument,
}: CandlestickChartProps) {
  const chartData = useMemo(() => {
    if (!candles.length) return { candles: [], minPrice: 0, maxPrice: 0, priceRange: 0 };

    const allPrices = candles.flatMap((c) => [c.high, c.low]);
    const srPrices = [...supportLevels, ...resistanceLevels].map((l) => l.price);
    const allValues = [...allPrices, ...srPrices, currentPrice];
    
    if (signal) {
      allValues.push(signal.stopLoss, signal.takeProfit1, signal.entryZone.low, signal.entryZone.high);
      if (signal.takeProfit2) allValues.push(signal.takeProfit2);
    }

    const minPrice = Math.min(...allValues) * 0.999;
    const maxPrice = Math.max(...allValues) * 1.001;
    const priceRange = maxPrice - minPrice;

    return { candles, minPrice, maxPrice, priceRange };
  }, [candles, supportLevels, resistanceLevels, signal, currentPrice]);

  const priceToY = (price: number) => {
    const { minPrice, priceRange } = chartData;
    return ((chartData.maxPrice - price) / priceRange) * 100;
  };

  const formatPrice = (price: number) => {
    return instrument === "XAUUSD" ? price.toFixed(2) : price.toFixed(5);
  };

  const chartHeight = 300;
  const chartWidth = "100%";
  const candleWidth = Math.max(4, Math.min(12, 600 / candles.length));
  const candleGap = 2;

  return (
    <Card data-testid="card-candlestick-chart">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span>Price Chart</span>
          <span className="text-xs text-muted-foreground">{candles.length} candles</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative" style={{ height: chartHeight }}>
          <svg
            width={chartWidth}
            height={chartHeight}
            className="overflow-visible"
            viewBox={`0 0 ${candles.length * (candleWidth + candleGap) + 80} ${chartHeight}`}
            preserveAspectRatio="none"
          >
            {supportLevels.map((level, i) => (
              <g key={`support-${i}`}>
                <line
                  x1="0"
                  y1={`${priceToY(level.price)}%`}
                  x2="100%"
                  y2={`${priceToY(level.price)}%`}
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={level.strength === "strong" ? 2 : 1}
                  strokeDasharray={level.strength === "weak" ? "4,4" : "none"}
                  opacity={0.6}
                />
                <text
                  x="100%"
                  y={`${priceToY(level.price)}%`}
                  fill="hsl(var(--chart-1))"
                  fontSize="10"
                  dy="-4"
                  dx="-60"
                  className="font-mono"
                >
                  S: {formatPrice(level.price)}
                </text>
              </g>
            ))}

            {resistanceLevels.map((level, i) => (
              <g key={`resistance-${i}`}>
                <line
                  x1="0"
                  y1={`${priceToY(level.price)}%`}
                  x2="100%"
                  y2={`${priceToY(level.price)}%`}
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={level.strength === "strong" ? 2 : 1}
                  strokeDasharray={level.strength === "weak" ? "4,4" : "none"}
                  opacity={0.6}
                />
                <text
                  x="100%"
                  y={`${priceToY(level.price)}%`}
                  fill="hsl(var(--chart-2))"
                  fontSize="10"
                  dy="-4"
                  dx="-60"
                  className="font-mono"
                >
                  R: {formatPrice(level.price)}
                </text>
              </g>
            ))}

            {signal && (
              <>
                <rect
                  x="0"
                  y={`${priceToY(signal.entryZone.high)}%`}
                  width="100%"
                  height={`${priceToY(signal.entryZone.low) - priceToY(signal.entryZone.high)}%`}
                  fill="hsl(var(--chart-3))"
                  opacity={0.15}
                />
                <line
                  x1="0"
                  y1={`${priceToY(signal.stopLoss)}%`}
                  x2="100%"
                  y2={`${priceToY(signal.stopLoss)}%`}
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  strokeDasharray="6,3"
                />
                <line
                  x1="0"
                  y1={`${priceToY(signal.takeProfit1)}%`}
                  x2="100%"
                  y2={`${priceToY(signal.takeProfit1)}%`}
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  strokeDasharray="6,3"
                />
              </>
            )}

            <line
              x1="0"
              y1={`${priceToY(currentPrice)}%`}
              x2="100%"
              y2={`${priceToY(currentPrice)}%`}
              stroke="hsl(var(--primary))"
              strokeWidth={1}
              strokeDasharray="2,2"
            />

            {candles.map((candle, i) => {
              const x = i * (candleWidth + candleGap) + 40;
              const isBullish = candle.close >= candle.open;
              const bodyTop = isBullish ? candle.close : candle.open;
              const bodyBottom = isBullish ? candle.open : candle.close;
              const color = isBullish ? "hsl(var(--chart-1))" : "hsl(var(--chart-2))";

              return (
                <g key={i}>
                  <line
                    x1={x + candleWidth / 2}
                    y1={`${priceToY(candle.high)}%`}
                    x2={x + candleWidth / 2}
                    y2={`${priceToY(candle.low)}%`}
                    stroke={color}
                    strokeWidth={1}
                  />
                  <rect
                    x={x}
                    y={`${priceToY(bodyTop)}%`}
                    width={candleWidth}
                    height={`${Math.max(1, priceToY(bodyBottom) - priceToY(bodyTop))}%`}
                    fill={isBullish ? color : color}
                    stroke={color}
                    strokeWidth={1}
                  />
                </g>
              );
            })}
          </svg>

          <div className="absolute right-0 top-0 h-full flex flex-col justify-between text-xs text-muted-foreground font-mono py-1">
            <span>{formatPrice(chartData.maxPrice)}</span>
            <span className="text-primary font-medium">{formatPrice(currentPrice)}</span>
            <span>{formatPrice(chartData.minPrice)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mt-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[hsl(var(--chart-1))]" />
            <span>Bullish / Support</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[hsl(var(--chart-2))]" />
            <span>Bearish / Resistance</span>
          </div>
          {signal && (
            <>
              <div className="flex items-center gap-1">
                <div className="w-3 h-1 bg-[hsl(var(--destructive))]" />
                <span>Stop Loss</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-1 bg-[hsl(var(--chart-1))]" />
                <span>Take Profit</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
