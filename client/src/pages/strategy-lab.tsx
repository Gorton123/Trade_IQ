import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain,
  Loader2,
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  BarChart3,
  Check,
  X,
  Zap,
  Clock,
  Activity,
  Pause,
  AlertTriangle,
  RefreshCw,
  CircleDot,
  Timer,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TradingStatusPanel } from "@/components/trading-status-panel";

interface StrategyParameters {
  minTrendStrength: number;
  minConfluence: number;
  slMultiplier: number;
  rrRatio: number;
  maxVolatility: string;
  requireMTFConfluence: boolean;
  minConfidence: number;
}

interface AutoProfile {
  instrument: string;
  timeframe: string;
  status: string;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  confidenceScore: number | null;
  walkForwardWinRate: number | null;
  totalSignals: number | null;
  wins: number | null;
  losses: number | null;
  lastOptimizedAt: string | null;
  optimizationCount: number | null;
  params: StrategyParameters;
}

interface OptimizationHistoryEntry {
  instrument: string;
  timeframe: string;
  trigger: string;
  paramsTested: number;
  bestWinRate: number | null;
  bestProfitFactor: number | null;
  walkForwardWinRate: number | null;
  applied: boolean;
  durationMs: number | null;
  createdAt: string;
}

interface OptimizerStatus {
  isRunning: boolean;
  currentInstrument: string | null;
  currentTimeframe: string | null;
  progress: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalProfiles: number;
  activeProfiles: number;
  pausedProfiles: number;
}

interface OptimizerStats {
  avgWinRate: number;
  avgConfidence: number;
  totalActiveInstruments: number;
  totalSignals: number;
  totalWins: number;
  totalLosses: number;
}

function getStatusIcon(status: string) {
  switch (status) {
    case "active":
      return <Check className="h-3.5 w-3.5" />;
    case "paused":
      return <Pause className="h-3.5 w-3.5" />;
    case "optimizing":
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    case "insufficient_data":
      return <AlertTriangle className="h-3.5 w-3.5" />;
    default:
      return <CircleDot className="h-3.5 w-3.5" />;
  }
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "paused":
      return "secondary";
    case "optimizing":
      return "outline";
    case "insufficient_data":
      return "destructive";
    default:
      return "secondary";
  }
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TIMEFRAME_ORDER = ["5m", "15m", "1h", "4h"];

