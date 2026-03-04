import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Globe,
  Shield,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Power,
  X,
  Loader2,
  Wallet,
  Activity,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Users,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TradeChart } from "@/components/trade-chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Line,
} from "recharts";
import { InfoTooltip } from "@/components/metric-tooltip";
import type { Instrument } from "@shared/schema";

interface OandaTrade {
  id: string;
  instrument: string;
  units: number;
  direction: string;
  entryPrice: number;
  unrealizedPL: number;
  stopLoss?: number;
  takeProfit?: number;
  openTime?: string;
  timeframe?: string;
  potentialProfit?: number;
  potentialLoss?: number;
  lotSize?: number;
}

interface OandaStatusResponse {
  connected: boolean;
  environment?: string;
  account?: {
    balance: string;
    currency: string;
    unrealizedPL: string;
    openTradeCount: number;
    nav: string;
    marginUsed: string;
    marginAvailable: string;
    pl: string;
  };
  openTrades?: OandaTrade[];
  error?: string;
}

interface GuardianStatus {
  enabled: boolean;
  paused: boolean;
  maxTradeDurationHours: number;
  dailyLossLimitPercent: number;
}

function getCurrencySymbol(currency: string): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "\u20AC";
  return "\u00A3";
}

function formatDuration(openTimeStr: string): string {
  const start = new Date(openTimeStr).getTime();
  const diffMs = Date.now() - start;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function LiveAccountPage() {
  const { data: oandaStatus, isLoading } = useQuery<OandaStatusResponse>({
    queryKey: ["/api/oanda/status"],
    refetchInterval: 5000,
  });

  const { data: guardian } = useQuery<GuardianStatus>({
    queryKey: ["/api/oanda/guardian/status"],
    refetchInterval: 30000,
  });

  const connected = oandaStatus?.connected ?? false;
  const account = oandaStatus?.account;
  const trades = oandaStatus?.openTrades || [];
  const isLive = oandaStatus?.environment === "live";
  const currSymbol = account ? getCurrencySymbol(account.currency) : "£";

  const balance = account ? parseFloat(account.balance) : 0;
  const equity = account ? parseFloat(account.nav) : 0;
  const unrealizedPL = account ? parseFloat(account.unrealizedPL) : 0;
  const marginUsed = account ? parseFloat(account.marginUsed) : 0;
  const marginAvailable = account ? parseFloat(account.marginAvailable) : 0;
  const totalPL = account ? parseFloat(account.pl) : 0;
  const marginLevel = marginUsed > 0 ? ((equity / marginUsed) * 100) : 0;

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["/api/oanda/status"] });
    setTimeout(() => setRefreshing(false), 1000);
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Globe className="h-5 w-5" />
          <h1 className="text-xl font-bold">Live Account</h1>
        </div>
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">No OANDA Account Connected</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Connect your OANDA account in Settings to see your live trading dashboard.
              You can connect either a demo or live account.
            </p>
            <Button variant="outline" onClick={() => window.location.href = "/settings"} data-testid="button-go-settings">
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          <h1 className="text-xl font-bold" data-testid="text-live-title">Live Account</h1>
          {isLive ? (
            <Badge variant="destructive" className="text-xs font-bold animate-pulse" data-testid="badge-live">
              LIVE MONEY
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs" data-testid="badge-demo">
              DEMO
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {guardian?.enabled && (
            <Badge variant="outline" className="text-xs text-green-500 border-green-500/30" data-testid="badge-guardian">
              <Shield className="h-3 w-3 mr-1" />
              Guardian Active
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing} data-testid="button-refresh">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {isLive && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-center gap-3" data-testid="banner-live-warning">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-500">Real Money Trading</p>
            <p className="text-xs text-muted-foreground">
              This account uses real funds. All trades will affect your actual balance.
              Use 1-2% risk per trade for accounts under £1,000.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card data-testid="card-balance">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Balance</span>
            </div>
            <p className="text-lg font-bold font-mono" data-testid="text-balance">
              {currSymbol}{balance.toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-equity">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Equity</span>
            </div>
            <p className="text-lg font-bold font-mono" data-testid="text-equity">
              {currSymbol}{equity.toFixed(2)}
            </p>
            <p className={`text-xs font-mono ${unrealizedPL >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-unrealized-pl">
              {unrealizedPL >= 0 ? "+" : ""}{currSymbol}{unrealizedPL.toFixed(2)} open
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-margin">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Margin</span>
            </div>
            <p className="text-lg font-bold font-mono" data-testid="text-margin-used">
              {currSymbol}{marginUsed.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-margin-available">
              {currSymbol}{marginAvailable.toFixed(2)} free
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-pl">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              {totalPL >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              <span className="text-xs text-muted-foreground">Total P&L</span>
            </div>
            <p className={`text-lg font-bold font-mono ${totalPL >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-total-pl">
              {totalPL >= 0 ? "+" : ""}{currSymbol}{totalPL.toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>

      {marginUsed > 0 && (
        <Card data-testid="card-margin-level">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Margin Level</span>
              <span className={`text-sm font-bold font-mono ${marginLevel > 200 ? "text-green-500" : marginLevel > 100 ? "text-yellow-500" : "text-red-500"}`} data-testid="text-margin-level">
                {marginLevel.toFixed(0)}%
              </span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${marginLevel > 200 ? "bg-green-500" : marginLevel > 100 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(marginLevel / 5, 100)}%` }}
              />
            </div>
            {marginLevel > 0 && marginLevel < 150 && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Low margin - risk of margin call
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <AccountGrowthChart currSymbol={currSymbol} />

      <LiveTradesSection trades={trades} currSymbol={currSymbol} isLive={isLive} />

      <TeamOverview />
    </div>
  );
}

function LiveTradesSection({ trades, currSymbol, isLive }: { trades: OandaTrade[]; currSymbol: string; isLive: boolean }) {
  const [killConfirm, setKillConfirm] = useState(false);
  const [killing, setKilling] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const { toast } = useToast();
  const selectedTrade = trades.find(t => t.id === selectedTradeId);

  const killAll = async () => {
    setKilling(true);
    try {
      await apiRequest("POST", "/api/oanda/emergency-close-all");
      toast({ title: "All Trades Closed", description: "Emergency close completed" });
      queryClient.invalidateQueries({ queryKey: ["/api/oanda/status"] });
    } catch (err: any) {
      toast({ title: "Emergency Close Failed", description: err.message || "Failed to close trades", variant: "destructive" });
      console.error("Emergency close failed:", err);
    } finally {
      setKilling(false);
      setKillConfirm(false);
    }
  };

  const totalUnrealizedPL = trades.reduce((sum, t) => sum + t.unrealizedPL, 0);

  return (
    <Card data-testid="card-open-trades">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Open Trades ({trades.length})
            {trades.length > 0 && (
              <span className={`text-sm font-mono ${totalUnrealizedPL >= 0 ? "text-green-500" : "text-red-500"}`}>
                {totalUnrealizedPL >= 0 ? "+" : ""}{currSymbol}{totalUnrealizedPL.toFixed(2)}
              </span>
            )}
          </div>
          {trades.length > 0 && (
            <div>
              {killConfirm ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={killAll}
                    disabled={killing}
                    data-testid="btn-confirm-kill-all"
                  >
                    {killing ? <Loader2 className="w-3 h-3 animate-spin" /> : `CLOSE ALL ${trades.length}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setKillConfirm(false)}
                    data-testid="btn-cancel-kill-all"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setKillConfirm(true)}
                  data-testid="btn-kill-switch"
                >
                  <Power className="w-3 h-3 mr-1" />
                  Emergency Close All
                </Button>
              )}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {trades.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No open trades</p>
            <p className="text-xs">Trades opened via the scanner or manually on OANDA will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {trades.map((trade) => (
              <LiveTradeRow
                key={trade.id}
                trade={trade}
                currSymbol={currSymbol}
                isLive={isLive}
                isSelected={selectedTradeId === trade.id}
                onSelect={() => setSelectedTradeId(selectedTradeId === trade.id ? null : trade.id)}
              />
            ))}
          </div>
        )}

        {selectedTrade && (
          <div className="mt-4" data-testid="chart-selected-trade">
            <TradeChart
              instrument={selectedTrade.instrument as Instrument}
              timeframe={(selectedTrade.timeframe as any) || "15m"}
              mode="oanda-only"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiveTradeRow({
  trade,
  currSymbol,
  isLive,
  isSelected,
  onSelect,
}: {
  trade: OandaTrade;
  currSymbol: string;
  isLive: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const { toast } = useToast();
  const isMetal = trade.instrument.includes("XAU") || trade.instrument.includes("XAG");
  const instrument = trade.instrument.replace("_", "");
  const decimals = isMetal ? 2 : 5;
  const isBuy = trade.direction === "buy";
  const pnl = trade.unrealizedPL;

  const closeTrade = async () => {
    setClosing(true);
    try {
      const res = await apiRequest("POST", `/api/oanda/close/${trade.id}`);
      const data = await res.json();
      if (data.success) {
        toast({ title: "Trade Closed", description: `${instrument} closed successfully` });
      } else {
        toast({ title: "Close Failed", description: data.error || "Unknown error", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/oanda/status"] });
    } catch (err: any) {
      toast({ title: "Close Failed", description: err.message || "Failed to close trade", variant: "destructive" });
      console.error("Failed to close trade:", err);
    } finally {
      setClosing(false);
      setConfirmClose(false);
    }
  };

  return (
    <div
      className={`rounded-lg border p-3 transition-colors cursor-pointer
        ${isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
      onClick={onSelect}
      data-testid={`row-live-trade-${trade.id}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={isBuy ? "border-green-500 text-green-500" : "border-red-500 text-red-500"}>
            {isBuy ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
            {isBuy ? "BUY" : "SELL"}
          </Badge>
          <span className="font-medium">{instrument}</span>
          {trade.timeframe && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono" data-testid={`badge-timeframe-${trade.id}`}>
              {trade.timeframe}
            </Badge>
          )}
          {isLive && (
            <Badge variant="destructive" className="text-[10px] px-1 py-0">LIVE</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono font-bold ${pnl >= 0 ? "text-green-500" : "text-red-500"}`} data-testid={`text-trade-pnl-${trade.id}`}>
            {pnl >= 0 ? "+" : ""}{currSymbol}{pnl.toFixed(2)}
          </span>
          {confirmClose ? (
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <Button
                size="sm"
                variant="destructive"
                onClick={closeTrade}
                disabled={closing}
                data-testid={`btn-confirm-close-${trade.id}`}
              >
                {closing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Close"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmClose(false)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); setConfirmClose(true); }}
              data-testid={`btn-close-trade-${trade.id}`}
            >
              Close
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
        <span className="font-mono">Entry: {trade.entryPrice.toFixed(decimals)}</span>
        {trade.stopLoss && (
          <span className="font-mono text-red-400">SL: {trade.stopLoss.toFixed(decimals)}</span>
        )}
        {trade.takeProfit && (
          <span className="font-mono text-green-400">TP: {trade.takeProfit.toFixed(decimals)}</span>
        )}
        {trade.lotSize !== undefined && (
          <span className="font-mono">Lots: {trade.lotSize}</span>
        )}
        {trade.openTime && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(trade.openTime)}
          </span>
        )}
      </div>
      {(trade.potentialProfit !== undefined || trade.potentialLoss !== undefined) && (
        <div className="flex items-center gap-3 mt-1 text-xs flex-wrap" data-testid={`row-trade-pnl-targets-${trade.id}`}>
          {trade.potentialProfit !== undefined && (
            <span className="font-mono text-green-500" data-testid={`text-potential-profit-${trade.id}`}>
              <TrendingUp className="h-3 w-3 inline mr-0.5" />
              TP: +{currSymbol}{Math.abs(trade.potentialProfit).toFixed(2)}
            </span>
          )}
          {trade.potentialLoss !== undefined && (
            <span className="font-mono text-red-500" data-testid={`text-potential-loss-${trade.id}`}>
              <TrendingDown className="h-3 w-3 inline mr-0.5" />
              SL: -{currSymbol}{Math.abs(trade.potentialLoss).toFixed(2)}
            </span>
          )}
          {trade.potentialProfit !== undefined && trade.potentialLoss !== undefined && trade.potentialLoss !== 0 && (
            <span className="font-mono text-muted-foreground">
              R:R {(Math.abs(trade.potentialProfit) / Math.abs(trade.potentialLoss)).toFixed(1)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function AccountGrowthChart({ currSymbol }: { currSymbol: string }) {
  const [days, setDays] = useState("7");

  const { data, isLoading } = useQuery<{
    points: { date: string; balance: number; equity: number; unrealizedPL: number; openTrades: number }[];
    currency: string;
    startBalance: number;
    currentBalance: number;
    returnPercent: number;
    maxDrawdown: number;
  }>({
    queryKey: ["/api/oanda/balance-history", days],
    queryFn: async () => {
      const res = await fetch(`/api/oanda/balance-history?days=${days}`, { credentials: "include" });
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-account-growth">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Account Growth
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading account history...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.points || data.points.length < 2) {
    return (
      <Card data-testid="card-account-growth">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Account Growth
            </div>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="h-7 w-20 text-xs" data-testid="select-growth-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">24h</SelectItem>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-6">
          <p className="text-muted-foreground text-sm">
            No trading activity found for this period. Try selecting a longer timeframe.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.points.map((p) => ({
    ...p,
    label: new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  }));

  const isProfit = data.returnPercent >= 0;
  const cs = currSymbol || getCurrencySymbol(data.currency);

  return (
    <Card data-testid="card-account-growth">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Account Growth
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="h-7 w-20 text-xs" data-testid="select-growth-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">24h</SelectItem>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Start</div>
              <div className="text-sm font-mono" data-testid="text-growth-start">{cs}{data.startBalance.toFixed(2)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Current</div>
              <div className="text-sm font-mono" data-testid="text-growth-current">{cs}{data.currentBalance.toFixed(2)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Return</div>
              <div className={`text-sm font-mono ${isProfit ? "text-green-500" : "text-red-500"}`} data-testid="text-growth-return">
                {isProfit ? "+" : ""}{data.returnPercent}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground flex items-center gap-0.5">
                Max DD <InfoTooltip text="Largest peak-to-trough drop in account equity. Lower is better." />
              </div>
              <div className="text-sm font-mono text-red-500" data-testid="text-growth-drawdown">{data.maxDrawdown}%</div>
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64" data-testid="chart-account-growth">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="oandaEquityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isProfit ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={isProfit ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 12 }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value: number, name: string) => [
                  `${cs}${value.toFixed(2)}`,
                  name === "equity" ? "Equity" : "Balance"
                ]}
              />
              <Area type="monotone" dataKey="equity" stroke={isProfit ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"} fill="url(#oandaEquityGradient)" strokeWidth={2} name="equity" />
              <Line type="monotone" dataKey="balance" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="3 3" dot={false} name="balance" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground justify-center">
          <span className="flex items-center gap-1">
            <span className={`w-3 h-0.5 rounded ${isProfit ? "bg-green-500" : "bg-red-500"}`} />
            Equity (balance + open P&L)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-muted-foreground" style={{ borderTop: "1px dashed" }} />
            Balance (closed trades only)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

interface TeamUser {
  id: string;
  displayName: string;
  isLive: boolean;
  connectionOk: boolean;
  openTradeCount: number;
  account: {
    balance: string;
    currency: string;
    unrealizedPL: string;
    nav: string;
  } | null;
  riskPercent: number;
  guardianEnabled: boolean;
  autoExecuteEnabled: boolean;
}

function TeamOverview() {
  const { data, isLoading } = useQuery<{ users: TeamUser[] }>({
    queryKey: ["/api/oanda/users-health"],
    refetchInterval: 30000,
  });

  const users = data?.users || [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-6 w-32 mb-3" />
          <Skeleton className="h-16" />
        </CardContent>
      </Card>
    );
  }

  if (users.length === 0) return null;

  return (
    <Card data-testid="card-team-overview">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Team Overview ({users.length} connected)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {users.map((user) => {
            const cs = user.account ? getCurrencySymbol(user.account.currency) : "£";
            const balance = user.account ? parseFloat(user.account.balance) : 0;
            const upl = user.account ? parseFloat(user.account.unrealizedPL) : 0;

            return (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-muted/20 flex-wrap gap-2"
                data-testid={`row-team-user-${user.id}`}
              >
                <div className="flex items-center gap-2">
                  {user.connectionOk ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span className="font-medium text-sm">{user.displayName}</span>
                  {user.isLive ? (
                    <Badge variant="destructive" className="text-[10px] px-1 py-0">LIVE</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">DEMO</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {user.account && (
                    <>
                      <span className="font-mono">{cs}{balance.toFixed(2)}</span>
                      <span className={`font-mono ${upl >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {upl >= 0 ? "+" : ""}{cs}{upl.toFixed(2)}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">{user.openTradeCount} trades</span>
                  <span className="text-muted-foreground">{user.riskPercent}% risk</span>
                  {user.guardianEnabled && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 text-green-500 border-green-500/30">
                      <Shield className="h-2 w-2 mr-0.5" />
                      Guardian
                    </Badge>
                  )}
                  {user.autoExecuteEnabled && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0">Auto</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
