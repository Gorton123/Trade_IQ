import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  Database, 
  Download, 
  Play, 
  TrendingUp, 
  TrendingDown,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  Target,
  AlertTriangle,
  Shield,
  Calendar,
  Zap,
  AlertCircle
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface DataStatus {
  totalStored: number;
  stored: Array<{ instrument: string; timeframe: string; candleCount: number }>;
  missing: Array<{ instrument: string; timeframe: string }>;
}

interface BacktestSummary {
  overallWinRate: number;
  totalTests: number;
  totalSignals: number;
  profitFactor: number;
  strategyScore: number;
  sampleSizeStatus: "insufficient" | "minimal" | "good" | "excellent";
  byInstrument: Record<string, { 
    winRate: number; 
    tests: number; 
    signals: number;
    recentWinRate?: number;
    sampleSufficient: boolean;
    confidenceAdjustment?: number;
  }>;
  byTimeframe: Record<string, { 
    winRate: number; 
    tests: number; 
    signals: number;
    recentWinRate?: number;
    sampleSufficient: boolean;
    confidenceAdjustment?: number;
  }>;
  byConfidence: {
    high: { winRate: number; count: number };
    medium: { winRate: number; count: number };
    low: { winRate: number; count: number };
  };
  byMarketRegime: {
    trending_up: { winRate: number; count: number; recommendation: string };
    trending_down: { winRate: number; count: number; recommendation: string };
    ranging: { winRate: number; count: number; recommendation: string };
    volatile: { winRate: number; count: number; recommendation: string };
  };
  recencyAnalysis: {
    recent3Months: { winRate: number; tests: number; weight: number };
    months3to12: { winRate: number; tests: number; weight: number };
    older12Months: { winRate: number; tests: number; weight: number };
    weightedWinRate: number;
  };
  confidenceAdjustments: Record<string, number>;
  recommendations: string[];
  warnings: string[];
}

interface BacktestResultEntry {
  id: string;
  instrument: string;
  timeframe: string;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
}

interface BatchBacktestResults {
  batchId: string | null;
  summary: BacktestSummary | null;
  results: BacktestResultEntry[];
}

