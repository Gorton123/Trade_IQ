import { useEffect, useRef, memo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Loader2 } from "lucide-react";
import type { Instrument, Timeframe } from "@shared/schema";

interface TradingViewChartProps {
  instrument: Instrument;
  timeframe: Timeframe;
}

const symbolMap: Record<Instrument, string> = {
  XAUUSD: "OANDA:XAUUSD",
  XAGUSD: "OANDA:XAGUSD",
  EURUSD: "FX:EURUSD",
  GBPUSD: "FX:GBPUSD",
  USDCHF: "FX:USDCHF",
  AUDUSD: "FX:AUDUSD",
  NZDUSD: "FX:NZDUSD",
};

const intervalMap: Record<Timeframe, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1D": "D",
  "1W": "W",
  "1M": "M",
};

let tvScriptLoaded = false;
let tvScriptLoading = false;
const tvScriptCallbacks: (() => void)[] = [];

function loadTradingViewScript(callback: () => void) {
  if (tvScriptLoaded) {
    callback();
    return;
  }
  tvScriptCallbacks.push(callback);
  if (tvScriptLoading) return;
  tvScriptLoading = true;
  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/tv.js";
  script.async = true;
  script.onload = () => {
    tvScriptLoaded = true;
    tvScriptLoading = false;
    tvScriptCallbacks.forEach(cb => cb());
    tvScriptCallbacks.length = 0;
  };
  script.onerror = () => {
    tvScriptLoading = false;
  };
  document.head.appendChild(script);
}

function TradingViewChartComponent({ instrument, timeframe }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const containerId = `tradingview_${instrument}_${timeframe}_${Date.now()}`;
    containerRef.current.innerHTML = '';
    setLoading(true);
    
    const widgetContainer = document.createElement('div');
    widgetContainer.id = containerId;
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';
    containerRef.current.appendChild(widgetContainer);

    const createWidget = () => {
      if (typeof (window as any).TradingView === "undefined" || !containerRef.current) return;
      if (!document.getElementById(containerId)) return;
      
      try {
        widgetRef.current = new (window as any).TradingView.widget({
          autosize: true,
          symbol: symbolMap[instrument],
          interval: intervalMap[timeframe],
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#1a1a2e",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: containerId,
          studies: [
            "RSI@tv-basicstudies",
            "MASimple@tv-basicstudies",
            "MACD@tv-basicstudies"
          ],
          allow_symbol_change: false,
          disabled_features: [
            "header_symbol_search",
            "header_compare",
            "display_market_status",
          ],
          enabled_features: [
            "use_localstorage_for_settings",
            "side_toolbar_in_fullscreen_mode",
          ],
          overrides: {
            "mainSeriesProperties.candleStyle.upColor": "#22c55e",
            "mainSeriesProperties.candleStyle.downColor": "#ef4444",
            "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
            "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
            "paneProperties.background": "#0a0a0f",
            "paneProperties.vertGridProperties.color": "#1a1a2e",
            "paneProperties.horzGridProperties.color": "#1a1a2e",
          },
        });
        setLoading(false);
      } catch (e) {
        console.warn("TradingView widget creation failed:", e);
        setLoading(false);
      }
    };

    loadTradingViewScript(createWidget);

    return () => {
      widgetRef.current = null;
    };
  }, [instrument, timeframe]);

  return (
    <Card data-testid="card-tradingview-chart">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Live Chart - {instrument} ({timeframe})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0a0a0f]">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <div 
            ref={containerRef} 
            className="h-[500px] w-full rounded-lg overflow-hidden bg-[#0a0a0f]"
            data-testid="tradingview-container"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export const TradingViewChart = memo(TradingViewChartComponent);
