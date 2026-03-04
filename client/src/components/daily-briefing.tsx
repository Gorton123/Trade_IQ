import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Shield,
  Wallet,
  Target,
  AlertTriangle,
  Zap,
  ArrowRight,
  Trophy,
  BarChart3,
  CircleDot,
} from "lucide-react";

interface DailyBriefingProps {
  open: boolean;
  onDismiss: () => void;
  displayName?: string;
}

export function DailyBriefing({ open, onDismiss, displayName }: DailyBriefingProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/daily-briefing"],
    enabled: open,
    staleTime: 30000,
  });

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const formatCurrency = (amount: number, currency = "GBP") => {
    const symbol = currency === "GBP" ? "\u00a3" : currency === "USD" ? "$" : currency;
    return `${symbol}${Math.abs(amount).toFixed(2)}`;
  };

  const pnlColor = (val: number) =>
    val > 0 ? "text-emerald-500" : val < 0 ? "text-red-500" : "text-muted-foreground";

  const pnlSign = (val: number) => (val > 0 ? "+" : "");

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto p-0 gap-0" data-testid="dialog-daily-briefing">
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold" data-testid="text-briefing-title">
              {greeting()}, {displayName || "Trader"}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground" data-testid="text-briefing-date">
              {new Date().toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </DialogDescription>
          </DialogHeader>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Activity className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : data ? (
          <div className="p-6 pt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card className="p-4 space-y-2" data-testid="card-paper-account">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  Paper Account
                </div>
                <div className="text-2xl font-bold" data-testid="text-paper-balance">
                  {formatCurrency(data.paper.balance, data.paper.currency)}
                </div>
                <div className="flex items-center gap-1.5">
                  {data.paper.totalReturn >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${pnlColor(data.paper.totalReturn)}`} data-testid="text-paper-total-return">
                    {pnlSign(data.paper.totalReturnPercent)}{data.paper.totalReturnPercent.toFixed(1)}% all time
                  </span>
                </div>
                <div className="pt-1 border-t border-border/50">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Today</span>
                    <span className={`font-medium ${pnlColor(data.paper.dailyPnl)}`} data-testid="text-paper-daily-pnl">
                      {pnlSign(data.paper.dailyPnl)}{formatCurrency(data.paper.dailyPnl, data.paper.currency)}
                      {" "}({pnlSign(data.paper.dailyPnlPips)}{data.paper.dailyPnlPips} pips)
                    </span>
                  </div>
                </div>
              </Card>

              {data.oanda?.connected ? (
                <Card className="p-4 space-y-2" data-testid="card-oanda-account">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <BarChart3 className="h-4 w-4" />
                    OANDA {data.oanda.environment === "live" ? (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-600">LIVE</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">DEMO</Badge>
                    )}
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-oanda-balance">
                    {formatCurrency(data.oanda.balance, data.oanda.currency)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm ${pnlColor(data.oanda.unrealizedPL)}`} data-testid="text-oanda-unrealized">
                      {pnlSign(data.oanda.unrealizedPL)}{formatCurrency(data.oanda.unrealizedPL, data.oanda.currency)} unrealized
                    </span>
                  </div>
                  <div className="pt-1 border-t border-border/50">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Open trades</span>
                      <span className="font-medium" data-testid="text-oanda-open-trades">{data.oanda.openTradeCount}</span>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="p-4 flex flex-col items-center justify-center text-center space-y-2 border-dashed" data-testid="card-oanda-disconnected">
                  <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Connect OANDA in Settings for live/demo trading
                  </p>
                </Card>
              )}
            </div>

            {(data.paper.todayTrades > 0 || (data.paper.openPositions > 0)) && (
              <Card className="p-4 space-y-3" data-testid="card-today-activity">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Target className="h-4 w-4 text-primary" />
                  Today's Activity
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="text-lg font-bold" data-testid="text-today-trades">{data.paper.todayTrades}</div>
                    <div className="text-[10px] text-muted-foreground">Trades</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-emerald-500" data-testid="text-today-wins">{data.paper.wins}</div>
                    <div className="text-[10px] text-muted-foreground">Wins</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-red-500" data-testid="text-today-losses">{data.paper.losses}</div>
                    <div className="text-[10px] text-muted-foreground">Losses</div>
                  </div>
                  <div>
                    <div className={`text-lg font-bold ${pnlColor(data.paper.dailyPnlPips)}`} data-testid="text-today-pips">
                      {pnlSign(data.paper.dailyPnlPips)}{data.paper.dailyPnlPips}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Pips</div>
                  </div>
                </div>
                {data.paper.todayTrades > 0 && (
                  <div className="flex justify-between text-xs pt-1 border-t border-border/50">
                    <span className="text-muted-foreground">Win rate</span>
                    <span className="font-medium" data-testid="text-today-winrate">
                      {data.paper.todayTrades > 0
                        ? ((data.paper.wins / data.paper.todayTrades) * 100).toFixed(0)
                        : 0}%
                    </span>
                  </div>
                )}
              </Card>
            )}

            {data.paper.openPositions > 0 && (
              <Card className="p-4" data-testid="card-open-positions">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CircleDot className="h-4 w-4 text-amber-500" />
                    Open Positions
                  </div>
                  <Badge variant="outline" className="text-xs" data-testid="text-open-count">
                    {data.paper.openPositions} active
                  </Badge>
                </div>
              </Card>
            )}

            {(data.risk.isLimitReached || data.risk.isConsecutiveLockout || data.risk.consecutiveLosses >= 2) && (
              <Card className="p-4 border-amber-500/30 bg-amber-500/5" data-testid="card-risk-alert">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  Risk Alert
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {data.risk.isLimitReached && (
                    <p data-testid="text-risk-daily-limit">Daily loss limit reached ({data.risk.dailyLossLimit}%). Trading paused.</p>
                  )}
                  {data.risk.isConsecutiveLockout && (
                    <p data-testid="text-risk-consecutive">Consecutive loss lockout active ({data.risk.consecutiveLosses} in a row).</p>
                  )}
                  {!data.risk.isLimitReached && !data.risk.isConsecutiveLockout && data.risk.consecutiveLosses >= 2 && (
                    <p data-testid="text-risk-warning">{data.risk.consecutiveLosses} consecutive losses. Stay disciplined.</p>
                  )}
                </div>
              </Card>
            )}

            <Card className="p-4" data-testid="card-scanner-status">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Zap className="h-4 w-4 text-primary" />
                  Scanner Active
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs" data-testid="text-active-profiles">
                    {data.optimizer.activeProfiles} strategies
                  </Badge>
                  <Shield className="h-3.5 w-3.5 text-emerald-500" />
                </div>
              </div>
              {data.topInstrument && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Trophy className="h-3 w-3 text-amber-500" />
                  Top today: <span className="font-medium text-foreground">{data.topInstrument.instrument}</span>
                  <span className="text-emerald-500">+{data.topInstrument.pips} pips</span>
                </div>
              )}
            </Card>

            <Button
              onClick={onDismiss}
              className="w-full h-11 text-base font-semibold gap-2"
              data-testid="button-lets-trade"
            >
              Let's Trade
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