export default function BatchBacktestPanel() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const { data: dataStatus, refetch: refetchStatus } = useQuery<DataStatus>({
    queryKey: ["/api/batch-backtest/data-status"],
  });

  const { data: backtestResults, refetch: refetchResults } = useQuery<BatchBacktestResults>({
    queryKey: ["/api/batch-backtest/results"],
  });

  const bulkDownloadMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/batch-backtest/bulk-download");
    },
    onSuccess: () => {
      refetchStatus();
    },
  });

  const runBacktestMutation = useMutation({
    mutationFn: async () => {
      // 100 tests per pair × 36 pairs = 3600 total tests for high statistical accuracy
      return await apiRequest("POST", "/api/batch-backtest/run", { testsPerPair: 100 });
    },
    onSuccess: () => {
      refetchResults();
    },
  });

  const handleBulkDownload = async () => {
    setIsDownloading(true);
    try {
      await bulkDownloadMutation.mutateAsync();
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRunBacktest = async () => {
    setIsRunning(true);
    try {
      await runBacktestMutation.mutateAsync();
    } finally {
      setIsRunning(false);
    }
  };

  const summary = backtestResults?.summary;
  const hasData = dataStatus && dataStatus.totalStored > 0;

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-green-500";
    if (score >= 50) return "text-yellow-500";
    if (score >= 30) return "text-orange-500";
    return "text-red-500";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 70) return "EXCELLENT";
    if (score >= 50) return "GOOD";
    if (score >= 30) return "MODERATE";
    return "NEEDS WORK";
  };

  const getSampleStatusColor = (status: string) => {
    if (status === "excellent") return "text-green-500";
    if (status === "good") return "text-blue-500";
    if (status === "minimal") return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Database className="h-5 w-5" />
            Strategy Validation Engine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Download historical data once, then run unlimited backtests. Recent data weighted 50%, older data 15%.
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleBulkDownload}
              disabled={isDownloading}
              variant="outline"
              size="sm"
              data-testid="button-bulk-download"
            >
              <Download className="h-4 w-4 mr-2" />
              {isDownloading ? "Downloading..." : "Download Data (36 calls)"}
            </Button>
            <Button
              onClick={handleRunBacktest}
              disabled={isRunning || !hasData}
              size="sm"
              data-testid="button-run-backtest"
            >
              <Play className="h-4 w-4 mr-2" />
              {isRunning ? "Testing..." : "Run 3600 Tests"}
            </Button>
          </div>

          {dataStatus && (
            <div className="p-3 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4" />
                Data Status: {dataStatus.totalStored}/36 datasets
              </div>
              <Progress value={(dataStatus.totalStored / 36) * 100} className="h-2" />
              {dataStatus.totalStored === 0 && (
                <div className="text-sm text-yellow-500">
                  Click Download to fetch historical data (uses 36 API credits once)
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {summary && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5" />
                Strategy Score
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <div className={`text-6xl font-bold ${getScoreColor(summary.strategyScore)}`}>
                    {summary.strategyScore}
                  </div>
                  <div className="text-lg font-medium mt-1">{getScoreLabel(summary.strategyScore)}</div>
                  <Badge className={`mt-2 ${getSampleStatusColor(summary.sampleSizeStatus)}`}>
                    Sample: {summary.sampleSizeStatus.toUpperCase()} ({summary.totalTests} tests)
                  </Badge>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className={`text-xl font-bold ${summary.recencyAnalysis.weightedWinRate >= 50 ? "text-green-500" : "text-red-500"}`}>
                    {summary.recencyAnalysis.weightedWinRate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted-foreground">Weighted Win Rate</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className={`text-xl font-bold ${summary.overallWinRate >= 50 ? "text-green-500" : "text-red-500"}`}>
                    {summary.overallWinRate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted-foreground">Raw Win Rate</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className={`text-xl font-bold ${summary.profitFactor >= 1 ? "text-green-500" : "text-red-500"}`}>
                    {summary.profitFactor.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">Profit Factor</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-xl font-bold">{summary.totalSignals}</div>
                  <div className="text-xs text-muted-foreground">Total Signals</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calendar className="h-5 w-5" />
                Recency Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground mb-3">
                Recent results weighted more heavily - strategy that works NOW matters most
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-muted/50 rounded-lg border-l-4 border-green-500">
                  <div className="text-xs font-medium text-green-500">Last 3 Months (50%)</div>
                  <div className={`text-lg font-bold ${summary.recencyAnalysis.recent3Months.winRate >= 50 ? "text-green-500" : "text-red-500"}`}>
                    {summary.recencyAnalysis.recent3Months.tests > 0 
                      ? `${summary.recencyAnalysis.recent3Months.winRate.toFixed(1)}%`
                      : "N/A"}
                  </div>
                  <div className="text-xs text-muted-foreground">{summary.recencyAnalysis.recent3Months.tests} tests</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg border-l-4 border-yellow-500">
                  <div className="text-xs font-medium text-yellow-500">3-12 Months (35%)</div>
                  <div className={`text-lg font-bold ${summary.recencyAnalysis.months3to12.winRate >= 50 ? "text-green-500" : "text-red-500"}`}>
                    {summary.recencyAnalysis.months3to12.tests > 0 
                      ? `${summary.recencyAnalysis.months3to12.winRate.toFixed(1)}%`
                      : "N/A"}
                  </div>
                  <div className="text-xs text-muted-foreground">{summary.recencyAnalysis.months3to12.tests} tests</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg border-l-4 border-gray-500">
                  <div className="text-xs font-medium text-gray-500">12+ Months (15%)</div>
                  <div className={`text-lg font-bold ${summary.recencyAnalysis.older12Months.winRate >= 50 ? "text-green-500" : "text-red-500"}`}>
                    {summary.recencyAnalysis.older12Months.tests > 0 
                      ? `${summary.recencyAnalysis.older12Months.winRate.toFixed(1)}%`
                      : "N/A"}
                  </div>
                  <div className="text-xs text-muted-foreground">{summary.recencyAnalysis.older12Months.tests} tests</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingUp className="h-5 w-5" />
                Market Conditions Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground mb-3">
                How signals perform in different market conditions
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(summary.byMarketRegime).map(([regime, stats]) => (
                  <div key={regime} className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-xs font-medium capitalize mb-1">
                      {regime.replace("_", " ")}
                    </div>
                    <div className={`text-lg font-bold ${stats.winRate >= 50 ? "text-green-500" : stats.winRate > 0 ? "text-red-500" : "text-muted-foreground"}`}>
                      {stats.count > 0 ? `${stats.winRate.toFixed(0)}%` : "N/A"}
                    </div>
                    <div className="text-xs text-muted-foreground">{stats.count} signals</div>
                    <div className="text-xs mt-1">
                      {stats.recommendation}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5" />
                Performance by Instrument
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(summary.byInstrument).map(([instrument, stats]) => (
                  <div key={instrument} className="p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-sm font-medium">{instrument}</span>
                      <Badge variant={stats.winRate >= 50 ? "default" : "destructive"}>
                        {stats.winRate.toFixed(0)}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{stats.signals} signals</span>
                      {!stats.sampleSufficient && (
                        <Badge variant="outline" className="text-yellow-500 text-xs">
                          Need more data
                        </Badge>
                      )}
                    </div>
                    {stats.confidenceAdjustment !== undefined && stats.confidenceAdjustment !== 0 && (
                      <div className={`text-xs mt-1 ${stats.confidenceAdjustment > 0 ? "text-green-500" : "text-red-500"}`}>
                        <Zap className="h-3 w-3 inline mr-1" />
                        {stats.confidenceAdjustment > 0 ? "+" : ""}{stats.confidenceAdjustment.toFixed(0)}% confidence boost
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5" />
                Performance by Timeframe
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {Object.entries(summary.byTimeframe).map(([timeframe, stats]) => (
                  <div key={timeframe} className="p-2 bg-muted/30 rounded-lg text-center">
                    <div className="text-sm font-medium">{timeframe}</div>
                    <div className={`text-lg font-bold ${stats.winRate >= 50 ? "text-green-500" : "text-red-500"}`}>
                      {stats.winRate.toFixed(0)}%
                    </div>
                    <div className="text-xs text-muted-foreground">{stats.signals} sig</div>
                    {!stats.sampleSufficient && (
                      <div className="text-xs text-yellow-500">Low data</div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {summary.warnings && summary.warnings.length > 0 && (
            <Card className="border-red-500/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg text-red-500">
                  <AlertCircle className="h-5 w-5" />
                  Warnings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {summary.warnings.map((warning, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-red-400">
                      <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      {warning}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {summary.recommendations && summary.recommendations.length > 0 && (
            <Card className="border-green-500/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg text-green-500">
                  <Target className="h-5 w-5" />
                  Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {summary.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-500" />
                      {rec}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Test Results by Pair</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {backtestResults?.results.slice(0, 30).map((result) => (
                  <div 
                    key={result.id} 
                    className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm"
                  >
                    <div className="flex items-center gap-3">
                      {result.winRate >= 50 ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="font-mono">{result.instrument}</span>
                      <Badge variant="outline" className="text-xs">{result.timeframe}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {result.wins}W / {result.losses}L
                      </span>
                      <Badge variant={result.winRate >= 50 ? "default" : "destructive"}>
                        {result.winRate.toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
