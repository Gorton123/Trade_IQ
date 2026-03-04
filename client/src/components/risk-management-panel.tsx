import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Shield, AlertTriangle, TrendingDown, Clock } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface LimitCheck {
  dailyLimitReached: boolean;
  maxPositionsReached: boolean;
  openPositions: number;
  maxPositions: number;
  dailyPnLPercent: number;
  dailyLimit: number;
}

interface UserSettings {
  maxOpenPositions?: number;
  dailyLossLimitPercent?: number;
  correlationWarningEnabled?: boolean;
  newsBlackoutMinutes?: number;
}

export function RiskManagementPanel() {
  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/user/settings"],
  });

  const { data: dailyPnL } = useQuery<{ currentPnLPercent?: number; currentPnL?: number; currentPnLPips?: number; wins?: number; losses?: number }>({
    queryKey: ["/api/daily-pnl"],
    refetchInterval: 15000,
  });

  const { data: limitCheck } = useQuery<LimitCheck>({
    queryKey: ["/api/risk-management/limit-check"],
    refetchInterval: 10000,
  });

  const updateMutation = useMutation({
    mutationFn: async (settings: Partial<UserSettings>) => {
      return apiRequest("PATCH", "/api/user/settings", settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/risk-management/limit-check"] });
    },
  });

  const maxPositions = userSettings?.maxOpenPositions ?? 3;
  const lossLimit = userSettings?.dailyLossLimitPercent ?? 5;
  const pnlPercent = dailyPnL?.currentPnLPercent || 0;
  const isProfit = pnlPercent >= 0;
  const usedLimit = Math.min(Math.abs(pnlPercent) / lossLimit * 100, 100);

  return (
    <Card data-testid="card-risk-management">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Risk Management
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Daily P/L:</span>
            <div className="text-right">
              <span className={isProfit ? "text-bullish font-medium" : "text-bearish font-medium"}>
                {isProfit ? "+" : ""}{pnlPercent.toFixed(2)}%
              </span>
              {dailyPnL?.currentPnL !== undefined && dailyPnL.currentPnL !== 0 && (
                <span className={`text-xs ml-1.5 ${isProfit ? "text-bullish/70" : "text-bearish/70"}`}>
                  ({isProfit ? "+" : ""}£{dailyPnL.currentPnL.toFixed(2)})
                </span>
              )}
            </div>
          </div>
          {!isProfit && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Loss Limit Used</span>
                <span>{usedLimit.toFixed(0)}%</span>
              </div>
              <Progress 
                value={usedLimit} 
                className={`h-2 ${usedLimit > 80 ? "[&>div]:bg-destructive" : usedLimit > 50 ? "[&>div]:bg-warning" : ""}`} 
              />
            </div>
          )}
        </div>

        {limitCheck?.dailyLimitReached && (
          <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-xs text-destructive font-medium">
              Daily loss limit reached - trading paused
            </span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Open Positions:</span>
          <Badge variant={limitCheck?.maxPositionsReached ? "destructive" : "outline"}>
            {limitCheck?.openPositions || 0} / {limitCheck?.maxPositions || maxPositions}
          </Badge>
        </div>

        <div className="space-y-3 pt-2 border-t">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Daily Loss Limit</span>
              <span className="font-medium">{lossLimit}%</span>
            </div>
            <Slider
              value={[lossLimit]}
              min={1}
              max={20}
              step={1}
              onValueChange={(v) => updateMutation.mutate({ dailyLossLimitPercent: v[0] })}
              data-testid="slider-daily-limit"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Max Open Positions</span>
              <span className="font-medium">{maxPositions}</span>
            </div>
            <Slider
              value={[maxPositions]}
              min={1}
              max={10}
              step={1}
              onValueChange={(v) => updateMutation.mutate({ maxOpenPositions: v[0] })}
              data-testid="slider-max-positions"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">News Blackout</span>
            </div>
            <Badge variant="outline">{userSettings?.newsBlackoutMinutes ?? 30}m</Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">Correlation Warnings</span>
            <Switch
              checked={userSettings?.correlationWarningEnabled ?? true}
              onCheckedChange={(checked) => updateMutation.mutate({ correlationWarningEnabled: checked })}
              data-testid="switch-correlation-warnings"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
