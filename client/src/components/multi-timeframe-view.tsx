import { useQueries } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Clock, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { timeframes, type MarketAnalysis, type Timeframe } from "@shared/schema";

interface MultiTimeframeViewProps {
  instrument: string;
}

export function MultiTimeframeView({ instrument }: MultiTimeframeViewProps) {
  const queries = useQueries({
    queries: timeframes.map((tf) => ({
      queryKey: ["/api/analysis", instrument, tf] as const,
      staleTime: 30000,
    })),
  });

  const timeframeQueries = timeframes.map((tf, index) => ({
    timeframe: tf,
    query: queries[index] as { data?: MarketAnalysis; isLoading: boolean },
  }));

  const getTrendIcon = (direction: string) => {
    switch (direction) {
      case "up":
        return <TrendingUp className="w-4 h-4 text-green-400" />;
      case "down":
        return <TrendingDown className="w-4 h-4 text-red-400" />;
      default:
        return <Minus className="w-4 h-4 text-amber-400" />;
    }
  };

  const getMarketStateColor = (state: string) => {
    switch (state) {
      case "uptrend":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "downtrend":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "ranging":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case "high_risk":
        return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const getAlignmentScore = () => {
    const loadedQueries = timeframeQueries.filter(q => q.query.data);
    if (loadedQueries.length === 0) return null;

    const bullishCount = loadedQueries.filter(q => q.query.data?.trend.direction === "up").length;
    const bearishCount = loadedQueries.filter(q => q.query.data?.trend.direction === "down").length;
    const sidewaysCount = loadedQueries.filter(q => q.query.data?.trend.direction === "sideways").length;
    const total = loadedQueries.length;

    // Calculate percentages for display
    const bullishPct = Math.round((bullishCount / total) * 100);
    const bearishPct = Math.round((bearishCount / total) * 100);

    if (bullishCount >= total * 0.7) return { 
      direction: "bullish", 
      strength: "strong", 
      color: "text-bullish",
      bgColor: "bg-bullish/10 border-bullish/30",
      icon: CheckCircle2,
      bullishCount, bearishCount, sidewaysCount, total, bullishPct, bearishPct,
      recommendation: "TRADE WITH TREND - Multiple timeframes confirm bullish momentum"
    };
    if (bullishCount >= total * 0.5) return { 
      direction: "bullish", 
      strength: "moderate", 
      color: "text-bullish",
      bgColor: "bg-bullish/5 border-bullish/20",
      icon: TrendingUp,
      bullishCount, bearishCount, sidewaysCount, total, bullishPct, bearishPct,
      recommendation: "Lean bullish but watch lower timeframes for entry timing"
    };
    if (bearishCount >= total * 0.7) return { 
      direction: "bearish", 
      strength: "strong", 
      color: "text-bearish",
      bgColor: "bg-bearish/10 border-bearish/30",
      icon: CheckCircle2,
      bullishCount, bearishCount, sidewaysCount, total, bullishPct, bearishPct,
      recommendation: "TRADE WITH TREND - Multiple timeframes confirm bearish momentum"
    };
    if (bearishCount >= total * 0.5) return { 
      direction: "bearish", 
      strength: "moderate", 
      color: "text-bearish",
      bgColor: "bg-bearish/5 border-bearish/20",
      icon: TrendingDown,
      bullishCount, bearishCount, sidewaysCount, total, bullishPct, bearishPct,
      recommendation: "Lean bearish but watch lower timeframes for entry timing"
    };
    return { 
      direction: "mixed", 
      strength: "conflicting", 
      color: "text-amber-400",
      bgColor: "bg-amber-500/10 border-amber-500/30",
      icon: AlertTriangle,
      bullishCount, bearishCount, sidewaysCount, total, bullishPct, bearishPct,
      recommendation: "WAIT - Timeframes are conflicting. Lower probability setup."
    };
  };

  const alignment = getAlignmentScore();

  return (
    <Card data-testid="card-multi-timeframe">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Multi-Timeframe Analysis
          </CardTitle>
          {alignment && (
            <Badge variant="outline" className={alignment.color}>
              {alignment.strength} {alignment.direction}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {timeframeQueries.map(({ timeframe, query }) => (
            <div
              key={timeframe}
              className="p-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors text-center"
              data-testid={`mtf-${timeframe}`}
            >
              <div className="text-xs text-muted-foreground mb-1">{timeframe}</div>
              
              {query.isLoading ? (
                <Skeleton className="h-8 w-full" />
              ) : query.data ? (
                <>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    {getTrendIcon(query.data.trend.direction)}
                    <span className="text-sm font-medium">
                      {query.data.trend.strength}%
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs ${getMarketStateColor(query.data.marketState)}`}
                  >
                    {query.data.marketState === "uptrend" ? "Bull" :
                     query.data.marketState === "downtrend" ? "Bear" :
                     query.data.marketState === "ranging" ? "Range" :
                     query.data.marketState}
                  </Badge>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">No data</div>
              )}
            </div>
          ))}
        </div>

        {alignment && (
          <div className={`mt-4 p-3 rounded-md border ${alignment.bgColor}`}>
            <div className="flex items-start gap-3">
              <alignment.icon className={`w-5 h-5 mt-0.5 ${alignment.color}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-bold ${alignment.color}`}>
                    {alignment.direction === "mixed" ? "CONFLICTING SIGNALS" : 
                     `${alignment.strength.toUpperCase()} ${alignment.direction.toUpperCase()}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({alignment.bullishCount} bullish / {alignment.bearishCount} bearish / {alignment.sidewaysCount} sideways)
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {alignment.recommendation}
                </p>
                {alignment.direction === "mixed" && (
                  <p className="text-xs text-amber-400 mt-1">
                    The 1m/5m may show short-term reversals while higher timeframes show the main trend. 
                    Use higher timeframe direction for trade bias.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
