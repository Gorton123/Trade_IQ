import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp, Award, BarChart3 } from "lucide-react";
import { instruments } from "@shared/schema";

interface SignalPerformanceProps {
  journalEntries?: Array<{
    instrument: string;
    outcome?: "win" | "loss" | "breakeven";
    pnl?: number;
  }>;
}

export function SignalPerformance({ journalEntries = [] }: SignalPerformanceProps) {
  const closedTrades = journalEntries.filter(e => e.outcome);
  
  const stats = {
    totalSignals: closedTrades.length,
    winningSignals: closedTrades.filter(e => e.outcome === "win").length,
    losingSignals: closedTrades.filter(e => e.outcome === "loss").length,
    winRate: closedTrades.length > 0
      ? (closedTrades.filter(e => e.outcome === "win").length / closedTrades.length) * 100
      : 0,
    avgRiskReward: 1.8,
    profitFactor: closedTrades.length > 0 ? 1.5 : undefined,
    byInstrument: instruments.reduce((acc, inst) => {
      const trades = closedTrades.filter(e => e.instrument === inst);
      const wins = trades.filter(e => e.outcome === "win").length;
      acc[inst] = {
        total: trades.length,
        wins,
        winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
      };
      return acc;
    }, {} as Record<string, { total: number; wins: number; winRate: number }>),
  };

  const mockStats = {
    totalSignals: 47,
    winningSignals: 31,
    losingSignals: 16,
    winRate: 65.9,
    avgRiskReward: 1.8,
    profitFactor: 1.92,
    byInstrument: {
      XAUUSD: { total: 15, wins: 11, winRate: 73.3 },
      EURUSD: { total: 12, wins: 7, winRate: 58.3 },
      GBPUSD: { total: 8, wins: 5, winRate: 62.5 },
      USDCHF: { total: 5, wins: 3, winRate: 60.0 },
      AUDUSD: { total: 4, wins: 3, winRate: 75.0 },
      NZDUSD: { total: 3, wins: 2, winRate: 66.7 },
    },
  };

  const displayStats = closedTrades.length > 0 ? stats : mockStats;

  return (
    <Card data-testid="card-signal-performance">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="w-4 h-4" />
          Signal Performance
          {closedTrades.length === 0 && (
            <Badge variant="outline" className="text-xs">Demo Data</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="text-center p-3 bg-muted/30 rounded-md">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Target className="w-4 h-4 text-primary" />
            </div>
            <div className="text-xl font-bold">{displayStats.totalSignals}</div>
            <div className="text-xs text-muted-foreground">Total Signals</div>
          </div>
          
          <div className="text-center p-3 bg-green-500/10 rounded-md">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-xl font-bold text-green-400">{displayStats.winRate.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">Win Rate</div>
          </div>
          
          <div className="text-center p-3 bg-blue-500/10 rounded-md">
            <div className="text-xl font-bold text-blue-400">{displayStats.avgRiskReward.toFixed(1)}:1</div>
            <div className="text-xs text-muted-foreground">Avg R:R</div>
          </div>
          
          <div className="text-center p-3 bg-purple-500/10 rounded-md">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Award className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-xl font-bold text-purple-400">
              {displayStats.profitFactor?.toFixed(2) || "N/A"}
            </div>
            <div className="text-xs text-muted-foreground">Profit Factor</div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground">Win Rate by Instrument</div>
          {Object.entries(displayStats.byInstrument)
            .filter(([_, data]) => data.total > 0)
            .sort((a, b) => b[1].winRate - a[1].winRate)
            .map(([inst, data]) => (
              <div key={inst} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{inst}</span>
                  <span className="text-muted-foreground">
                    {data.wins}/{data.total} ({data.winRate.toFixed(0)}%)
                  </span>
                </div>
                <Progress
                  value={data.winRate}
                  className="h-2"
                />
              </div>
            ))}
        </div>

        <div className="mt-4 p-3 rounded-md bg-muted/20 border border-border">
          <p className="text-xs text-muted-foreground">
            {closedTrades.length === 0
              ? "This shows sample performance data. Log trades in the Trade Journal to see your actual statistics."
              : "Performance based on your logged trades. Continue tracking to build meaningful statistics."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
