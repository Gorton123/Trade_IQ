import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Zap,
  Play,
  Square,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  Activity,
  Target,
  Shield,
  Settings2,
  BarChart3,
  Loader2,
  Wifi,
  WifiOff,
  LogIn,
  Trophy,
  Crown,
  Medal,
  FlaskConical,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Radio,
  AlertTriangle,
} from "lucide-react";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function getCurrencySymbol(currency: string): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "\u20AC";
  return "\u00A3";
}

export default function ScalperPage() {
  const { toast } = useToast();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [showSettings, setShowSettings] = useState(false);

  const { data: statusData, isLoading: statusLoading } = useQuery<any>({
    queryKey: ["/api/scalper/status"],
    refetchInterval: 2000,
    enabled: isAuthenticated,
  });

  const { data: tradesData, isLoading: tradesLoading } = useQuery<any>({
    queryKey: ["/api/scalper/trades"],
    refetchInterval: 3000,
    enabled: isAuthenticated,
  });

  const startMutation = useMutation({
    mutationFn: () => {
      const currentSettings = settings || {};
      return apiRequest("POST", "/api/scalper/start", {
        profileType: currentSettings.profileType,
        sessionFilter: currentSettings.sessionFilter,
        tradingPairs: currentSettings.tradingPairs,
        riskPercent: currentSettings.riskPercent,
        maxTradesPerHour: currentSettings.maxTradesPerHour,
        dailyLossLimit: currentSettings.dailyLossLimit,
        maxSpreadPips: currentSettings.maxSpreadPips,
        momentumThresholdPips: currentSettings.momentumThresholdPips,
        momentumWindowSeconds: currentSettings.momentumWindowSeconds,
        takeProfitPips: currentSettings.takeProfitPips,
        trailingDistancePips: currentSettings.trailingDistancePips,
        maxTradeSeconds: currentSettings.maxTradeSeconds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scalper/status"] });
      toast({ title: "Scalper Started", description: "Connecting to live price stream..." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to Start", description: err.message, variant: "destructive" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scalper/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scalper/status"] });
      toast({ title: "Scalper Stopped" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: (data: { startingBalance: number; currency: string }) =>
      apiRequest("POST", "/api/scalper/reset", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scalper/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scalper/trades"] });
      toast({ title: "Account Reset" });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiRequest("POST", "/api/scalper/settings", data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["/api/scalper/status"] });
      const previous = queryClient.getQueryData(["/api/scalper/status"]);
      queryClient.setQueryData(["/api/scalper/status"], (old: any) => {
        if (!old?.settings) return old;
        return { ...old, settings: { ...old.settings, ...data } };
      });
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scalper/status"] });
      toast({ title: "Settings Updated" });
    },
    onError: (_err: any, _data: any, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/scalper/status"], context.previous);
      }
      toast({ title: "Failed to update settings", variant: "destructive" });
    },
  });

  const stats = statusData?.stats;
  const settings = statusData?.settings;
  const trades = tradesData?.trades || [];
  const openTrades = tradesData?.openTrades || [];
  const momentum = statusData?.momentum || {};
  const activity = statusData?.activity || [];
  const session = statusData?.session;

  const isRunning = stats?.isStreaming || false;
  const streamAuthError = statusData?.streamAuthError || null;
  const totalReturn = settings ? settings.currentBalance - settings.startingBalance : 0;
  const returnPercent = settings && settings.startingBalance > 0
    ? ((totalReturn) / settings.startingBalance) * 100
    : 0;

  const profileLabel = settings?.profileType
    ? (PRESET_PROFILES as any)[settings.profileType]?.label || settings.profileType.charAt(0).toUpperCase() + settings.profileType.slice(1)
    : "Tight Swing";

  if (authLoading || statusLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <LogIn className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold" data-testid="text-login-required">Sign in required</h2>
        <p className="text-muted-foreground text-center max-w-md" data-testid="text-login-description">
          Please sign in to access the Instant Profit Trapper. Each user has their own independent scalper account and settings.
        </p>
      </div>
    );
  }

  const currSymbol = getCurrencySymbol(settings?.currency || "GBP");

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      {/* 1. Status Bar */}
      <Card data-testid="card-status-bar">
        <CardContent className="p-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <span className="relative flex h-3 w-3" data-testid="indicator-live-pulse">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                  </span>
                ) : (
                  <span className="relative flex h-3 w-3">
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-muted-foreground/40" />
                  </span>
                )}
                <Zap className="h-5 w-5 text-yellow-500" />
                <h1 className="text-lg font-bold" data-testid="text-scalper-title">
                  Instant Profit Trapper
                </h1>
              </div>
              <Badge variant={isRunning ? "default" : "secondary"} data-testid="badge-scalper-status">
                {isRunning ? "LIVE" : "OFFLINE"}
              </Badge>
              <Badge variant="outline" data-testid="badge-profile-name">{profileLabel}</Badge>
              {settings?.sessionFilter && (
                <Badge variant="outline" data-testid="badge-session-filter">Session Filter ON</Badge>
              )}
              <Badge
                variant={settings?.oandaEnabled ? (statusData?.oandaAccountType === "live" ? "destructive" : "default") : "secondary"}
                data-testid="badge-oanda-mode"
              >
                {settings?.oandaEnabled
                  ? `OANDA ${statusData?.oandaAccountType === "live" ? "LIVE" : "DEMO"}`
                  : "Paper"}
              </Badge>
              {stats?.lastTickTime && (
                <span className="text-xs text-muted-foreground" data-testid="text-last-tick">
                  Last tick: {formatRelativeTime(stats.lastTickTime)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {stats?.streamingPairs?.map((pair: string) => (
                <Badge key={pair} variant="secondary" className="text-xs" data-testid={`badge-pair-${pair}`}>
                  {pair}
                </Badge>
              ))}
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowSettings(!showSettings)}
                data-testid="button-scalper-settings"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              {isRunning ? (
                <Button
                  variant="destructive"
                  onClick={() => stopMutation.mutate()}
                  disabled={stopMutation.isPending}
                  data-testid="button-scalper-stop"
                >
                  <Square className="h-4 w-4 mr-1" />
                  Stop
                </Button>
              ) : (
                <Button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  data-testid="button-scalper-start"
                >
                  {startMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-1" />
                  )}
                  Start Scalper
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {streamAuthError && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 text-sm" data-testid="alert-stream-auth-error">
          <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-600 dark:text-yellow-400">Profit Trapper Streaming Issue</p>
            <p className="text-muted-foreground mt-1">{streamAuthError}</p>
          </div>
        </div>
      )}

      {/* Session Awareness Indicator */}
      {session && (
        <Card data-testid="card-session-info">
          <CardContent className="p-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium" data-testid="text-session-name">
                    {session.name}
                  </span>
                </div>
                <Badge
                  variant={session.isBoostWindow ? "default" : session.quality === "peak" ? "secondary" : "outline"}
                  data-testid="badge-session-quality"
                >
                  {session.isBoostWindow ? "BOOST MODE" : session.quality === "peak" ? "PEAK HOURS" : session.quality === "good" ? "Active" : "Quiet"}
                </Badge>
                {session.isBoostWindow && (
                  <span className="text-xs text-green-500 font-medium" data-testid="text-boost-info">
                    Entry threshold lowered 30%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground" data-testid="text-session-multiplier">
                  Quality: {(session.multiplier * 100).toFixed(0)}%
                </span>
                <span className="text-xs text-muted-foreground" data-testid="text-session-volatility">
                  Vol: {session.volatilityExpected}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Account Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Balance</span>
            </div>
            <p className="text-lg font-bold" data-testid="text-scalper-balance">
              {currSymbol}{settings?.currentBalance?.toFixed(2) || "0.00"}
            </p>
            <p className={`text-xs ${totalReturn >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-scalper-return">
              {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)} ({returnPercent.toFixed(1)}%)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Win Rate</span>
            </div>
            <p className="text-lg font-bold" data-testid="text-scalper-winrate">
              {stats?.winRate?.toFixed(1) || "0.0"}%
            </p>
            <p className="text-xs text-muted-foreground">
              {stats?.wins || 0}W / {stats?.losses || 0}L / {stats?.breakevens || 0}BE
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Daily P&L</span>
            </div>
            <p className={`text-lg font-bold ${(stats?.dailyPnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-scalper-daily">
              {(stats?.dailyPnl || 0) >= 0 ? "+" : ""}{currSymbol}
              {stats?.dailyPnl?.toFixed(2) || "0.00"}
            </p>
            <p className="text-xs text-muted-foreground">
              {stats?.tradesThisHour || 0} trades this hour
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              {isRunning ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-xs text-muted-foreground">Stream</span>
            </div>
            <p className="text-lg font-bold" data-testid="text-scalper-stream-status">
              {isRunning ? "Connected" : "Disconnected"}
            </p>
            <p className="text-xs text-muted-foreground">
              {stats?.streamingPairs?.join(", ") || "No pairs"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 3. Settings Panel */}
      {showSettings && settings && (
        <SettingsPanel
          settings={settings}
          onUpdate={(updates) => updateSettingsMutation.mutate(updates)}
          onReset={(balance, currency) => resetMutation.mutate({ startingBalance: balance, currency })}
          isPending={updateSettingsMutation.isPending || resetMutation.isPending}
          oandaAccountType={statusData?.oandaAccountType ?? null}
        />
      )}

      {/* 4. Momentum Dashboard + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MomentumDashboard momentum={momentum} isRunning={isRunning} />
        <ActivityFeed activity={activity} />
      </div>

      {/* 5. Open Trades */}
      {openTrades.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4" />
              Open Trades ({openTrades.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="space-y-2">
              {openTrades.map((trade: any) => (
                <OpenTradeRow key={trade.id} trade={trade} currency={settings?.currency || "GBP"} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6. Auto-Optimization Status */}
      {isAuthenticated && (
        <OptimizationStatus optimization={statusData?.optimization} isRunning={isRunning} />
      )}

      {/* 7. Recent Trades */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Recent Trades ({stats?.totalTrades || 0} total)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {trades.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No trades yet. Start the scalper to begin trading.</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {trades.filter((t: any) => t.status === "closed").slice(0, 30).map((trade: any) => (
                <TradeRow key={trade.id} trade={trade} currency={settings?.currency || "GBP"} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 8. Performance Metrics */}
      {(stats?.totalTrades || 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Total Trades</p>
                <p className="font-bold" data-testid="text-scalper-total-trades">{stats?.totalTrades || 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total P&L (pips)</p>
                <p className={`font-bold ${(stats?.totalPnlPips || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {(stats?.totalPnlPips || 0) >= 0 ? "+" : ""}{stats?.totalPnlPips?.toFixed(1) || "0.0"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Avg Win</p>
                <p className="font-bold text-green-500">+{stats?.avgWinPips?.toFixed(1) || "0.0"} pips</p>
              </div>
              <div>
                <p className="text-muted-foreground">Avg Loss</p>
                <p className="font-bold text-red-500">-{stats?.avgLossPips?.toFixed(1) || "0.0"} pips</p>
              </div>
              <div>
                <p className="text-muted-foreground">Max Drawdown</p>
                <p className="font-bold">{settings?.maxDrawdown?.toFixed(1) || "0.0"}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total P&L</p>
                <p className={`font-bold ${(stats?.totalPnlMoney || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {(stats?.totalPnlMoney || 0) >= 0 ? "+" : ""}{currSymbol}{stats?.totalPnlMoney?.toFixed(2) || "0.00"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Peak Balance</p>
                <p className="font-bold">
                  {currSymbol}{settings?.peakBalance?.toFixed(2) || "0.00"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Open Trades</p>
                <p className="font-bold">{stats?.openTrades || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 9. Leaderboard */}
      <ScalperLeaderboard />
    </div>
  );
}

function MomentumDashboard({ momentum, isRunning }: { momentum: Record<string, any>; isRunning: boolean }) {
  const pairs = Object.entries(momentum);

  return (
    <Card data-testid="card-momentum-dashboard">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Radio className="h-4 w-4" />
          Live Momentum
          {isRunning && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        {pairs.length === 0 ? (
          <div className="text-center text-muted-foreground py-4">
            <Radio className="h-6 w-6 mx-auto mb-2 opacity-30" />
            <p className="text-xs">{isRunning ? "Waiting for momentum data..." : "Start the scalper to see live momentum."}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pairs.map(([pair, data]) => {
              const pct = data.threshold > 0 ? Math.min((data.movePips / data.threshold) * 100, 100) : 0;
              const isNearTrigger = pct >= 75;
              return (
                <div key={pair} className="space-y-1" data-testid={`momentum-pair-${pair}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-mono font-medium" data-testid={`momentum-name-${pair}`}>{pair}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground" data-testid={`momentum-spread-${pair}`}>
                        Spread: {data.spread?.toFixed(1)}p
                      </span>
                      <span className="text-xs text-muted-foreground" data-testid={`momentum-consistency-${pair}`}>
                        {data.consistency}%
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={pct}
                      className={`h-2 flex-1 ${isNearTrigger ? "[&>div]:bg-yellow-500" : ""}`}
                      data-testid={`momentum-bar-${pair}`}
                    />
                    <span className={`text-xs font-mono min-w-[80px] text-right ${isNearTrigger ? "text-yellow-500 font-medium" : "text-muted-foreground"}`} data-testid={`momentum-value-${pair}`}>
                      {data.movePips?.toFixed(1)} / {data.threshold?.toFixed(1)}p
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityFeed({ activity }: { activity: any[] }) {
  const typeStyles: Record<string, string> = {
    entry: "text-blue-500 dark:text-blue-400",
    win: "text-green-500",
    loss: "text-red-500",
    breakeven: "text-muted-foreground",
    near_miss: "text-yellow-500 dark:text-yellow-400",
    rejected: "text-muted-foreground/70",
    blocked: "text-orange-500 dark:text-orange-400",
  };

  const typeIcons: Record<string, typeof Activity> = {
    entry: TrendingUp,
    win: CheckCircle2,
    loss: XCircle,
    breakeven: MinusCircle,
    near_miss: AlertTriangle,
    rejected: XCircle,
    blocked: AlertTriangle,
  };

  return (
    <Card data-testid="card-activity-feed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Activity Feed
          {activity.length > 0 && (
            <Badge variant="secondary" className="text-xs">{activity.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        {activity.length === 0 ? (
          <div className="text-center text-muted-foreground py-4">
            <Activity className="h-6 w-6 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No activity yet. Events will appear here when the scalper is running.</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-[280px] overflow-y-auto">
            {activity.map((item: any, idx: number) => {
              const colorClass = typeStyles[item.type] || "text-muted-foreground";
              const IconComp = typeIcons[item.type] || Activity;
              return (
                <div
                  key={idx}
                  className="flex items-start gap-2 py-1.5 text-xs"
                  data-testid={`activity-item-${idx}`}
                >
                  <IconComp className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${colorClass}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`${colorClass} leading-snug`} data-testid={`activity-message-${idx}`}>
                      {item.message}
                    </p>
                  </div>
                  <span className="text-muted-foreground shrink-0 tabular-nums" data-testid={`activity-time-${idx}`}>
                    {item.time ? formatRelativeTime(item.time) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OptimizationStatus({ optimization, isRunning }: { optimization: any; isRunning: boolean }) {
  if (!optimization) {
    return (
      <Card data-testid="card-optimization">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Auto-Optimizer
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">
            {isRunning ? "Optimization data loading..." : "Start the scalper to auto-optimize settings. The system will test all profiles, select the best one, and remove unprofitable pairs automatically."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const confidenceColor = optimization.confidence >= 70 ? "text-green-500" : optimization.confidence >= 40 ? "text-yellow-500" : "text-red-500";
  const profileLabel = optimization.selectedProfile ? optimization.selectedProfile.charAt(0).toUpperCase() + optimization.selectedProfile.slice(1) : "None";
  const lastOpt = optimization.lastOptimizedAt ? new Date(optimization.lastOptimizedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "Never";
  const nextOpt = optimization.nextOptimizationAt ? new Date(optimization.nextOptimizationAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "-";

  return (
    <Card data-testid="card-optimization">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Auto-Optimizer
            {optimization.status === "optimizing" && (
              <Badge variant="secondary" data-testid="badge-opt-optimizing">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {optimization.progress || "Optimizing..."}
              </Badge>
            )}
            {optimization.status === "ready" && (
              <Badge variant="default" data-testid="badge-opt-ready">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Ready
              </Badge>
            )}
            {optimization.status === "error" && (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Error
              </Badge>
            )}
          </div>
          {optimization.consecutiveLosses >= 2 && (
            <Badge variant="outline" className="text-yellow-500 border-yellow-500/30">
              {optimization.consecutiveLosses} losses in a row
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-xs text-muted-foreground">Active Profile</p>
            <p className="text-sm font-bold" data-testid="text-opt-profile">{profileLabel}</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className={`text-sm font-bold ${confidenceColor}`} data-testid="text-opt-confidence">{optimization.confidence}%</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-xs text-muted-foreground">Last Optimized</p>
            <p className="text-sm font-bold" data-testid="text-opt-last">{lastOpt}</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-xs text-muted-foreground">Next Check</p>
            <p className="text-sm font-bold" data-testid="text-opt-next">{nextOpt}</p>
          </div>
        </div>

        {optimization.includedPairs?.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Trading:</span>
            {optimization.includedPairs.map((pair: string) => (
              <Badge key={pair} variant="outline" className="text-xs" data-testid={`badge-included-${pair}`}>
                <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                {pair}
              </Badge>
            ))}
          </div>
        )}

        {optimization.excludedPairs?.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Excluded:</span>
            {optimization.excludedPairs.map((ep: any) => (
              <div key={ep.pair} className="flex items-center gap-2 flex-wrap" data-testid={`excluded-row-${ep.pair}`}>
                <Badge variant="outline" className="text-xs text-muted-foreground" data-testid={`badge-excluded-${ep.pair}`}>
                  <XCircle className="h-3 w-3 mr-1 text-red-500" />
                  {ep.pair}
                </Badge>
                <span className="text-xs text-muted-foreground" data-testid={`text-excluded-reason-${ep.pair}`}>{ep.reason}</span>
              </div>
            ))}
          </div>
        )}

        {optimization.profileResults?.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Profile Comparison</p>
            {optimization.profileResults.map((pr: any) => {
              const isSelected = pr.profile === optimization.selectedProfile;
              return (
                <div
                  key={pr.profile}
                  className={`flex items-center justify-between text-xs py-1 px-2 rounded-md ${isSelected ? "bg-primary/5 border border-primary/20" : ""}`}
                  data-testid={`opt-profile-${pr.profile}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize w-20">{pr.profile}</span>
                    {isSelected && <Badge variant="default" className="text-[9px] px-1 py-0">Selected</Badge>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{pr.trades} trades</span>
                    <span className={pr.winRate >= 50 ? "text-green-500" : pr.winRate >= 40 ? "text-yellow-500" : "text-red-500"}>
                      {pr.winRate}% WR
                    </span>
                    <span className={`font-mono ${pr.pnlPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {pr.pnlPips >= 0 ? "+" : ""}{pr.pnlPips}p
                    </span>
                    <span className={`font-mono ${pr.profitFactor >= 1 ? "text-green-500" : "text-red-500"}`}>
                      PF {pr.profitFactor}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {optimization.totalReoptimizations > 0 && (
          <p className="text-xs text-muted-foreground">
            Re-optimized {optimization.totalReoptimizations} time{optimization.totalReoptimizations !== 1 ? "s" : ""} this session
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ScalperLeaderboard() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/scalper/leaderboard"],
    refetchInterval: 60000,
  });

  function getRankIcon(rank: number) {
    if (rank === 1) return <Crown className="h-4 w-4 text-yellow-500" />;
    if (rank === 2) return <Medal className="h-4 w-4 text-gray-400" />;
    if (rank === 3) return <Medal className="h-4 w-4 text-amber-600" />;
    return <span className="text-xs font-medium text-muted-foreground w-4 text-center">{rank}</span>;
  }

  if (isLoading) {
    return (
      <Card data-testid="card-scalper-leaderboard">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Scalper Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16 ml-auto" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const entries = data?.leaderboard || [];
  const stats = data?.systemStats;

  return (
    <Card data-testid="card-scalper-leaderboard">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy className="h-4 w-4" />
          Scalper Leaderboard
          {stats && (
            <Badge variant="outline" className="ml-auto text-xs">
              {stats.totalScalpers} scalpers / {stats.totalTrades} trades
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <div className="text-center text-muted-foreground py-6">
            <Trophy className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No scalpers on the leaderboard yet.</p>
            <p className="text-xs">Complete some scalper trades to appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-scalper-leaderboard">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-1 px-1 w-6">#</th>
                  <th className="text-left py-1 px-1">Trader</th>
                  <th className="text-right py-1 px-1 whitespace-nowrap">Win%</th>
                  <th className="text-right py-1 px-1 whitespace-nowrap">Pips</th>
                  <th className="text-right py-1 px-1 whitespace-nowrap">Return</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry: any) => (
                  <tr
                    key={entry.odId || entry.rank}
                    data-testid={`scalper-lb-row-${entry.rank}`}
                    className={`${entry.isCurrentUser ? "bg-primary/5 outline outline-1 outline-primary/20" : ""}`}
                  >
                    <td className="py-1.5 px-1 text-center align-middle">
                      {getRankIcon(entry.rank)}
                    </td>
                    <td className="py-1.5 px-1 align-middle">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Avatar className="h-5 w-5 shrink-0">
                          {entry.profileImage && <AvatarImage src={entry.profileImage} alt={entry.displayName} />}
                          <AvatarFallback className="text-[9px]">
                            {entry.displayName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium truncate">
                          {entry.displayName}
                          {entry.isCurrentUser && (
                            <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0">You</Badge>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className={`text-right py-1.5 px-1 align-middle ${entry.winRate >= 50 ? "text-green-500" : "text-red-500"}`}>
                      {entry.winRate}%
                    </td>
                    <td className={`text-right py-1.5 px-1 align-middle ${entry.totalPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {entry.totalPips >= 0 ? "+" : ""}{entry.totalPips.toFixed(0)}
                    </td>
                    <td className={`text-right py-1.5 px-1 align-middle font-medium ${entry.returnPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {entry.returnPct >= 0 ? "+" : ""}{entry.returnPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpenTradeRow({ trade, currency }: { trade: any; currency: string }) {
  const currSymbol = getCurrencySymbol(currency);
  const ageSeconds = Math.floor((Date.now() - new Date(trade.openedAt).getTime()) / 1000);

  return (
    <div className="flex items-center justify-between text-sm bg-muted/50 rounded-md p-2" data-testid={`scalper-open-trade-${trade.id}`}>
      <div className="flex items-center gap-2">
        {trade.direction === "buy" ? (
          <TrendingUp className="h-3 w-3 text-green-500" />
        ) : (
          <TrendingDown className="h-3 w-3 text-red-500" />
        )}
        <span className="font-mono font-medium">{trade.instrument}</span>
        <Badge variant="outline" className="text-xs">
          {trade.direction.toUpperCase()}
        </Badge>
      </div>
      <div className="flex items-center gap-3">
        {trade.breakEvenApplied && (
          <Badge variant="secondary" className="text-xs">
            <Shield className="h-3 w-3 mr-1" />
            BE
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">{ageSeconds}s</span>
        <span className="font-mono text-xs">{trade.entryPrice?.toFixed(5)}</span>
      </div>
    </div>
  );
}

function TradeRow({ trade, currency }: { trade: any; currency: string }) {
  const currSymbol = getCurrencySymbol(currency);
  const isWin = (trade.pnlPips || 0) > 0.1;
  const isLoss = (trade.pnlPips || 0) < -0.1;
  const closedDate = new Date(trade.closedAt || trade.openedAt);
  const time = closedDate.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateStr = closedDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });

  const exitReasonLabel = trade.exitReason
    ? trade.exitReason.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
    : "";

  return (
    <div
      className="flex items-center justify-between gap-2 text-xs py-1.5 pl-3 pr-2 rounded-md relative"
      data-testid={`scalper-trade-${trade.id}`}
      style={{
        borderLeft: `3px solid ${isWin ? "var(--color-green-500, #22c55e)" : isLoss ? "var(--color-red-500, #ef4444)" : "var(--color-muted-foreground, #a1a1aa)"}`,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {trade.direction === "buy" ? (
          <TrendingUp className="h-3 w-3 text-green-500" />
        ) : (
          <TrendingDown className="h-3 w-3 text-red-500" />
        )}
        <span className="font-mono">{trade.instrument}</span>
        <span className="text-muted-foreground">{dateStr} {time}</span>
        {exitReasonLabel && (
          <Badge variant={isWin ? "secondary" : isLoss ? "destructive" : "outline"} className="text-[10px]" data-testid={`badge-exit-${trade.id}`}>
            {exitReasonLabel}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className={`font-mono font-medium ${isWin ? "text-green-500" : isLoss ? "text-red-500" : "text-muted-foreground"}`}>
          {(trade.pnlPips || 0) > 0 ? "+" : ""}{trade.pnlPips?.toFixed(1) || "0.0"} pips
        </span>
        <span className={`font-mono font-medium min-w-[60px] text-right ${isWin ? "text-green-500" : isLoss ? "text-red-500" : "text-muted-foreground"}`}>
          {(trade.pnlMoney || 0) > 0 ? "+" : ""}{currSymbol}{trade.pnlMoney?.toFixed(2) || "0.00"}
        </span>
      </div>
    </div>
  );
}

const ALL_SCALPER_PAIRS = ["XAUUSD", "XAGUSD"];

const PRESET_PROFILES = {
  tight_swing: {
    label: "Tight Swing",
    description: "Best performer. 5-min momentum window, 15-pip targets on metals. Backtested 66.5% win rate on gold.",
    riskReward: "~1.9:1 R:R",
    estWinRate: "60-67%",
    values: {
      riskPercent: 1.0,
      maxTradesPerHour: 10,
      dailyLossLimit: 30,
      maxSpreadPips: 5.0,
      momentumThresholdPips: 6.0,
      momentumWindowSeconds: 300,
      takeProfitPips: 15,
      trailingDistancePips: 4.0,
      maxTradeSeconds: 600,
      tradingPairs: ["XAUUSD", "XAGUSD"],
      profileType: "tight_swing",
    },
  },
  conservative: {
    label: "Conservative",
    description: "Larger momentum bursts, wider targets. Fewer but higher-conviction entries on metals.",
    riskReward: "~2:1 R:R",
    estWinRate: "55-61%",
    values: {
      riskPercent: 1.0,
      maxTradesPerHour: 6,
      dailyLossLimit: 25,
      maxSpreadPips: 5.0,
      momentumThresholdPips: 8.0,
      momentumWindowSeconds: 600,
      takeProfitPips: 30,
      trailingDistancePips: 7.5,
      maxTradeSeconds: 1800,
      tradingPairs: ["XAUUSD", "XAGUSD"],
      profileType: "conservative",
    },
  },
  balanced: {
    label: "Balanced",
    description: "Mid-range targets with 5-min momentum detection. Good balance of frequency and quality.",
    riskReward: "~2.1:1 R:R",
    estWinRate: "55-60%",
    values: {
      riskPercent: 1.0,
      maxTradesPerHour: 8,
      dailyLossLimit: 30,
      maxSpreadPips: 5.0,
      momentumThresholdPips: 5.0,
      momentumWindowSeconds: 300,
      takeProfitPips: 25,
      trailingDistancePips: 6.0,
      maxTradeSeconds: 1200,
      tradingPairs: ["XAUUSD", "XAGUSD"],
      profileType: "balanced",
    },
  },
  aggressive: {
    label: "Aggressive",
    description: "Faster 3-min momentum window, more frequent entries. Higher volume, slightly lower win rate.",
    riskReward: "~2:1 R:R",
    estWinRate: "50-58%",
    values: {
      riskPercent: 1.5,
      maxTradesPerHour: 12,
      dailyLossLimit: 40,
      maxSpreadPips: 6.0,
      momentumThresholdPips: 3.0,
      momentumWindowSeconds: 180,
      takeProfitPips: 20,
      trailingDistancePips: 5.0,
      maxTradeSeconds: 900,
      tradingPairs: ["XAUUSD", "XAGUSD"],
      profileType: "aggressive",
    },
  },
} as const;

type ProfileKey = keyof typeof PRESET_PROFILES;

function SettingsPanel({
  settings,
  onUpdate,
  onReset,
  isPending,
  oandaAccountType,
}: {
  settings: any;
  onUpdate: (updates: Record<string, any>) => void;
  onReset: (balance: number, currency: string) => void;
  isPending: boolean;
  oandaAccountType: string | null;
}) {
  const [resetBalance, setResetBalance] = useState(settings.startingBalance?.toString() || "500");
  const [resetCurrency, setResetCurrency] = useState(settings.currency || "GBP");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const currentProfile = (settings.profileType || "balanced") as ProfileKey | "custom";

  const selectProfile = (key: ProfileKey) => {
    const profileValues = { ...PRESET_PROFILES[key].values };
    const currentPairs = settings.tradingPairs;
    if (currentPairs && currentPairs.length > 0) {
      (profileValues as any).tradingPairs = currentPairs;
    }
    onUpdate(profileValues);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Trading Style
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(Object.entries(PRESET_PROFILES) as [ProfileKey, typeof PRESET_PROFILES[ProfileKey]][]).map(([key, profile]) => (
            <button
              key={key}
              type="button"
              onClick={() => selectProfile(key)}
              disabled={isPending}
              className={`text-left p-3 rounded-md border-2 transition-colors ${
                currentProfile === key
                  ? "border-primary bg-primary/5"
                  : "border-border hover-elevate"
              }`}
              data-testid={`button-profile-${key}`}
            >
              <div className="flex items-center justify-between mb-1 gap-1">
                <span className="font-semibold text-sm">{profile.label}</span>
                {currentProfile === key && (
                  <Badge variant="default" className="text-xs">Active</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-2">{profile.description}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">{profile.riskReward}</Badge>
                <Badge variant="outline" className="text-xs">{profile.estWinRate} WR</Badge>
              </div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={settings.sessionFilter}
            onCheckedChange={(checked) => onUpdate({ sessionFilter: checked })}
            data-testid="switch-scalper-session-filter"
          />
          <Label className="text-xs">London/NY Session Filter (7am-9pm UTC)</Label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-medium">Execution Mode</Label>
            {settings.oandaEnabled ? (
              <Badge variant={oandaAccountType === "live" ? "destructive" : "default"} className="text-xs">
                OANDA {oandaAccountType === "live" ? "LIVE" : "DEMO"}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">PAPER</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={settings.oandaEnabled ?? false}
              onCheckedChange={(checked) => onUpdate({ oandaEnabled: checked })}
              disabled={!oandaAccountType}
              data-testid="switch-scalper-oanda"
            />
            <Label className="text-xs">
              {!oandaAccountType
                ? "Connect OANDA account in Settings to enable"
                : settings.oandaEnabled
                  ? `Trades execute on OANDA ${oandaAccountType === "live" ? "Live" : "Demo"} account`
                  : "Paper trading only (no real orders)"}
            </Label>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs font-medium">Trading Pairs</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {!settings.tradingPairs || settings.tradingPairs.length === 0
              ? "No pairs selected"
              : `Active: ${settings.tradingPairs.join(', ')}`}
          </p>
          <div className="flex flex-wrap gap-2">
            {ALL_SCALPER_PAIRS.map((pair: string) => {
              const isActive = settings.tradingPairs?.includes(pair) ?? false;
              return (
                <Button
                  key={pair}
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className={`toggle-elevate ${isActive ? "toggle-elevated" : ""}`}
                  onClick={() => {
                    const current = settings.tradingPairs || [];
                    let updated: string[];
                    if (current.includes(pair)) {
                      updated = current.filter((p: string) => p !== pair);
                    } else {
                      updated = [...current, pair];
                    }
                    if (updated.length === 0) updated = [pair];
                    onUpdate({ tradingPairs: updated, profileType: "custom" });
                  }}
                  disabled={isPending || (settings.tradingPairs?.length === 1 && settings.tradingPairs.includes(pair))}
                  data-testid={`button-scalper-pair-${pair.toLowerCase()}`}
                >
                  {pair}
                </Button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          data-testid="button-advanced-toggle"
        >
          <Settings2 className="h-3 w-3" />
          {showAdvanced ? "Hide advanced settings" : "Customize settings manually"}
        </button>

        {showAdvanced && (
          <div className="border-t pt-3 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Risk Per Trade (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  defaultValue={settings.riskPercent}
                  onBlur={(e) => onUpdate({ riskPercent: parseFloat(e.target.value) || 0.5, profileType: "custom" })}
                  data-testid="input-scalper-risk"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Trades/Hour</Label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={settings.maxTradesPerHour}
                  onBlur={(e) => onUpdate({ maxTradesPerHour: parseInt(e.target.value) || 25, profileType: "custom" })}
                  data-testid="input-scalper-max-trades"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Daily Loss Limit ({settings.currency})</Label>
                <Input
                  type="number"
                  min="1"
                  max="500"
                  defaultValue={settings.dailyLossLimit}
                  onBlur={(e) => onUpdate({ dailyLossLimit: parseFloat(e.target.value) || 25, profileType: "custom" })}
                  data-testid="input-scalper-daily-limit"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Spread (pips)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="10"
                  defaultValue={settings.maxSpreadPips}
                  onBlur={(e) => onUpdate({ maxSpreadPips: parseFloat(e.target.value) || 2, profileType: "custom" })}
                  data-testid="input-scalper-max-spread"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Momentum Threshold (pips)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="1"
                  max="20"
                  defaultValue={settings.momentumThresholdPips}
                  onBlur={(e) => onUpdate({ momentumThresholdPips: parseFloat(e.target.value) || 3, profileType: "custom" })}
                  data-testid="input-scalper-momentum"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Momentum Window (seconds)</Label>
                <Input
                  type="number"
                  min="2"
                  max="30"
                  defaultValue={settings.momentumWindowSeconds}
                  onBlur={(e) => onUpdate({ momentumWindowSeconds: parseInt(e.target.value) || 5, profileType: "custom" })}
                  data-testid="input-scalper-window"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Take Profit (pips)</Label>
                <Input
                  type="number"
                  step="1"
                  min="2"
                  max="50"
                  defaultValue={settings.takeProfitPips}
                  onBlur={(e) => onUpdate({ takeProfitPips: parseFloat(e.target.value) || 8, profileType: "custom" })}
                  data-testid="input-scalper-tp"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Trailing Distance (pips)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="1"
                  max="20"
                  defaultValue={settings.trailingDistancePips}
                  onBlur={(e) => onUpdate({ trailingDistancePips: parseFloat(e.target.value) || 3, profileType: "custom" })}
                  data-testid="input-scalper-trailing"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Trade Duration (seconds)</Label>
                <Input
                  type="number"
                  min="10"
                  max="300"
                  defaultValue={settings.maxTradeSeconds}
                  onBlur={(e) => onUpdate({ maxTradeSeconds: parseInt(e.target.value) || 60, profileType: "custom" })}
                  data-testid="input-scalper-max-duration"
                />
              </div>
            </div>
          </div>
        )}

        <div className="border-t pt-3 mt-3">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Reset Account</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="number"
              className="w-24"
              value={resetBalance}
              onChange={(e) => setResetBalance(e.target.value)}
              data-testid="input-scalper-reset-balance"
            />
            <Select value={resetCurrency} onValueChange={setResetCurrency}>
              <SelectTrigger className="w-20" data-testid="select-scalper-reset-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GBP">GBP</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onReset(parseFloat(resetBalance) || 500, resetCurrency)}
              disabled={isPending}
              data-testid="button-scalper-reset"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
