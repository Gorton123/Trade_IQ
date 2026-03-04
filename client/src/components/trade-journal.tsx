import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, TrendingUp, TrendingDown, Target, CheckCircle } from "lucide-react";
import { instruments, type JournalEntry, type Instrument } from "@shared/schema";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TradeJournalProps {
  onAddTrade?: (entry: JournalEntry) => void;
}

export function TradeJournal({ onAddTrade }: TradeJournalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isCompletedTrade, setIsCompletedTrade] = useState(false);
  const [newEntry, setNewEntry] = useState({
    instrument: "XAUUSD" as Instrument,
    direction: "buy" as "buy" | "sell",
    entryPrice: "",
    stopLoss: "",
    takeProfit: "",
    lotSize: "0.02",
    notes: "",
    exitPrice: "",
    outcome: "win" as "win" | "loss" | "breakeven",
    timeframe: "1h",
  });

  const { data: trades = [] } = useQuery<any[]>({
    queryKey: ["/api/journal"],
  });

  const addTradeMutation = useMutation({
    mutationFn: async (trade: any) => {
      return apiRequest("POST", "/api/journal", trade);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal/stats"] });
    },
  });

  const calculatePips = (entry: number, exit: number, direction: "buy" | "sell", instrument: string) => {
    const diff = direction === "buy" ? exit - entry : entry - exit;
    if (instrument === "XAUUSD") {
      return Math.round(diff * 10);
    }
    return Math.round(diff * 10000);
  };

  const handleAddTrade = async () => {
    try {
      const entryPrice = parseFloat(newEntry.entryPrice);
      const exitPrice = isCompletedTrade ? parseFloat(newEntry.exitPrice) : undefined;
      const lotSize = parseFloat(newEntry.lotSize);
      
      // Only parse SL/TP if not a completed trade (they're optional for completed trades)
      const stopLoss = !isCompletedTrade && newEntry.stopLoss ? parseFloat(newEntry.stopLoss) : null;
      const takeProfit = !isCompletedTrade && newEntry.takeProfit ? parseFloat(newEntry.takeProfit) : null;

      let pnlPips: number | undefined;
      let pnlGBP: number | undefined;
      let outcome: string | undefined;
      let status = "open";

      if (isCompletedTrade && exitPrice) {
        pnlPips = calculatePips(entryPrice, exitPrice, newEntry.direction, newEntry.instrument);
        pnlGBP = pnlPips * lotSize * (newEntry.instrument === "XAUUSD" ? 1 : 10);
        outcome = newEntry.outcome;
        status = "closed";
      }

      const trade = {
        instrument: newEntry.instrument,
        direction: newEntry.direction,
        entryPrice,
        exitPrice: exitPrice || null,
        stopLoss,
        takeProfit,
        lotSize,
        status,
        outcome: outcome || null,
        pnlPips: pnlPips || null,
        pnlGBP: pnlGBP || null,
        notes: newEntry.notes || null,
        timeframe: newEntry.timeframe,
        entryTime: new Date().toISOString(),
        exitTime: isCompletedTrade ? new Date().toISOString() : null,
      };

      await addTradeMutation.mutateAsync(trade);
      
      setIsOpen(false);
      setIsCompletedTrade(false);
      setNewEntry({
        instrument: "XAUUSD",
        direction: "buy",
        entryPrice: "",
        stopLoss: "",
        takeProfit: "",
        lotSize: "0.02",
        notes: "",
        exitPrice: "",
        outcome: "win",
        timeframe: "1h",
      });
    } catch (error) {
      toast({
        title: "Failed to save trade",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const stats = {
    totalTrades: trades.filter((e: any) => e.status === "closed").length,
    wins: trades.filter((e: any) => e.outcome === "win").length,
    losses: trades.filter((e: any) => e.outcome === "loss").length,
    winRate: trades.filter((e: any) => e.status === "closed").length > 0
      ? (trades.filter((e: any) => e.outcome === "win").length / trades.filter((e: any) => e.status === "closed").length) * 100
      : 0,
    totalPnl: trades.reduce((sum: number, e: any) => sum + (e.pnlPips || 0), 0),
  };

  const canSubmit = isCompletedTrade 
    ? newEntry.entryPrice && newEntry.exitPrice && newEntry.lotSize
    : newEntry.entryPrice && newEntry.stopLoss && newEntry.takeProfit && newEntry.lotSize;

  return (
    <Card data-testid="card-trade-journal">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">Trade Journal</CardTitle>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="min-h-[44px]" data-testid="button-add-trade">
                <Plus className="w-4 h-4 mr-1" />
                Log Trade
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Log Trade</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/30">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span className="text-sm font-medium">Already Closed?</span>
                  </div>
                  <Switch
                    checked={isCompletedTrade}
                    onCheckedChange={setIsCompletedTrade}
                    data-testid="switch-completed-trade"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Instrument</Label>
                    <Select
                      value={newEntry.instrument}
                      onValueChange={(v) => setNewEntry({ ...newEntry, instrument: v as Instrument })}
                    >
                      <SelectTrigger data-testid="select-journal-instrument">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {instruments.map((inst) => (
                          <SelectItem key={inst} value={inst}>{inst}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Timeframe</Label>
                    <Select
                      value={newEntry.timeframe}
                      onValueChange={(v) => setNewEntry({ ...newEntry, timeframe: v })}
                    >
                      <SelectTrigger data-testid="select-journal-timeframe">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1m">1m</SelectItem>
                        <SelectItem value="5m">5m</SelectItem>
                        <SelectItem value="15m">15m</SelectItem>
                        <SelectItem value="1h">1h</SelectItem>
                        <SelectItem value="4h">4h</SelectItem>
                        <SelectItem value="1D">1D</SelectItem>
                        <SelectItem value="1W">1W</SelectItem>
                        <SelectItem value="1M">1M</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Direction</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={newEntry.direction === "buy" ? "default" : "outline"}
                      className="flex-1 min-h-[44px]"
                      onClick={() => setNewEntry({ ...newEntry, direction: "buy" })}
                      data-testid="button-direction-buy"
                    >
                      <TrendingUp className="w-4 h-4 mr-1" />
                      Buy
                    </Button>
                    <Button
                      type="button"
                      variant={newEntry.direction === "sell" ? "default" : "outline"}
                      className="flex-1 min-h-[44px]"
                      onClick={() => setNewEntry({ ...newEntry, direction: "sell" })}
                      data-testid="button-direction-sell"
                    >
                      <TrendingDown className="w-4 h-4 mr-1" />
                      Sell
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Entry Price</Label>
                    <Input
                      type="number"
                      step="any"
                      value={newEntry.entryPrice}
                      onChange={(e) => setNewEntry({ ...newEntry, entryPrice: e.target.value })}
                      placeholder={newEntry.instrument === "XAUUSD" ? "5060.00" : "1.2500"}
                      data-testid="input-entry-price"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Lot Size</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newEntry.lotSize}
                      onChange={(e) => setNewEntry({ ...newEntry, lotSize: e.target.value })}
                      data-testid="input-lot-size"
                    />
                  </div>
                </div>

                {!isCompletedTrade && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Stop Loss</Label>
                      <Input
                        type="number"
                        step="any"
                        value={newEntry.stopLoss}
                        onChange={(e) => setNewEntry({ ...newEntry, stopLoss: e.target.value })}
                        data-testid="input-stop-loss"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Take Profit</Label>
                      <Input
                        type="number"
                        step="any"
                        value={newEntry.takeProfit}
                        onChange={(e) => setNewEntry({ ...newEntry, takeProfit: e.target.value })}
                        data-testid="input-take-profit"
                      />
                    </div>
                  </div>
                )}

                {isCompletedTrade && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Exit Price</Label>
                        <Input
                          type="number"
                          step="any"
                          value={newEntry.exitPrice}
                          onChange={(e) => setNewEntry({ ...newEntry, exitPrice: e.target.value })}
                          placeholder={newEntry.instrument === "XAUUSD" ? "5080.00" : "1.2600"}
                          data-testid="input-exit-price"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Result</Label>
                        <Select
                          value={newEntry.outcome}
                          onValueChange={(v) => setNewEntry({ ...newEntry, outcome: v as "win" | "loss" | "breakeven" })}
                        >
                          <SelectTrigger data-testid="select-outcome">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="win">Win</SelectItem>
                            <SelectItem value="loss">Loss</SelectItem>
                            <SelectItem value="breakeven">Breakeven</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {newEntry.entryPrice && newEntry.exitPrice && (
                      <div className="p-3 rounded-md bg-muted/30">
                        <div className="text-sm text-muted-foreground mb-1">Calculated P/L</div>
                        <div className={`text-lg font-bold ${
                          calculatePips(
                            parseFloat(newEntry.entryPrice), 
                            parseFloat(newEntry.exitPrice), 
                            newEntry.direction, 
                            newEntry.instrument
                          ) >= 0 ? "text-green-400" : "text-red-400"
                        }`}>
                          {calculatePips(
                            parseFloat(newEntry.entryPrice), 
                            parseFloat(newEntry.exitPrice), 
                            newEntry.direction, 
                            newEntry.instrument
                          ) >= 0 ? "+" : ""}
                          {calculatePips(
                            parseFloat(newEntry.entryPrice), 
                            parseFloat(newEntry.exitPrice), 
                            newEntry.direction, 
                            newEntry.instrument
                          )} pips
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={newEntry.notes}
                    onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
                    placeholder="Why did you take this trade?"
                    data-testid="input-notes"
                  />
                </div>

                <Button
                  className="w-full min-h-[44px]"
                  onClick={handleAddTrade}
                  disabled={!canSubmit || addTradeMutation.isPending}
                  data-testid="button-submit-trade"
                >
                  {addTradeMutation.isPending ? "Saving..." : isCompletedTrade ? "Log Completed Trade" : "Log Open Trade"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="text-center p-2 bg-muted/30 rounded-md">
            <div className="text-lg font-bold">{stats.totalTrades}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center p-2 bg-green-500/10 rounded-md">
            <div className="text-lg font-bold text-green-400">{stats.wins}</div>
            <div className="text-xs text-muted-foreground">Wins</div>
          </div>
          <div className="text-center p-2 bg-red-500/10 rounded-md">
            <div className="text-lg font-bold text-red-400">{stats.losses}</div>
            <div className="text-xs text-muted-foreground">Losses</div>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-md">
            <div className="text-lg font-bold">{stats.winRate.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">Win Rate</div>
          </div>
        </div>

        {trades.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No trades logged yet</p>
            <p className="text-xs">Click "Log Trade" to start tracking</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {trades.map((entry: any) => (
              <div
                key={entry.id}
                className="p-3 rounded-md bg-muted/30 hover-elevate transition-colors"
                data-testid={`journal-entry-${entry.id}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={entry.direction === "buy" ? "default" : "destructive"}>
                      {entry.direction === "buy" ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                      {entry.direction.toUpperCase()}
                    </Badge>
                    <span className="font-medium">{entry.instrument}</span>
                    {entry.timeframe && (
                      <Badge variant="outline" className="text-xs">{entry.timeframe}</Badge>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      entry.status === "open"
                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        : entry.outcome === "win"
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : entry.outcome === "loss"
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                    }
                  >
                    {entry.status === "open" ? "Open" : entry.outcome === "win" ? "WIN" : entry.outcome === "loss" ? "LOSS" : "BE"}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Entry: </span>
                    <span className="font-mono">{entry.entryPrice}</span>
                  </div>
                  {entry.exitPrice && (
                    <div>
                      <span className="text-muted-foreground">Exit: </span>
                      <span className="font-mono">{entry.exitPrice}</span>
                    </div>
                  )}
                  {entry.pnlPips !== undefined && entry.pnlPips !== null && (
                    <div className={entry.pnlPips >= 0 ? "text-green-400" : "text-red-400"}>
                      <span className="font-mono font-medium">
                        {entry.pnlPips >= 0 ? "+" : ""}{entry.pnlPips} pips
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
