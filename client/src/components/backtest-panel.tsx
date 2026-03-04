import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FlaskConical, TrendingUp, TrendingDown, Target, AlertTriangle } from "lucide-react";
import type { Instrument, Timeframe } from "@shared/schema";

interface BacktestResult {
  instrument: string;
  timeframe: string;
  period: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlPips: number;
  avgWinPips: number;
  avgLossPips: number;
  profitFactor: number;
  maxDrawdownPips: number;
  bestTrade: number;
  worstTrade: number;
  dataSource: string;
  signalAccuracy: {
    byConfidence: Record<string, { total: number; wins: number; winRate: number }>;
    byReason: Record<string, { total: number; wins: number; winRate: number }>;
  };
}

interface BacktestPanelProps {
  instrument: Instrument;
  timeframe: Timeframe;
}

export function BacktestPanel({ instrument, timeframe }: BacktestPanelProps) {
  const { data, isLoading, error } = useQuery<BacktestResult>({
    queryKey: ["/api/backtest", instrument, timeframe],
    staleTime: 300000, // 5 minutes
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center gap-3 py-8">
            <FlaskConical className="h-5 w-5 animate-pulse text-primary" />
            <span className="text-sm text-muted-foreground">Running backtest...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm">Failed to load backtest results</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isProfitable = data.totalPnlPips > 0;
  const isReliable = data.winRate >= 50 && data.profitFactor >= 1.5;

  return (
    <div className="space-y-4">
      <Card data-testid="card-backtest-summary">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            Backtest Results - {instrument} ({timeframe})
            {data.dataSource === 'twelvedata' ? (
              <Badge variant="outline" className="ml-auto text-xs text-bullish border-bullish/30">
                REAL DATA
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-auto text-xs text-warning border-warning/30">
                SIMULATED
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground">
            Period: {data.period} | {data.totalTrades} trades analyzed
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox 
              label="Win Rate" 
              value={`${data.winRate.toFixed(1)}%`}
              subValue={`${data.wins}W / ${data.losses}L`}
              isGood={data.winRate >= 50}
            />
            <StatBox 
              label="Total P/L" 
              value={`${isProfitable ? '+' : ''}${data.totalPnlPips} pips`}
              isGood={isProfitable}
            />
            <StatBox 
              label="Profit Factor" 
              value={data.profitFactor.toFixed(2)}
              subValue={data.profitFactor >= 1.5 ? 'Good' : data.profitFactor >= 1 ? 'Marginal' : 'Poor'}
              isGood={data.profitFactor >= 1.5}
            />
            <StatBox 
              label="Max Drawdown" 
              value={`${data.maxDrawdownPips} pips`}
              isGood={false}
              neutral
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-bullish/10 border border-bullish/20">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-3 w-3 text-bullish" />
                <span className="text-xs text-bullish">Avg Win</span>
              </div>
              <div className="text-lg font-bold text-bullish">+{data.avgWinPips} pips</div>
              <div className="text-xs text-muted-foreground">Best: +{data.bestTrade} pips</div>
            </div>
            <div className="p-3 rounded-lg bg-bearish/10 border border-bearish/20">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-3 w-3 text-bearish" />
                <span className="text-xs text-bearish">Avg Loss</span>
              </div>
              <div className="text-lg font-bold text-bearish">-{data.avgLossPips} pips</div>
              <div className="text-xs text-muted-foreground">Worst: {data.worstTrade} pips</div>
            </div>
          </div>

          <div className={`p-3 rounded-lg ${isReliable ? 'bg-bullish/10 border border-bullish/30' : 'bg-warning/10 border border-warning/30'}`}>
            <div className="flex items-center gap-2">
              <Target className={`h-4 w-4 ${isReliable ? 'text-bullish' : 'text-warning'}`} />
              <span className={`text-sm font-medium ${isReliable ? 'text-bullish' : 'text-warning'}`}>
                {isReliable ? 'Signal Strategy Validated' : 'Strategy Needs Improvement'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isReliable 
                ? `This strategy shows ${data.winRate.toFixed(0)}% accuracy with ${data.profitFactor.toFixed(1)}x profit factor. Signals are historically reliable.`
                : `Win rate of ${data.winRate.toFixed(0)}% and profit factor of ${data.profitFactor.toFixed(1)}x suggest caution. Consider additional confirmation.`
              }
            </p>
          </div>
        </CardContent>
      </Card>

      {data.signalAccuracy.byConfidence && Object.keys(data.signalAccuracy.byConfidence).length > 0 && (
        <Card data-testid="card-accuracy-by-confidence">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Accuracy by Confidence Level</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(data.signalAccuracy.byConfidence).map(([level, stats]) => (
                <div key={level} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize">{level} Confidence</span>
                    <span className={stats.winRate >= 50 ? 'text-bullish' : 'text-bearish'}>
                      {stats.winRate.toFixed(1)}% ({stats.wins}/{stats.total})
                    </span>
                  </div>
                  <Progress value={stats.winRate} className="h-2" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatBox({ 
  label, 
  value, 
  subValue, 
  isGood,
  neutral = false 
}: { 
  label: string; 
  value: string; 
  subValue?: string;
  isGood: boolean;
  neutral?: boolean;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/40">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-bold ${neutral ? '' : isGood ? 'text-bullish' : 'text-bearish'}`}>
        {value}
      </div>
      {subValue && (
        <div className="text-xs text-muted-foreground">{subValue}</div>
      )}
    </div>
  );
}
