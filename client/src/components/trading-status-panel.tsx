import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ShieldAlert, Ban, AlertTriangle, CheckCircle, RefreshCw, TrendingDown, Activity } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface RiskLimitCheck {
  dailyLimitReached: boolean;
  maxPositionsReached: boolean;
  openPositions: number;
  maxPositions: number;
  dailyPnLPercent: number;
  dailyLimit: number;
  consecutiveLosses: number;
  consecutiveLossLimit: number;
  consecutiveLossLockout: boolean;
  tradingLocked: boolean;
  lockoutReason?: string;
  minAccountBalance: number;
}

export function TradingStatusPanel() {
  const queryClient = useQueryClient();

  const { data: riskStatus, isLoading } = useQuery<RiskLimitCheck>({
    queryKey: ["/api/risk-management/limit-check"],
    refetchInterval: 5000,
  });

  const resetLockout = useMutation({
    mutationFn: () => apiRequest("POST", "/api/risk-management/reset-lockout"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/risk-management/limit-check"] });
    },
  });

  if (isLoading || !riskStatus) {
    return (
      <Card data-testid="card-trading-status">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="w-4 h-4 animate-pulse" />
            Loading trading status...
          </div>
        </CardContent>
      </Card>
    );
  }

  const isTradingSafe = !riskStatus.tradingLocked && 
                        !riskStatus.maxPositionsReached && 
                        riskStatus.consecutiveLosses < 2;

  const drawdownProgress = Math.min(100, Math.abs(riskStatus.dailyPnLPercent) / riskStatus.dailyLimit * 100);
  const lossProgress = (riskStatus.consecutiveLosses / riskStatus.consecutiveLossLimit) * 100;

  return (
    <Card data-testid="card-trading-status" className={riskStatus.tradingLocked ? "border-destructive" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-primary" />
          Trading Status
          {riskStatus.tradingLocked ? (
            <Badge variant="destructive" className="ml-auto" data-testid="badge-locked">
              <Ban className="w-3 h-3 mr-1" />
              LOCKED
            </Badge>
          ) : isTradingSafe ? (
            <Badge variant="outline" className="ml-auto bg-green-500/10 text-green-600 border-green-500/30" data-testid="badge-safe">
              <CheckCircle className="w-3 h-3 mr-1" />
              SAFE
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto bg-yellow-500/10 text-yellow-600 border-yellow-500/30" data-testid="badge-caution">
              <AlertTriangle className="w-3 h-3 mr-1" />
              CAUTION
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {riskStatus.tradingLocked && (
          <div className="rounded-lg bg-destructive/20 border border-destructive/30 p-3 space-y-2" data-testid="lockout-warning">
            <div className="flex items-center gap-2 text-destructive font-semibold">
              <Ban className="w-5 h-5" />
              Trading Paused
            </div>
            <p className="text-sm text-muted-foreground">
              {riskStatus.lockoutReason || "Risk limits exceeded"}
            </p>
            {riskStatus.dailyLimitReached ? (
              <p className="text-xs text-destructive/80 font-medium">
                Daily loss limit reached. Trading will automatically resume tomorrow.
              </p>
            ) : riskStatus.consecutiveLossLockout ? (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => resetLockout.mutate()}
                disabled={resetLockout.isPending}
                data-testid="button-reset-lockout"
              >
                <RefreshCw className={`w-3 h-3 mr-1 ${resetLockout.isPending ? "animate-spin" : ""}`} />
                I understand the risk - Resume Trading
              </Button>
            ) : null}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <TrendingDown className="w-3 h-3" />
                Daily Drawdown
              </span>
              <span className={`font-price ${riskStatus.dailyPnLPercent < 0 ? "text-bearish" : "text-bullish"}`}>
                {riskStatus.dailyPnLPercent.toFixed(2)}% / -{riskStatus.dailyLimit}%
              </span>
            </div>
            <Progress 
              value={drawdownProgress} 
              className={`h-2 ${drawdownProgress > 70 ? "[&>div]:bg-destructive" : drawdownProgress > 40 ? "[&>div]:bg-yellow-500" : ""}`}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Consecutive Losses
              </span>
              <span className={`font-semibold ${riskStatus.consecutiveLosses >= 2 ? "text-yellow-500" : ""}`}>
                {riskStatus.consecutiveLosses} / {riskStatus.consecutiveLossLimit}
              </span>
            </div>
            <Progress 
              value={lossProgress} 
              className={`h-2 ${lossProgress >= 66 ? "[&>div]:bg-destructive" : lossProgress >= 33 ? "[&>div]:bg-yellow-500" : ""}`}
            />
          </div>

          <div className="flex items-center justify-between text-sm pt-1">
            <span className="text-muted-foreground">Open Positions</span>
            <span className={riskStatus.maxPositionsReached ? "text-destructive font-semibold" : ""}>
              {riskStatus.openPositions} / {riskStatus.maxPositions}
            </span>
          </div>
        </div>

        {riskStatus.consecutiveLosses >= 2 && !riskStatus.tradingLocked && (
          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 text-sm" data-testid="caution-warning">
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 font-medium">
              <AlertTriangle className="w-4 h-4" />
              {riskStatus.consecutiveLosses} losses in a row
            </div>
            <p className="text-muted-foreground mt-1">
              Consider taking a break or reducing position size. 
              {riskStatus.consecutiveLossLimit - riskStatus.consecutiveLosses} more losses triggers automatic lockout.
            </p>
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
          <p className="font-medium">Risk Rules Active:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Max {riskStatus.dailyLimit}% daily loss limit</li>
            <li>Pause after {riskStatus.consecutiveLossLimit} consecutive losses</li>
            <li>Max {riskStatus.maxPositions} open positions</li>
            <li>Min £{riskStatus.minAccountBalance} account balance</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
