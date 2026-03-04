import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  Target,
  DollarSign,
  Activity,
  AlertTriangle
} from "lucide-react";
import type { SmartMoneyData, Instrument, Timeframe } from "@shared/schema";

interface SmartMoneyPanelProps {
  instrument: Instrument;
  timeframe: Timeframe;
  currentPrice: number;
}

export function SmartMoneyPanel({ instrument, timeframe, currentPrice }: SmartMoneyPanelProps) {
  const { data, isLoading } = useQuery<SmartMoneyData>({
    queryKey: ["/api/smart-money", instrument, timeframe],
    staleTime: 30000,
  });

  const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
  const decimals = isMetal ? 2 : 5;

  if (isLoading) {
    return (
      <Card data-testid="card-smart-money">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Institutional Levels</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const OrderFlowIcon = data.orderFlow.bias === "bullish" ? TrendingUp : 
                        data.orderFlow.bias === "bearish" ? TrendingDown : Minus;

  const orderFlowColor = data.orderFlow.bias === "bullish" ? "text-bullish" :
                         data.orderFlow.bias === "bearish" ? "text-bearish" : "text-muted-foreground";

  return (
    <Card data-testid="card-smart-money">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Smart Money Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Order Flow Analysis */}
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">ORDER FLOW</span>
            <div className="flex items-center gap-1">
              <OrderFlowIcon className={`w-4 h-4 ${orderFlowColor}`} />
              <Badge 
                variant="outline" 
                className={data.orderFlow.bias === "bullish" ? "border-bullish text-bullish" : 
                          data.orderFlow.bias === "bearish" ? "border-bearish text-bearish" : ""}
              >
                {data.orderFlow.bias.toUpperCase()} ({data.orderFlow.strength}%)
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{data.orderFlow.description}</p>
        </div>

        {/* Next Targets */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-bullish/10 border border-bullish/20">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-bullish" />
              <span className="text-xs font-medium text-bullish">NEXT TARGET UP</span>
            </div>
            <div className="text-lg font-bold text-bullish">
              ${data.nextTargetUp?.toFixed(decimals) || "N/A"}
            </div>
            {data.nextTargetUp && (
              <div className="text-xs text-muted-foreground">
                +{((data.nextTargetUp - currentPrice)).toFixed(decimals)} ({((data.nextTargetUp - currentPrice) / currentPrice * 100).toFixed(2)}%)
              </div>
            )}
          </div>
          <div className="p-3 rounded-lg bg-bearish/10 border border-bearish/20">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-bearish" />
              <span className="text-xs font-medium text-bearish">NEXT TARGET DOWN</span>
            </div>
            <div className="text-lg font-bold text-bearish">
              ${data.nextTargetDown?.toFixed(decimals) || "N/A"}
            </div>
            {data.nextTargetDown && (
              <div className="text-xs text-muted-foreground">
                {((data.nextTargetDown - currentPrice)).toFixed(decimals)} ({((data.nextTargetDown - currentPrice) / currentPrice * 100).toFixed(2)}%)
              </div>
            )}
          </div>
        </div>

        {/* Psychological Levels */}
        <div>
          <div className="flex items-center gap-1 mb-2">
            <DollarSign className="w-3 h-3 text-primary" />
            <span className="text-xs font-medium">PSYCHOLOGICAL LEVELS (Whale Zones)</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {data.psychologicalLevels
              .filter(l => l.significance !== "minor")
              .slice(0, 6)
              .map((level, i) => (
                <Badge 
                  key={i}
                  variant="outline"
                  className={`text-xs ${
                    level.significance === "critical" 
                      ? "border-amber-500 text-amber-500 bg-amber-500/10" 
                      : "border-muted-foreground/50"
                  } ${level.price > currentPrice ? "border-l-2 border-l-bullish" : "border-l-2 border-l-bearish"}`}
                >
                  ${level.price.toLocaleString()}
                </Badge>
              ))}
          </div>
        </div>

        {/* Liquidity Zones */}
        <div>
          <div className="flex items-center gap-1 mb-2">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            <span className="text-xs font-medium">LIQUIDITY ZONES (Stop Hunts)</span>
          </div>
          <div className="space-y-1">
            {data.liquidityZones.slice(0, 4).map((zone, i) => (
              <div 
                key={i}
                className={`flex items-center justify-between p-2 rounded text-xs ${
                  zone.type === "liquidity_sell" 
                    ? "bg-bullish/10 border-l-2 border-l-bullish" 
                    : "bg-bearish/10 border-l-2 border-l-bearish"
                }`}
              >
                <span className="text-muted-foreground">{zone.label}</span>
                <span className="font-mono font-medium">
                  ${zone.price.toFixed(decimals)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Session Levels */}
        {data.sessionLevels.length > 0 && (
          <div>
            <div className="flex items-center gap-1 mb-2">
              <Activity className="w-3 h-3 text-primary" />
              <span className="text-xs font-medium">SESSION LEVELS</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {data.sessionLevels.slice(0, 4).map((level, i) => (
                <div 
                  key={i}
                  className={`p-2 rounded text-xs ${
                    level.type === "session_high" 
                      ? "bg-bullish/10" 
                      : "bg-bearish/10"
                  }`}
                >
                  <div className="text-muted-foreground text-[10px]">{level.label}</div>
                  <div className="font-mono font-medium">${level.price.toFixed(decimals)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trading Tip */}
        <div className="p-2 rounded bg-primary/10 border border-primary/20">
          <p className="text-xs text-muted-foreground">
            <strong className="text-primary">Whale Strategy:</strong> Wait for price to sweep liquidity zones (stop hunts), 
            then look for reversal entries near psychological levels. Institutions often push price to grab stops before reversing.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
