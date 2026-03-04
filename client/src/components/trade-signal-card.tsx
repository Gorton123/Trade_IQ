import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  ArrowUpCircle, 
  ArrowDownCircle, 
  MinusCircle, 
  Copy, 
  Check,
  Target,
  Shield,
  TrendingUp,
  Play,
  Loader2,
  Zap,
  AlertTriangle,
  Info,
  Crown,
  BarChart3
} from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TradeSignal } from "@shared/schema";

interface RiskCheckResult {
  available: boolean;
  accountBalance: number;
  currency: string;
  riskPercent: number;
  normalRiskAmount: number;
  lotSize: number;
  units: number;
  elevatedRisk: boolean;
  actualRiskPercent: number;
  actualRiskAmount: number;
  potentialReward: number;
  minAccountFor1Pct: number;
  skipped: boolean;
  skipReason?: string;
  reason?: string;
}

interface TradeSignalCardProps {
  signal: TradeSignal | null;
  isLoading?: boolean;
  isTopPick?: boolean;
  signalScore?: number;
  pairWinRate?: number;
  pairTotalTrades?: number;
}

export function TradeSignalCard({ signal, isLoading, isTopPick, signalScore, pairWinRate, pairTotalTrades }: TradeSignalCardProps) {
  const [copied, setCopied] = useState(false);
  const [executed, setExecuted] = useState(false);
  const [oandaExecuted, setOandaExecuted] = useState(false);
  const [showRiskInfo, setShowRiskInfo] = useState(false);
  const { toast } = useToast();

  const { data: oandaStatus } = useQuery<{ connected: boolean; isLive: boolean }>({
    queryKey: ["/api/oanda/status"],
    refetchInterval: 60000,
  });

  const oandaConnected = oandaStatus?.connected ?? false;

  const { data: riskCheck, isLoading: riskCheckLoading } = useQuery<RiskCheckResult>({
    queryKey: ["/api/oanda/risk-check", signal?.instrument, signal?.stopLoss],
    queryFn: async () => {
      if (!signal) throw new Error("No signal");
      const entryPrice = (signal.entryZone.low + signal.entryZone.high) / 2;
      const res = await apiRequest("POST", "/api/oanda/risk-check", {
        instrument: signal.instrument,
        stopLoss: signal.stopLoss,
        entryPrice,
      });
      return res.json();
    },
    enabled: !!signal && oandaConnected,
    staleTime: 30000,
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!signal) throw new Error("No signal");
      const entryPrice = (signal.entryZone.low + signal.entryZone.high) / 2;
      return apiRequest("POST", "/api/simulation/execute-signal", {
        instrument: signal.instrument,
        timeframe: signal.timeframe,
        direction: signal.direction,
        entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit1: signal.takeProfit1,
        takeProfit2: signal.takeProfit2,
        confidence: signal.confidence,
        reasoning: signal.reasoning,
      });
    },
    onSuccess: async (response) => {
      const data = await response.json();
      if (data.success) {
        setExecuted(true);
        setTimeout(() => setExecuted(false), 3000);
        queryClient.invalidateQueries({ queryKey: ["/api/simulation/trades"] });
        queryClient.invalidateQueries({ queryKey: ["/api/simulation/stats"] });
        toast({
          title: "Trade Placed",
          description: `${signal?.direction.toUpperCase()} ${signal?.instrument} simulation trade opened`,
        });
      } else {
        toast({
          title: "Trade Not Placed",
          description: data.reason || "Could not execute trade",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      let description = "Failed to execute trade";
      try {
        const match = error.message.match(/\d+:\s*(.*)/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.reason) description = parsed.reason;
        }
      } catch {}
      toast({
        title: "Trade Not Placed",
        description,
        variant: "destructive",
      });
    },
  });

  const oandaExecuteMutation = useMutation({
    mutationFn: async () => {
      if (!signal) throw new Error("No signal");
      const entryPrice = (signal.entryZone.low + signal.entryZone.high) / 2;
      return apiRequest("POST", "/api/oanda/execute", {
        instrument: signal.instrument,
        direction: signal.direction,
        entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit1,
        confidence: signal.confidence,
        timeframe: signal.timeframe,
        entryLow: signal.entryZone.low,
        entryHigh: signal.entryZone.high,
      });
    },
    onSuccess: async (response) => {
      const data = await response.json();
      if (data.success) {
        setOandaExecuted(true);
        setTimeout(() => setOandaExecuted(false), 5000);
        queryClient.invalidateQueries({ queryKey: ["/api/oanda/trades"] });
        if (data.riskWarning) {
          toast({
            title: "OANDA Trade Placed (Elevated Risk)",
            description: `${signal?.direction.toUpperCase()} ${signal?.instrument} — ${data.lotSize} lots. Risk: ${data.riskWarning.actualRiskPercent}% of account`,
          });
        } else {
          toast({
            title: "OANDA Trade Placed",
            description: `${signal?.direction.toUpperCase()} ${signal?.instrument} — ${data.lotSize} lots on OANDA`,
          });
        }
      } else {
        toast({
          title: "OANDA Trade Failed",
          description: data.error || "Could not place trade",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      let description = "Failed to place OANDA trade";
      try {
        const match = error.message.match(/\d+:\s*(.*)/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.error) description = parsed.error;
        }
      } catch {}
      toast({
        title: "OANDA Trade Failed",
        description,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!signal) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <MinusCircle className="w-4 h-4" />
            No Active Signal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Waiting for a valid trade setup. The market conditions don't currently support a high-probability trade.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isBuy = signal.direction === "buy";
  const isSell = signal.direction === "sell";
  const isMetal = signal.instrument === "XAUUSD" || signal.instrument === "XAGUSD";
  const decimals = isMetal ? 2 : 5;

  const formatPrice = (price: number | null | undefined) => (price ?? 0).toFixed(decimals);
  const formatCurrency = (amount: number, currency: string) => {
    const symbols: Record<string, string> = { GBP: "\u00a3", USD: "$", EUR: "\u20ac" };
    return `${symbols[currency] || currency + " "}${amount.toFixed(2)}`;
  };

  const copySignal = async () => {
    const text = `${signal.direction.toUpperCase()} ${signal.instrument}
Entry: ${formatPrice(signal.entryZone.low)} - ${formatPrice(signal.entryZone.high)}
SL: ${formatPrice(signal.stopLoss)}
TP1: ${formatPrice(signal.takeProfit1)}${signal.takeProfit2 ? `\nTP2: ${formatPrice(signal.takeProfit2)}` : ''}
R:R ${(signal.riskRewardRatio || 0).toFixed(1)}:1`;
    
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const instrumentName = signal.instrument === "XAGUSD" ? "Silver" : signal.instrument === "XAUUSD" ? "Gold" : signal.instrument;

  const isWeakSignal = signalScore !== undefined && signalScore < 50;

  return (
    <Card 
      className={`border-l-4 ${isTopPick ? 'border-l-amber-400 ring-1 ring-amber-400/30' : isBuy ? 'border-l-green-500' : isSell ? 'border-l-red-500' : 'border-l-muted'} ${isWeakSignal ? 'opacity-60' : ''}`}
      data-testid="card-trade-signal"
    >
      {isTopPick && (
        <div className="flex items-center gap-2 px-4 pt-3 pb-0" data-testid="badge-top-pick">
          <Crown className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-amber-400">TOP PICK</span>
          {pairWinRate !== undefined && pairWinRate > 0 && pairTotalTrades !== undefined && pairTotalTrades >= 5 && (
            <span className="text-xs text-muted-foreground">
              — {signal.instrument} {pairWinRate}% win rate ({pairTotalTrades} trades) + {signal.confidence}% confidence
            </span>
          )}
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            {isBuy ? (
              <ArrowUpCircle className="w-5 h-5 text-bullish" />
            ) : isSell ? (
              <ArrowDownCircle className="w-5 h-5 text-bearish" />
            ) : (
              <MinusCircle className="w-5 h-5 text-muted-foreground" />
            )}
            <span className={isBuy ? 'text-bullish' : isSell ? 'text-bearish' : ''}>
              {signal.direction.toUpperCase()}
            </span>
            <span className="text-muted-foreground font-normal">
              {signal.instrument}
            </span>
            {pairWinRate !== undefined && pairTotalTrades !== undefined && pairTotalTrades >= 5 && (
              <Badge 
                variant="outline" 
                className={`text-[10px] px-1.5 py-0 ${pairWinRate >= 60 ? 'border-green-500/50 text-green-400' : pairWinRate >= 45 ? 'border-amber-500/50 text-amber-400' : 'border-red-500/50 text-red-400'}`}
                data-testid="badge-pair-winrate"
              >
                <BarChart3 className="w-2.5 h-2.5 mr-0.5" />
                {pairWinRate}% WR
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge 
              variant="secondary" 
              className={`${signal.confidence >= 70 ? 'bg-bullish text-green-100' : signal.confidence >= 50 ? 'bg-amber-500/20 text-amber-500' : 'bg-muted'}`}
            >
              {signal.confidence}% Confidence
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {oandaConnected && riskCheck && (riskCheck.elevatedRisk || riskCheck.skipped) && (
          <div 
            className={`rounded-lg p-3 text-sm ${riskCheck.skipped ? 'bg-red-500/10 border border-red-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}
            data-testid="banner-risk-warning"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${riskCheck.skipped ? 'text-red-500' : 'text-amber-500'}`} />
              <div className="space-y-1.5">
                {riskCheck.skipped ? (
                  <>
                    <div className="font-medium text-red-400" data-testid="text-risk-blocked">
                      Trade Blocked — Risk Too High
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The smallest possible {instrumentName} trade would risk{" "}
                      <span className="text-red-400 font-medium">{riskCheck.actualRiskPercent}%</span> of your account
                      ({formatCurrency(riskCheck.actualRiskAmount, riskCheck.currency)}).
                      Your risk setting is {riskCheck.riskPercent}% ({formatCurrency(riskCheck.normalRiskAmount, riskCheck.currency)}).
                    </p>
                  </>
                ) : (
                  <>
                    <div className="font-medium text-amber-400" data-testid="text-risk-elevated">
                      Elevated Risk — {riskCheck.actualRiskPercent}% instead of {riskCheck.riskPercent}%
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Your broker's minimum trade size for {instrumentName} means this trade risks{" "}
                      <span className="text-amber-400 font-medium">{formatCurrency(riskCheck.actualRiskAmount, riskCheck.currency)}</span>
                      {" "}({riskCheck.actualRiskPercent}% of your {formatCurrency(riskCheck.accountBalance, riskCheck.currency)} account)
                      instead of the usual {formatCurrency(riskCheck.normalRiskAmount, riskCheck.currency)} ({riskCheck.riskPercent}%).
                    </p>
                    <div className="flex items-center gap-3 text-xs mt-1">
                      <span className="text-red-400">
                        If SL hit: -{formatCurrency(riskCheck.actualRiskAmount, riskCheck.currency)}
                      </span>
                      <span className="text-green-400">
                        If TP hit: +{formatCurrency(riskCheck.potentialReward, riskCheck.currency)}
                      </span>
                    </div>
                  </>
                )}
                <button
                  onClick={() => setShowRiskInfo(!showRiskInfo)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                  data-testid="button-why-elevated-risk"
                >
                  <Info className="w-3 h-3" />
                  {showRiskInfo ? "Hide explanation" : "Why is my risk higher?"}
                </button>
                {showRiskInfo && (
                  <div className="mt-2 p-2.5 rounded bg-card/50 text-xs text-muted-foreground space-y-2" data-testid="panel-risk-explanation">
                    <p>
                      <span className="font-medium text-foreground">What's happening:</span>{" "}
                      Your broker (OANDA) has a minimum trade size for {instrumentName}. Even at the smallest possible order,
                      the risk is higher than your {riskCheck.riskPercent}% setting allows on your current account size.
                    </p>
                    <p>
                      <span className="font-medium text-foreground">This is normal for smaller accounts.</span>{" "}
                      {instrumentName} is a high-value instrument — each price movement is worth more in currency terms.
                      As your account grows, the same minimum trade becomes a smaller percentage of your balance.
                    </p>
                    {riskCheck.minAccountFor1Pct && (
                      <p>
                        <span className="font-medium text-foreground">To trade this at {riskCheck.riskPercent}% risk:</span>{" "}
                        You'd need an account of approximately{" "}
                        <span className="text-foreground font-medium">{formatCurrency(riskCheck.minAccountFor1Pct, riskCheck.currency)}</span>.
                      </p>
                    )}
                    <p>
                      <span className="font-medium text-foreground">Is it still worth it?</span>{" "}
                      With a {(signal.riskRewardRatio || 0).toFixed(1)}:1 reward ratio, a winning trade makes{" "}
                      {(signal.riskRewardRatio || 0).toFixed(1)}x what you'd lose. If the system's win rate holds,
                      the extra risk per trade is offset by larger wins.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Target className="w-3 h-3" />
                Entry Zone
              </div>
              <div className="font-price font-medium">
                {formatPrice(signal.entryZone.low)} - {formatPrice(signal.entryZone.high)}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Stop Loss
              </div>
              <div className="font-price font-medium text-bearish">
                {formatPrice(signal.stopLoss)}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                Take Profit 1
              </div>
              <div className="font-price font-medium text-bullish">
                {formatPrice(signal.takeProfit1)}
              </div>
            </div>
            {signal.takeProfit2 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Take Profit 2
                </div>
                <div className="font-price font-medium text-bullish">
                  {formatPrice(signal.takeProfit2)}
                </div>
              </div>
            )}
          </div>
        </div>

        {oandaConnected && riskCheck && riskCheck.available && !riskCheck.elevatedRisk && !riskCheck.skipped && (
          <div className="flex items-center gap-3 text-xs rounded-lg p-2.5 bg-muted/40 border border-border" data-testid="panel-trade-pnl">
            <span className="text-muted-foreground">Your {riskCheck.riskPercent}% risk:</span>
            <span className="text-red-400 font-medium" data-testid="text-sl-loss">
              If SL hit: -{formatCurrency(riskCheck.normalRiskAmount, riskCheck.currency)}
            </span>
            <span className="text-green-400 font-medium" data-testid="text-tp-profit">
              If TP hit: +{formatCurrency(riskCheck.potentialReward, riskCheck.currency)}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-muted-foreground">R:R </span>
              <span className="font-semibold">{(signal.riskRewardRatio || 0).toFixed(1)}:1</span>
            </div>
            <Badge variant="outline" className="text-xs">
              {signal.timeframe}
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {oandaConnected && (
              <Button 
                size="sm" 
                variant="destructive"
                className="bg-amber-600 text-white"
                onClick={() => oandaExecuteMutation.mutate()}
                disabled={oandaExecuteMutation.isPending || oandaExecuted || riskCheck?.skipped === true || riskCheckLoading}
                data-testid="button-oanda-trade"
              >
                {oandaExecuteMutation.isPending ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Placing...
                  </>
                ) : oandaExecuted ? (
                  <>
                    <Check className="w-3 h-3 mr-1" />
                    OANDA
                  </>
                ) : riskCheckLoading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Checking...
                  </>
                ) : riskCheck?.skipped ? (
                  <>
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Blocked
                  </>
                ) : (
                  <>
                    <Zap className="w-3 h-3 mr-1" />
                    OANDA
                  </>
                )}
              </Button>
            )}
            <Button 
              size="sm" 
              variant="default" 
              onClick={() => executeMutation.mutate()}
              disabled={executeMutation.isPending || executed}
              data-testid="button-simulate-trade"
            >
              {executeMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Placing...
                </>
              ) : executed ? (
                <>
                  <Check className="w-3 h-3 mr-1" />
                  Placed
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 mr-1" />
                  Simulate
                </>
              )}
            </Button>
            <Button 
              size="sm" 
              variant="secondary" 
              onClick={copySignal}
              data-testid="button-copy-signal"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>

        {signal.reasoning.length > 0 && (
          <div className="pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground mb-2">Why this signal:</div>
            <ul className="text-xs space-y-1">
              {signal.reasoning.map((reason, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