export default function StrategyLabPage() {
  const { toast } = useToast();

  const { data: statusData, isLoading: statusLoading } = useQuery<OptimizerStatus>({
    queryKey: ["/api/auto-optimizer/status"],
    refetchInterval: 5000,
  });

  const { data: profilesData, isLoading: profilesLoading } = useQuery<{ profiles: AutoProfile[] }>({
    queryKey: ["/api/auto-optimizer/profiles"],
    refetchInterval: 10000,
  });

  const { data: statsData } = useQuery<OptimizerStats>({
    queryKey: ["/api/auto-optimizer/stats"],
    refetchInterval: 15000,
  });

  const { data: historyData } = useQuery<{ history: OptimizationHistoryEntry[] }>({
    queryKey: ["/api/auto-optimizer/history"],
    refetchInterval: 30000,
  });

  const runOptimizationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auto-optimizer/run");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auto-optimizer/status"] });
      toast({
        title: "Optimization Started",
        description: "The system is now testing all instrument+timeframe combinations. This may take a few minutes.",
      });
    },
    onError: () => {
      toast({
        title: "Failed to Start",
        description: "Could not start optimization. Please try again.",
        variant: "destructive",
      });
    },
  });

  const status = statusData;
  const profiles = profilesData?.profiles || [];
  const stats = statsData;
  const history = historyData?.history || [];

  const activeProfiles = profiles.filter(p => p.status === "active");
  const pausedProfiles = profiles.filter(p => p.status === "paused");
  const optimizingProfiles = profiles.filter(p => p.status === "optimizing");
  const insufficientProfiles = profiles.filter(p => p.status === "insufficient_data");

  const profilesByTimeframe = new Map<string, AutoProfile[]>();
  for (const profile of profiles) {
    const tf = profile.timeframe;
    if (!profilesByTimeframe.has(tf)) {
      profilesByTimeframe.set(tf, []);
    }
    profilesByTimeframe.get(tf)!.push(profile);
  }

  const isRunning = status?.isRunning || false;
  const isLoading = statusLoading || profilesLoading;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-strategy-title">
            <Brain className="h-6 w-6 text-primary" />
            Strategy Performance
          </h1>
          <p className="text-muted-foreground mt-1">
            The system automatically finds and applies winning parameters for each instrument and timeframe
          </p>
        </div>
        <Button
          onClick={() => runOptimizationMutation.mutate()}
          disabled={isRunning || runOptimizationMutation.isPending}
          data-testid="button-run-optimization"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Optimizing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Re-optimize Now
            </>
          )}
        </Button>
      </div>

      {isRunning && status && (
        <Card data-testid="card-optimization-progress">
          <CardContent className="py-4">
            <div className="flex items-center gap-3 mb-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="font-medium">
                Optimizing {status.currentInstrument} - {status.currentTimeframe}
              </span>
              <Badge variant="outline">{status.progress}%</Badge>
            </div>
            <Progress value={status.progress} className="h-2" />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-stat-win-rate">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">System Win Rate</p>
                <p className="text-2xl font-bold" data-testid="text-system-win-rate">
                  {stats?.avgWinRate ? `${stats.avgWinRate.toFixed(1)}%` : isLoading ? "..." : "N/A"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-active">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-green-500/10">
                <Activity className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Strategies</p>
                <p className="text-2xl font-bold" data-testid="text-active-count">
                  {activeProfiles.length}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    / {profiles.length}
                  </span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-confidence">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-blue-500/10">
                <Shield className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Confidence</p>
                <p className="text-2xl font-bold" data-testid="text-avg-confidence">
                  {stats?.avgConfidence ? `${stats.avgConfidence.toFixed(0)}%` : isLoading ? "..." : "N/A"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-stat-signals">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-orange-500/10">
                <Target className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Signals Tested</p>
                <p className="text-2xl font-bold" data-testid="text-signals-tested">
                  {stats?.totalSignals?.toLocaleString() || (isLoading ? "..." : "0")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <TradingStatusPanel />

      <Tabs defaultValue="instruments" className="space-y-4">
        <TabsList>
          <TabsTrigger value="instruments" data-testid="tab-instruments">
            <BarChart3 className="h-4 w-4 mr-1" />
            By Instrument
          </TabsTrigger>
          <TabsTrigger value="timeframes" data-testid="tab-timeframes">
            <Clock className="h-4 w-4 mr-1" />
            By Timeframe
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <Activity className="h-4 w-4 mr-1" />
            History
          </TabsTrigger>
          <TabsTrigger value="duration" data-testid="tab-duration">
            <Timer className="h-4 w-4 mr-1" />
            Duration Insights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="instruments" className="space-y-4">
          {profiles.length === 0 && !isLoading ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Brain className="h-12 w-12 mx-auto mb-3 opacity-50 text-muted-foreground" />
                <p className="text-lg font-medium" data-testid="text-no-profiles">
                  Optimization has not run yet
                </p>
                <p className="text-muted-foreground mt-1">
                  The system will automatically start optimizing shortly, or click "Re-optimize Now" above.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {profiles
                .sort((a, b) => {
                  const statusOrder: Record<string, number> = { active: 0, optimizing: 1, paused: 2, insufficient_data: 3 };
                  const sA = statusOrder[a.status] ?? 4;
                  const sB = statusOrder[b.status] ?? 4;
                  if (sA !== sB) return sA - sB;
                  return (b.winRate || 0) - (a.winRate || 0);
                })
                .map((profile) => (
                  <Card
                    key={`${profile.instrument}-${profile.timeframe}`}
                    data-testid={`card-profile-${profile.instrument}-${profile.timeframe}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">{profile.instrument}</CardTitle>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-xs">{profile.timeframe}</Badge>
                          <Badge variant={getStatusVariant(profile.status)} className="text-xs">
                            {getStatusIcon(profile.status)}
                            <span className="ml-1 capitalize">{profile.status.replace("_", " ")}</span>
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {profile.status === "active" && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-muted/50 rounded-md p-2.5 text-center">
                              <div className="text-lg font-bold text-green-600 dark:text-green-400" data-testid={`text-win-rate-${profile.instrument}-${profile.timeframe}`}>
                                {profile.winRate?.toFixed(1) || "0"}%
                              </div>
                              <div className="text-xs text-muted-foreground">Win Rate</div>
                            </div>
                            <div className="bg-muted/50 rounded-md p-2.5 text-center">
                              <div className="text-lg font-bold" data-testid={`text-pf-${profile.instrument}-${profile.timeframe}`}>
                                {profile.profitFactor?.toFixed(2) || "0"}
                              </div>
                              <div className="text-xs text-muted-foreground">Profit Factor</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="text-center">
                              <div className="font-medium">{profile.confidenceScore?.toFixed(0) || 0}%</div>
                              <div className="text-muted-foreground">Confidence</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium">{profile.walkForwardWinRate?.toFixed(1) || "N/A"}%</div>
                              <div className="text-muted-foreground">Walk-Forward</div>
                            </div>
                            <div className="text-center">
                              <div className="font-medium">{profile.wins || 0}W / {profile.losses || 0}L</div>
                              <div className="text-muted-foreground">Record</div>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-1">
                            <span>R:R 1:{profile.params.rrRatio.toFixed(1)}</span>
                            <span>SL {profile.params.slMultiplier.toFixed(1)}x ATR</span>
                            <span>Trend {profile.params.minTrendStrength}%</span>
                          </div>
                        </>
                      )}
                      {profile.status === "paused" && (
                        <div className="text-sm text-muted-foreground py-2">
                          <div className="flex items-center gap-2 mb-1">
                            <Pause className="h-4 w-4" />
                            <span>Below performance threshold</span>
                          </div>
                          {profile.winRate !== null && (
                            <div className="text-xs">Best win rate: {profile.winRate.toFixed(1)}%</div>
                          )}
                          <div className="text-xs mt-1">Will re-test on next optimization cycle</div>
                        </div>
                      )}
                      {profile.status === "optimizing" && (
                        <div className="text-sm text-muted-foreground py-2 flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Finding best parameters...</span>
                        </div>
                      )}
                      {profile.status === "insufficient_data" && (
                        <div className="text-sm text-muted-foreground py-2 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          <span>Not enough historical data</span>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground pt-1 border-t">
                        Optimized {formatTimeAgo(profile.lastOptimizedAt)}
                        {profile.optimizationCount ? ` (${profile.optimizationCount}x)` : ""}
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeframes" className="space-y-4">
          {TIMEFRAME_ORDER.map((tf) => {
            const tfProfiles = Array.from(profilesByTimeframe.get(tf) || []);
            const activeCount = tfProfiles.filter(p => p.status === "active").length;
            const avgWinRate = tfProfiles.filter(p => p.status === "active" && p.winRate)
              .reduce((acc, p, _, arr) => acc + (p.winRate || 0) / arr.length, 0);

            return (
              <Card key={tf} data-testid={`card-timeframe-${tf}`}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      {tf} Timeframe
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {activeCount > 0 && (
                        <Badge variant="default">
                          {activeCount} Active
                        </Badge>
                      )}
                      {avgWinRate > 0 && (
                        <Badge variant="outline" className="text-green-600 dark:text-green-400">
                          {avgWinRate.toFixed(1)}% Avg Win Rate
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {tfProfiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">No data for this timeframe yet</p>
                  ) : (
                    <div className="space-y-2">
                      {tfProfiles
                        .sort((a, b) => (b.winRate || 0) - (a.winRate || 0))
                        .map((p) => (
                          <div
                            key={`${p.instrument}-${p.timeframe}`}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 border-b last:border-0"
                            data-testid={`row-${p.instrument}-${p.timeframe}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm w-16">{p.instrument}</span>
                              <Badge variant={getStatusVariant(p.status)} className="text-xs">
                                {getStatusIcon(p.status)}
                                <span className="ml-1 capitalize">{p.status.replace("_", " ")}</span>
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 text-sm">
                              {p.status === "active" ? (
                                <>
                                  <span className="text-green-600 dark:text-green-400 font-medium">
                                    {p.winRate?.toFixed(1)}%
                                  </span>
                                  <span className="text-muted-foreground">
                                    PF {p.profitFactor?.toFixed(2)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {p.confidenceScore?.toFixed(0)}% conf
                                  </span>
                                </>
                              ) : p.status === "paused" ? (
                                <span className="text-muted-foreground text-xs">
                                  Best: {p.winRate?.toFixed(1) || "N/A"}%
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs capitalize">
                                  {p.status.replace("_", " ")}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Optimization History
              </CardTitle>
              <CardDescription>
                Recent optimization runs and their results
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p data-testid="text-no-history">No optimization runs yet</p>
                  <p className="text-sm mt-1">History will appear after the first automatic optimization cycle</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {history
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .slice(0, 50)
                    .map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 border-b last:border-0 text-sm"
                        data-testid={`history-entry-${idx}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium w-16">{entry.instrument}</span>
                          <Badge variant="outline" className="text-xs">{entry.timeframe}</Badge>
                          <Badge
                            variant={entry.applied ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {entry.applied ? (
                              <><Check className="h-3 w-3 mr-0.5" /> Applied</>
                            ) : (
                              <><X className="h-3 w-3 mr-0.5" /> Not Applied</>
                            )}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground text-xs">
                          {entry.bestWinRate !== null && (
                            <span className={entry.bestWinRate >= 55 ? "text-green-600 dark:text-green-400" : ""}>
                              {entry.bestWinRate.toFixed(1)}% WR
                            </span>
                          )}
                          {entry.walkForwardWinRate !== null && (
                            <span>WF: {entry.walkForwardWinRate.toFixed(1)}%</span>
                          )}
                          <span>{entry.paramsTested} tested</span>
                          {entry.durationMs !== null && (
                            <span>{(entry.durationMs / 1000).toFixed(1)}s</span>
                          )}
                          <Badge variant="outline" className="text-xs capitalize">
                            {entry.trigger}
                          </Badge>
                          <span>{formatTimeAgo(entry.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {status && (
            <Card data-testid="card-system-info">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-5 w-5" />
                  System Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">Last Optimization</span>
                  <span>{formatTimeAgo(status.lastRunAt)}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">Next Scheduled</span>
                  <span>{status.nextRunAt ? formatTimeAgo(status.nextRunAt) : "Pending"}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">Total Profiles</span>
                  <span>{status.totalProfiles}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">Active</span>
                  <span className="text-green-600 dark:text-green-400">{status.activeProfiles}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">Paused</span>
                  <span>{status.pausedProfiles}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="duration" className="space-y-4">
          <DurationInsightsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface DurationInsight {
  instrument: string;
  timeframe: string;
  avgDurationHours: number;
  avgWinDurationHours: number;
  avgLossDurationHours: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
}

function DurationInsightsPanel() {
  const { data, isLoading } = useQuery<{
    insights: DurationInsight[];
    timeframeLimits: Record<string, number>;
    totalAnalyzed: number;
  }>({
    queryKey: ["/api/trade-duration-insights"],
    staleTime: 60000,
  });

  const [hoveredBar, setHoveredBar] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Analyzing trade durations...</p>
        </CardContent>
      </Card>
    );
  }

  const insights = data?.insights || [];
  const timeframeLimits = data?.timeframeLimits || {};

  if (insights.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Timer className="h-12 w-12 mx-auto mb-3 opacity-50 text-muted-foreground" />
          <p className="text-lg font-medium">Not enough trade data yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Duration insights will appear after at least 3 closed trades per instrument/timeframe combination
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxDuration = Math.max(...insights.map(i => Math.max(i.avgWinDurationHours, i.avgLossDurationHours, i.avgDurationHours)));

  const formatHours = (h: number) => {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 24) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  };

  return (
    <div className="space-y-4">
      <Card data-testid="card-duration-insights">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Average Time to Close
          </CardTitle>
          <CardDescription>
            How long trades typically take to hit their target or stop — based on {data?.totalAnalyzed || 0} closed trades
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {insights.map((insight) => {
              const key = `${insight.instrument}_${insight.timeframe}`;
              const isHovered = hoveredBar === key;
              const barWidthAll = (insight.avgDurationHours / maxDuration) * 100;
              const barWidthWin = insight.avgWinDurationHours > 0 ? (insight.avgWinDurationHours / maxDuration) * 100 : 0;
              const barWidthLoss = insight.avgLossDurationHours > 0 ? (insight.avgLossDurationHours / maxDuration) * 100 : 0;
              const guardianLimit = timeframeLimits[insight.timeframe];

              return (
                <div
                  key={key}
                  className={`p-3 rounded-lg border transition-colors cursor-pointer ${isHovered ? 'bg-muted/60 border-primary/30' : 'bg-card hover:bg-muted/30'}`}
                  onMouseEnter={() => setHoveredBar(key)}
                  onMouseLeave={() => setHoveredBar(null)}
                  data-testid={`row-duration-${key}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{insight.instrument}</span>
                      <Badge variant="outline" className="text-xs">{insight.timeframe}</Badge>
                      <span className="text-xs text-muted-foreground">{insight.totalTrades} trades</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">Win rate: <span className={insight.winRate >= 60 ? 'text-green-600 font-semibold' : insight.winRate >= 50 ? 'text-yellow-600' : 'text-red-500'}>{insight.winRate.toFixed(0)}%</span></span>
                      {guardianLimit && (
                        <span className="text-muted-foreground">
                          Guardian: <span className="font-medium">{guardianLimit}h</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-12 text-muted-foreground">All</span>
                      <div className="flex-1 bg-muted/50 rounded-full h-4 relative overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded-full transition-all duration-300 flex items-center justify-end pr-1"
                          style={{ width: `${Math.max(barWidthAll, 3)}%` }}
                        >
                          <span className="text-[10px] font-medium text-primary-foreground whitespace-nowrap">
                            {formatHours(insight.avgDurationHours)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-12 text-green-600">Wins</span>
                      <div className="flex-1 bg-muted/50 rounded-full h-4 relative overflow-hidden">
                        <div
                          className="h-full bg-green-500/70 rounded-full transition-all duration-300 flex items-center justify-end pr-1"
                          style={{ width: `${Math.max(barWidthWin, 3)}%` }}
                        >
                          <span className="text-[10px] font-medium text-white whitespace-nowrap">
                            {insight.avgWinDurationHours > 0 ? formatHours(insight.avgWinDurationHours) : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-12 text-red-500">Losses</span>
                      <div className="flex-1 bg-muted/50 rounded-full h-4 relative overflow-hidden">
                        <div
                          className="h-full bg-red-500/60 rounded-full transition-all duration-300 flex items-center justify-end pr-1"
                          style={{ width: `${Math.max(barWidthLoss, 3)}%` }}
                        >
                          <span className="text-[10px] font-medium text-white whitespace-nowrap">
                            {insight.avgLossDurationHours > 0 ? formatHours(insight.avgLossDurationHours) : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isHovered && (
                    <div className="mt-2 pt-2 border-t text-xs text-muted-foreground grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <span className="block font-medium text-foreground">{insight.winningTrades}</span>
                        winning trades
                      </div>
                      <div>
                        <span className="block font-medium text-foreground">{insight.losingTrades}</span>
                        losing trades
                      </div>
                      <div>
                        <span className="block font-medium text-foreground">{formatHours(insight.avgWinDurationHours)}</span>
                        avg win time
                      </div>
                      <div>
                        <span className="block font-medium text-foreground">{formatHours(insight.avgLossDurationHours)}</span>
                        avg loss time
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Guardian Duration Limits by Timeframe
          </CardTitle>
          <CardDescription>
            The system automatically adjusts maximum trade duration based on the signal's timeframe
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(timeframeLimits).map(([tf, limit]) => (
              <div key={tf} className="p-3 rounded-lg bg-muted/50 text-center" data-testid={`card-limit-${tf}`}>
                <p className="text-lg font-bold">{limit}h</p>
                <p className="text-xs text-muted-foreground">{tf} timeframe</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
