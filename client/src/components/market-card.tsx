import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Ban, Zap } from "lucide-react";
import type { MarketAnalysis, MarketState } from "@shared/schema";

interface MarketCardProps {
  analysis: MarketAnalysis | null;
  isLoading?: boolean;
  onClick?: () => void;
}

const stateConfig: Record<MarketState, { 
  label: string; 
  color: string; 
  bgColor: string;
  icon: React.ReactNode;
}> = {
  uptrend: {
    label: "Uptrend",
    color: "text-bullish",
    bgColor: "bg-bullish/10",
    icon: <TrendingUp className="w-4 h-4" />,
  },
  downtrend: {
    label: "Downtrend",
    color: "text-bearish",
    bgColor: "bg-bearish/10",
    icon: <TrendingDown className="w-4 h-4" />,
  },
  ranging: {
    label: "Ranging",
    color: "text-neutral",
    bgColor: "bg-neutral-signal/10",
    icon: <Minus className="w-4 h-4" />,
  },
  high_risk: {
    label: "High Risk",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  no_trade: {
    label: "No Trade",
    color: "text-muted-foreground",
    bgColor: "bg-muted/50",
    icon: <Ban className="w-4 h-4" />,
  },
};

const instrumentIcons: Record<string, string> = {
  XAUUSD: "Au",
  XAGUSD: "Ag",
  EURUSD: "EU",
  GBPUSD: "GB",
  USDCHF: "CH",
  AUDUSD: "AU",
  NZDUSD: "NZ",
};

const instrumentNames: Record<string, string> = {
  XAUUSD: "Gold / USD",
  XAGUSD: "Silver / USD",
  EURUSD: "Euro / USD",
  GBPUSD: "Pound / USD",
  USDCHF: "USD / Swiss",
  AUDUSD: "Aussie / USD",
  NZDUSD: "Kiwi / USD",
};

export function MarketCard({ analysis, isLoading, onClick }: MarketCardProps) {
  if (isLoading) {
    return (
      <Card className="hover-elevate active-elevate-2 cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-20" />
        </CardContent>
      </Card>
    );
  }

  if (!analysis) {
    return (
      <Card className="opacity-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">No Data</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Unable to load market data</p>
        </CardContent>
      </Card>
    );
  }

  const state = stateConfig[analysis.marketState];
  const isMetal = analysis.instrument === "XAUUSD" || analysis.instrument === "XAGUSD";
  const isSilver = analysis.instrument === "XAGUSD";
  const priceChange = analysis.changePercent;
  const isPositive = priceChange >= 0;
  
  const volatilityColor = analysis.volatility === 'high' 
    ? 'text-amber-500' 
    : analysis.volatility === 'medium' 
      ? 'text-blue-500' 
      : 'text-muted-foreground';

  const trendStrengthBar = Math.min(100, Math.max(0, analysis.trend.strength));

  return (
    <Card 
      className="hover-elevate active-elevate-2 cursor-pointer transition-all duration-200"
      onClick={onClick}
      data-testid={`card-market-${analysis.instrument}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${isSilver ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white' : isMetal ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white' : 'bg-gradient-to-br from-primary/80 to-primary text-primary-foreground'}`}>
              {instrumentIcons[analysis.instrument] || analysis.instrument.slice(0, 2)}
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{analysis.instrument}</CardTitle>
              <p className="text-xs text-muted-foreground">{instrumentNames[analysis.instrument]}</p>
            </div>
          </div>
          <Badge 
            variant="secondary" 
            className={`${state.bgColor} ${state.color} text-xs font-medium`}
          >
            <span className="flex items-center gap-1">
              {state.icon}
              {state.label}
            </span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold font-price" data-testid={`price-${analysis.instrument}`}>
            {analysis.currentPrice != null ? (isMetal ? analysis.currentPrice.toFixed(2) : analysis.currentPrice.toFixed(5)) : "—"}
          </span>
          <span className={`text-sm font-semibold flex items-center gap-1 ${isPositive ? 'text-bullish' : 'text-bearish'}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? '+' : ''}{priceChange != null ? priceChange.toFixed(2) : "0.00"}%
          </span>
        </div>
        
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Trend Strength</span>
            <span className="font-medium">{analysis.trend.strength}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                analysis.trend.direction === 'up' 
                  ? 'bg-bullish' 
                  : analysis.trend.direction === 'down' 
                    ? 'bg-bearish' 
                    : 'bg-neutral-signal'
              }`}
              style={{ width: `${trendStrengthBar}%` }}
            />
          </div>
        </div>
        
        <div className="flex gap-1.5 flex-wrap pt-1">
          <Badge variant="outline" className="text-xs">
            {analysis.timeframe}
          </Badge>
          <Badge variant="outline" className={`text-xs ${volatilityColor}`}>
            <Zap className="w-3 h-3 mr-0.5" />
            {analysis.volatility}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function MarketCardSkeleton() {
  return <MarketCard analysis={null} isLoading={true} />;
}
