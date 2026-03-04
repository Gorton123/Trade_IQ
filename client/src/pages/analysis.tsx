import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, Activity, BarChart3, AlertCircle, RefreshCw } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const INSTRUMENTS = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDCHF", "AUDUSD", "NZDUSD"];
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

interface AnalysisData {
  instrument: string;
  timeframe: string;
  trend: { direction: string; strength: number };
  currentPrice: number;
  previousClose?: number;
  changePercent?: number;
  marketState: string;
  volatility: string;
  supportLevels: Array<{ price: number; strength: string; type: string; touches: number }>;
  resistanceLevels: Array<{ price: number; strength: string; type: string; touches: number }>;
  lastUpdated?: string;
}

function TradingViewWidget({ instrument, timeframe }: { instrument: string; timeframe: string }) {
  const { theme } = useTheme();
  const symbol = instrument === "XAUUSD" ? "OANDA:XAUUSD" : `OANDA:${instrument}`;
  const interval = timeframe === "1D" ? "D" : timeframe === "1W" ? "W" : timeframe === "1M" ? "M" : timeframe.replace("m", "").replace("h", "60");
  const chartTheme = theme === "dark" ? "dark" : "light";
  
  return (
    <div className="w-full h-[400px] rounded-lg overflow-hidden border">
      <iframe
        src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${symbol}&interval=${interval}&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=f1f3f6&studies=%5B%5D&theme=${chartTheme}&style=1&timezone=Etc%2FUTC&withdateranges=1&showpopupbutton=1&studies_overrides=%7B%7D&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=en`}
        style={{ width: "100%", height: "100%", border: "none" }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        title="TradingView Chart"
      />
    </div>
  );
}

export default function AnalysisPage() {
  const [instrument, setInstrument] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("5m");

  const { data, isLoading, error, refetch } = useQuery<AnalysisData>({
    queryKey: [`/api/analysis/${instrument}/${timeframe}`],
    enabled: !!instrument && !!timeframe,
  });

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center gap-2">
            Failed to load analysis data. 
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Market Analysis</h1>
          <p className="text-muted-foreground">Technical analysis with live charts</p>
        </div>
        <div className="flex gap-2">
          <Select value={instrument} onValueChange={setInstrument}>
            <SelectTrigger className="w-[140px]" data-testid="select-instrument">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INSTRUMENTS.map((i) => (
                <SelectItem key={i} value={i}>{i}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-[100px]" data-testid="select-timeframe">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((tf) => (
                <SelectItem key={tf} value={tf}>{tf}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <TradingViewWidget instrument={instrument} timeframe={timeframe} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-trend">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {data?.trend?.direction === "bullish" || data?.trend?.direction === "uptrend" ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : data?.trend?.direction === "bearish" || data?.trend?.direction === "downtrend" ? (
                <TrendingDown className="h-4 w-4 text-red-500" />
              ) : (
                <Activity className="h-4 w-4 text-yellow-500" />
              )}
              Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="space-y-2">
                <Badge 
                  variant={data?.trend?.direction === "bullish" || data?.trend?.direction === "uptrend" ? "default" : 
                           data?.trend?.direction === "bearish" || data?.trend?.direction === "downtrend" ? "destructive" : "secondary"}
                  className="text-sm"
                >
                  {(data?.trend?.direction || "neutral").toUpperCase()}
                </Badge>
                <div className="text-sm text-muted-foreground">
                  Strength: {data?.trend?.strength || 0}%
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-indicators">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Market State
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">State</span>
                  <Badge variant="outline" className="text-xs capitalize">
                    {data?.marketState || "Unknown"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Volatility</span>
                  <Badge 
                    variant={data?.volatility === "high" ? "destructive" : data?.volatility === "low" ? "secondary" : "outline"} 
                    className="text-xs capitalize"
                  >
                    {data?.volatility || "Medium"}
                  </Badge>
                </div>
                {data?.changePercent !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Change</span>
                    <span className={data.changePercent >= 0 ? "text-green-500" : "text-red-500"}>
                      {data.changePercent >= 0 ? "+" : ""}{data.changePercent.toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-levels">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Key Levels</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resistance</span>
                  <span className="text-red-500 font-mono">
                    {data?.resistanceLevels?.[0]?.price?.toFixed(data?.instrument === "XAUUSD" || data?.instrument === "XAGUSD" ? 2 : 5) || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Support</span>
                  <span className="text-green-500 font-mono">
                    {data?.supportLevels?.[0]?.price?.toFixed(data?.instrument === "XAUUSD" || data?.instrument === "XAGUSD" ? 2 : 5) || "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-medium font-mono">
                    {data?.currentPrice?.toFixed(data?.instrument === "XAUUSD" || data?.instrument === "XAGUSD" ? 2 : 5) || "N/A"}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
