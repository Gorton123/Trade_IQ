import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, Shield, Target, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface TradeData {
  id: string;
  instrument: string;
  direction: string;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  conditions?: string;
  lotSize?: number;
  status: string;
  openedAt: string;
  oandaTradeId?: string;
}

export function TradeConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [trade, setTrade] = useState<TradeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tradeId = params.get("confirmTrade");
    const confirmSignal = params.get("confirmSignal");
    
    if (tradeId) {
      setLoading(true);
      fetch(`/api/simulation/trades/${tradeId}`, { credentials: "include" })
        .then(res => {
          if (!res.ok) throw new Error("Trade not found");
          return res.json();
        })
        .then((data: TradeData) => {
          setTrade(data);
          setOpen(true);
        })
        .catch((err) => {
          console.error("Trade confirm dialog error:", err);
          toast({ title: "Could not load trade", description: "The trade may have been removed. Check your trades list for details.", variant: "destructive" });
        })
        .finally(() => setLoading(false));

      window.history.replaceState({}, "", "/");
    } else if (confirmSignal) {
      const tf = params.get("tf") || "";
      const dir = params.get("dir") || "";
      setLoading(true);
      fetch(`/api/simulation/trades?status=open`, { credentials: "include" })
        .then(res => res.json())
        .then((trades: TradeData[]) => {
          const match = trades.find((t: TradeData) => 
            t.instrument === confirmSignal && 
            (!tf || t.timeframe === tf) &&
            (!dir || t.direction === dir) &&
            t.status === "open" &&
            !t.oandaTradeId
          );
          if (match) {
            setTrade(match);
            setOpen(true);
          } else {
            toast({ title: "No matching trade found", description: `No open ${confirmSignal} ${tf} trade to execute.`, variant: "destructive" });
          }
        })
        .catch(() => {
          toast({ title: "Error", description: "Could not find matching trade.", variant: "destructive" });
        })
        .finally(() => setLoading(false));

      window.history.replaceState({}, "", "/");
    }
  }, []);

  const handleExecute = async () => {
    if (!trade) return;
    setExecuting(true);
    try {
      const res = await apiRequest("POST", `/api/simulation/trades/${trade.id}/execute-oanda`);
      const result = await res.json();
      toast({
        title: "Trade Placed on OANDA",
        description: result.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/simulation/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/oanda"] });
      setOpen(false);
    } catch (error: any) {
      const msg = error?.message || "Failed to place trade";
      toast({ title: "Trade Failed", description: msg, variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  };

  if (!trade) return null;

  const isMetal = trade.instrument.includes("XAU") || trade.instrument.includes("XAG");
  const decimals = isMetal ? 2 : 5;
  const isBuy = trade.direction === "buy";
  const slPips = Math.abs(trade.entryPrice - trade.stopLoss) / (trade.instrument === "XAUUSD" ? 0.1 : trade.instrument === "XAGUSD" ? 0.01 : 0.0001);
  const tp1Pips = trade.takeProfit1 ? Math.abs(trade.takeProfit1 - trade.entryPrice) / (trade.instrument === "XAUUSD" ? 0.1 : trade.instrument === "XAGUSD" ? 0.01 : 0.0001) : 0;
  const rr = slPips > 0 ? (tp1Pips / slPips).toFixed(1) : "N/A";
  const alreadyOnOanda = !!trade.oandaTradeId;
  const isClosed = trade.status !== "open";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md" data-testid="dialog-trade-confirm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-confirm-title">
            {isBuy ? <TrendingUp className="h-5 w-5 text-green-500" /> : <TrendingDown className="h-5 w-5 text-red-500" />}
            Confirm Trade on OANDA
          </DialogTitle>
          <DialogDescription>
            Review the signal details before placing this trade on your OANDA account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold" data-testid="text-confirm-instrument">{trade.instrument}</span>
            <div className="flex items-center gap-2">
              <Badge variant={isBuy ? "default" : "destructive"} data-testid="badge-confirm-direction">
                {trade.direction.toUpperCase()}
              </Badge>
              <Badge variant="outline">{trade.timeframe}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <div className="text-muted-foreground">Entry Price</div>
              <div className="font-mono font-medium" data-testid="text-confirm-entry">{trade.entryPrice.toFixed(decimals)}</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center gap-1">
                <Shield className="h-3 w-3" /> Stop Loss
              </div>
              <div className="font-mono font-medium text-red-500" data-testid="text-confirm-sl">
                {trade.stopLoss.toFixed(decimals)}
                <span className="text-xs text-muted-foreground ml-1">({slPips.toFixed(1)} pips)</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground flex items-center gap-1">
                <Target className="h-3 w-3" /> Take Profit
              </div>
              <div className="font-mono font-medium text-green-500" data-testid="text-confirm-tp">
                {trade.takeProfit1?.toFixed(decimals) || "N/A"}
                <span className="text-xs text-muted-foreground ml-1">({tp1Pips.toFixed(1)} pips)</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Risk:Reward</div>
              <div className="font-mono font-medium" data-testid="text-confirm-rr">1:{rr}</div>
            </div>
          </div>

          {trade.lotSize && (
            <div className="text-sm text-muted-foreground">
              Simulated lot size: {trade.lotSize} (OANDA will recalculate based on your account)
            </div>
          )}

          {alreadyOnOanda && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
              <span className="text-sm text-yellow-600 dark:text-yellow-400">This trade is already on OANDA (ID: {trade.oandaTradeId})</span>
            </div>
          )}

          {isClosed && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
              <span className="text-sm text-red-600 dark:text-red-400">This trade has already been closed ({trade.status})</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-confirm-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleExecute}
            disabled={executing || alreadyOnOanda || isClosed}
            variant={isBuy ? "default" : "destructive"}
            data-testid="button-confirm-execute"
          >
            {executing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Placing...
              </>
            ) : (
              `Place ${trade.direction.toUpperCase()} on OANDA`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
