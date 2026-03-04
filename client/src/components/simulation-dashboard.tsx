import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  TrendingUp, 
  TrendingDown,
  Target,
  AlertTriangle,
  Activity,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Globe,
  Volume2,
  VolumeX,
  Calendar,
  Wallet,
  Settings,
  RotateCcw,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Power,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InfoTooltip } from "@/components/metric-tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LearningInsights } from "./learning-insights";
import { TradeChart } from "./trade-chart";
import { playIfEnabled, playTradeOpenedSound, playTradeWonSound, playTradeLostSound, isSoundEnabled, setSoundEnabled } from "@/lib/trade-sounds";
import type { SimulatedTrade, SimulationStats, Instrument, Timeframe } from "@shared/schema";

interface SimulationResponse {
  enabled: boolean;
  stats: SimulationStats;
}

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
  lotSize?: number;
  potentialProfit?: number;
  potentialLoss?: number;
}

interface OandaStatusResponse {
  connected: boolean;
  account?: {
    balance: string;
    currency: string;
    unrealizedPL: string;
    openTradeCount: number;
  };
  openTrades?: OandaTrade[];
}

function formatTradeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function formatDuration(openedAt: string, closedAt?: string): string {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const diffMs = end - start;
  
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

interface LivePrice {
  instrument: string;
  bid: number;
  ask: number;
  timestamp: string;
  source: string;
}

interface PaperAccountData {
  startingBalance: number;
  currentBalance: number;
  currency: string;
  riskPercent: number;
  peakBalance: number;
  maxDrawdown: number;
  createdAt: string;
  totalReturn: number;
  returnPercent: number;
  closedTradeCount: number;
  openTradeCount: number;
}

const PIP_VALUES: Record<string, number> = {
  XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, GBPUSD: 0.0001,
  USDCHF: 0.0001, AUDUSD: 0.0001, NZDUSD: 0.0001,
};

const CONTRACT_SIZES: Record<string, number> = {
  XAUUSD: 100, XAGUSD: 5000, EURUSD: 100000, GBPUSD: 100000,
  USDCHF: 100000, AUDUSD: 100000, NZDUSD: 100000,
};

function calculateUnrealizedPnL(
  trade: SimulatedTrade,
  currentPrice: number,
  accountCurrency: string
): { pips: number; money: number } {
  const pipSize = PIP_VALUES[trade.instrument] || 0.0001;
  const contractSize = CONTRACT_SIZES[trade.instrument] || 100000;

  const priceDiff = trade.direction === "buy"
    ? currentPrice - trade.entryPrice
    : trade.entryPrice - currentPrice;
  const pips = priceDiff / pipSize;

  let pipValueUsd = pipSize * contractSize;
  const isJpyQuote = trade.instrument.endsWith("JPY");
  const isChfQuote = trade.instrument.endsWith("CHF");
  if ((isJpyQuote || isChfQuote) && currentPrice > 0) {
    pipValueUsd = pipValueUsd / currentPrice;
  }

  let pipValuePerLot: number;
  if (accountCurrency === "GBP") {
    pipValuePerLot = pipValueUsd * 0.735;
  } else if (accountCurrency === "EUR") {
    pipValuePerLot = pipValueUsd * 0.84;
  } else {
    pipValuePerLot = pipValueUsd;
  }

  const lotSize = trade.lotSize || 0.01;
  const money = Math.round(pips * lotSize * pipValuePerLot * 100) / 100;

  return { pips: Math.round(pips * 10) / 10, money };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "\u00A3",
  USD: "$",
  EUR: "\u20AC",
};

const ALL_SIMULATION_INSTRUMENTS = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "EURJPY"];
const ALL_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

function PaperAccountPanel() {
  const [showSettings, setShowSettings] = useState(false);
  const [newBalance, setNewBalance] = useState("");
  const [newCurrency, setNewCurrency] = useState("");
  const [newRiskPercent, setNewRiskPercent] = useState("");
  const [simInstruments, setSimInstruments] = useState<string[]>([]);
  const [simTimeframes, setSimTimeframes] = useState<string[]>([]);
  const [boostThreshold, setBoostThreshold] = useState<number | null>(null);
  const [boostMultiplier, setBoostMultiplier] = useState<number | null>(null);

  const { data: account, isLoading } = useQuery<PaperAccountData>({
    queryKey: ["/api/paper-account"],
    refetchInterval: 10000,
  });

  const { data: userSettings } = useQuery<any>({
    queryKey: ["/api/user/settings"],
  });

  useEffect(() => {
    if (userSettings?.simulationInstruments) {
      setSimInstruments(userSettings.simulationInstruments);
    }
    if (userSettings?.simulationTimeframes) {
      setSimTimeframes(userSettings.simulationTimeframes);
    }
    if (userSettings?.confidenceBoostThreshold != null) {
      setBoostThreshold(userSettings.confidenceBoostThreshold);
    }
    if (userSettings?.confidenceBoostMultiplier != null) {
      setBoostMultiplier(userSettings.confidenceBoostMultiplier);
    }
  }, [userSettings]);

  const setupMutation = useMutation({
    mutationFn: async (params: { startingBalance?: number; currency?: string; riskPercent?: number }) => {
      return apiRequest("POST", "/api/paper-account/setup", params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/paper-account"] });
      queryClient.invalidateQueries({ queryKey: ["/api/simulation/trades"] });
      setShowSettings(false);
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/paper-account/reset");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/paper-account"] });
    },
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (!account) return null;

  const sym = CURRENCY_SYMBOLS[account.currency] || account.currency;
  const isPositive = account.totalReturn >= 0;

  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-muted" data-testid="panel-paper-account">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary">PAPER ACCOUNT</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setShowSettings(!showSettings)}
            data-testid="button-paper-settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              if (window.confirm(`Reset paper account to ${sym}${account.startingBalance}? This will wipe your current balance of ${sym}${account.currentBalance.toFixed(2)}. Your trade history will be preserved.`)) {
                resetMutation.mutate();
              }
            }}
            disabled={resetMutation.isPending}
            data-testid="button-paper-reset"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div>
          <div className="text-lg font-bold" data-testid="text-paper-balance">
            {sym}{account.currentBalance.toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground">Balance</div>
        </div>
        <div>
          <div className={`text-lg font-bold flex items-center justify-center gap-0.5 ${isPositive ? "text-bullish" : "text-bearish"}`} data-testid="text-paper-return">
            {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            {isPositive ? "+" : "-"}{sym}{Math.abs(account.totalReturn).toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            P&L ({isPositive ? "+" : ""}{account.returnPercent.toFixed(1)}%)
          </div>
        </div>
        <div>
          <div className="text-lg font-bold" data-testid="text-paper-starting">
            {sym}{account.startingBalance.toFixed(0)}
          </div>
          <div className="text-[10px] text-muted-foreground">Starting</div>
        </div>
        <div>
          <div className="text-lg font-bold text-bearish" data-testid="text-paper-drawdown">
            {account.maxDrawdown.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">Max DD <InfoTooltip text="Largest drop from peak balance to lowest point. Lower is better." /></div>
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground text-center mt-1">
        {account.closedTradeCount} closed | {account.openTradeCount} open | Risk: {account.riskPercent}% per trade
      </div>

      {showSettings && (
        <div className="mt-3 p-3 rounded-md bg-background border space-y-3" data-testid="panel-paper-settings">
          <div className="text-xs font-medium">Paper Account Settings</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-[140px]">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Risk/Trade:</span>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                max="5"
                placeholder={`${account.riskPercent}%`}
                value={newRiskPercent}
                onChange={(e) => setNewRiskPercent(e.target.value)}
                className="w-16"
                data-testid="input-paper-risk"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const risk = parseFloat(newRiskPercent);
                if (risk >= 0.5 && risk <= 5) {
                  setupMutation.mutate({ riskPercent: risk });
                  setNewRiskPercent("");
                }
              }}
              disabled={setupMutation.isPending || !newRiskPercent}
              data-testid="button-paper-risk-save"
            >
              Update Risk
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Risk per trade controls position sizing (0.5% - 5%). Does not reset account.
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-medium">Reset Account</div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="number"
                placeholder={`Starting balance (${sym})`}
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                className="flex-1 min-w-[120px]"
                data-testid="input-paper-balance"
              />
              <Select
                value={newCurrency || account.currency}
                onValueChange={(val) => setNewCurrency(val)}
              >
                <SelectTrigger className="w-20" data-testid="select-paper-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => {
                  const balance = parseFloat(newBalance);
                  if (balance >= 10 && balance <= 1000000) {
                    setupMutation.mutate({
                      startingBalance: balance,
                      currency: newCurrency || account.currency,
                    });
                  }
                }}
                disabled={setupMutation.isPending}
                data-testid="button-paper-save"
              >
                {setupMutation.isPending ? "Saving..." : "Set Balance"}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              This will reset your paper account. Min {sym}10, Max {sym}1,000,000.
            </div>
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Signal Scanner Pairs</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {simInstruments.length === 0
                ? "Trading all instruments. Tap to filter."
                : `Only trading: ${simInstruments.join(', ')}`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_SIMULATION_INSTRUMENTS.map(inst => {
                const isActive = simInstruments.length === 0 || simInstruments.includes(inst);
                const isFiltered = simInstruments.length > 0;
                return (
                  <Button
                    key={inst}
                    size="sm"
                    variant={isFiltered && isActive ? "default" : "outline"}
                    className={`text-xs toggle-elevate ${isFiltered && isActive ? "toggle-elevated" : ""}`}
                    onClick={async () => {
                      const current = simInstruments.length > 0 ? [...simInstruments] : [];
                      let updated: string[];
                      if (current.includes(inst)) {
                        updated = current.filter(i => i !== inst);
                      } else {
                        updated = [...current, inst];
                      }
                      setSimInstruments(updated);
                      try {
                        await fetch("/api/user/settings", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ simulationInstruments: updated.length > 0 ? updated : null }),
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
                      } catch {}
                    }}
                    data-testid={`button-sim-pair-${inst.toLowerCase()}`}
                  >
                    {inst}
                  </Button>
                );
              })}
            </div>
            {simInstruments.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={async () => {
                  setSimInstruments([]);
                  try {
                    await fetch("/api/user/settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ simulationInstruments: null }),
                    });
                    queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
                  } catch {}
                }}
                data-testid="button-clear-sim-filter"
              >
                Clear filter (trade all)
              </Button>
            )}
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Timeframe Filter</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {simTimeframes.length === 0
                ? "Trading all timeframes. Tap to filter."
                : `Only trading: ${simTimeframes.join(', ')}`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TIMEFRAMES.map(tf => {
                const isActive = simTimeframes.length === 0 || simTimeframes.includes(tf);
                const isFiltered = simTimeframes.length > 0;
                return (
                  <Button
                    key={tf}
                    size="sm"
                    variant={isFiltered && isActive ? "default" : "outline"}
                    className={`text-xs toggle-elevate ${isFiltered && isActive ? "toggle-elevated" : ""}`}
                    onClick={async () => {
                      const current = simTimeframes.length > 0 ? [...simTimeframes] : [];
                      let updated: string[];
                      if (current.includes(tf)) {
                        updated = current.filter(t => t !== tf);
                      } else {
                        updated = [...current, tf];
                      }
                      setSimTimeframes(updated);
                      try {
                        await fetch("/api/user/settings", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ simulationTimeframes: updated.length > 0 ? updated : null }),
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
                      } catch {}
                    }}
                    data-testid={`button-sim-tf-${tf}`}
                  >
                    {tf}
                  </Button>
                );
              })}
            </div>
            {simTimeframes.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={async () => {
                  setSimTimeframes([]);
                  try {
                    await fetch("/api/user/settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ simulationTimeframes: null }),
                    });
                    queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
                  } catch {}
                }}
                data-testid="button-clear-tf-filter"
              >
                Clear filter (trade all)
              </Button>
            )}
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Confidence Lot Boost</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Increase lot size on high-confidence signals. Capped at 3x max risk.
            </p>
            <div className="flex items-center gap-2">
              <select
                value={boostThreshold ?? ""}
                onChange={async (e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setBoostThreshold(val);
                  try {
                    await fetch("/api/user/settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ confidenceBoostThreshold: val }),
                    });
                    queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
                  } catch {}
                }}
                className="h-9 rounded-md border bg-background px-2 text-xs flex-1"
                data-testid="select-boost-threshold"
              >
                <option value="">Off</option>
                <option value="80">80%+</option>
                <option value="85">85%+</option>
                <option value="90">90%+</option>
              </select>
              <select
                value={boostMultiplier ?? ""}
                onChange={async (e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setBoostMultiplier(val);
                  try {
                    await fetch("/api/user/settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ confidenceBoostMultiplier: val }),
                    });
                    queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
                  } catch {}
                }}
                className="h-9 rounded-md border bg-background px-2 text-xs flex-1"
                data-testid="select-boost-multiplier"
              >
                <option value="">1x (normal)</option>
                <option value="1.5">1.5x lots</option>
                <option value="2">2x lots</option>
                <option value="3">3x lots</option>
              </select>
            </div>
            {boostThreshold && boostMultiplier && (
              <p className="text-[10px] text-green-400">
                Active: {boostMultiplier}x lot size on {boostThreshold}%+ confidence signals
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SimulationDashboard() {
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  const prevTradeIdsRef = useRef<Set<string>>(new Set());
  const prevTradeStatusRef = useRef<Map<string, string>>(new Map());

  const { data, isLoading } = useQuery<SimulationResponse>({
    queryKey: ["/api/simulation/stats"],
    refetchInterval: 10000,
  });

  const { data: trades } = useQuery<SimulatedTrade[]>({
    queryKey: ["/api/simulation/trades"],
    refetchInterval: 10000,
  });

  const { data: paperAccount } = useQuery<PaperAccountData>({
    queryKey: ["/api/paper-account"],
    refetchInterval: 10000,
  });

  const { data: oandaStatus } = useQuery<OandaStatusResponse>({
    queryKey: ["/api/oanda/status"],
    refetchInterval: 15000,
  });

  const { data: livePrices } = useQuery<LivePrice[]>({
    queryKey: ["/api/prices/live"],
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!trades) return;
    
    const currentIds = new Set(trades.map(t => t.id));
    const currentStatuses = new Map(trades.map(t => [t.id, t.status]));
    
    if (prevTradeIdsRef.current.size > 0) {
      for (const trade of trades) {
        if (!prevTradeIdsRef.current.has(trade.id) && trade.status === "open") {
          playIfEnabled(playTradeOpenedSound);
          break;
        }
      }
      
      for (const trade of trades) {
        const prevStatus = prevTradeStatusRef.current.get(trade.id);
        if (prevStatus === "open" && trade.status !== "open") {
          if ((trade.pnlPips || 0) > 0) {
            playIfEnabled(playTradeWonSound);
          } else {
            playIfEnabled(playTradeLostSound);
          }
          break;
        }
      }
    }
    
    prevTradeIdsRef.current = currentIds;
    prevTradeStatusRef.current = currentStatuses;
  }, [trades]);

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      return apiRequest("POST", "/api/simulation/toggle", { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/simulation/stats"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/simulation/update");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/simulation/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/simulation/trades"] });
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="card-simulation">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Trade Simulation</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const stats = data?.stats;
  const enabled = data?.enabled ?? true;
  const openTrades = trades?.filter(t => t.status === "open") || [];
  const recentClosed = trades?.filter(t => t.status !== "open")
    .sort((a, b) => new Date(b.closedAt || b.openedAt).getTime() - new Date(a.closedAt || a.openedAt).getTime())
    .slice(0, 5) || [];
  const oandaConnected = oandaStatus?.connected ?? false;
  const oandaTrades = oandaStatus?.openTrades || [];

  const priceMap: Record<string, { bid: number; ask: number }> = {};
  if (livePrices) {
    for (const p of livePrices) {
      priceMap[p.instrument] = { bid: p.bid, ask: p.ask };
    }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTrades = trades?.filter(t => {
    const openedDate = new Date(t.openedAt);
    const closedDate = t.closedAt ? new Date(t.closedAt) : null;
    const isClosedToday = closedDate ? closedDate >= todayStart : (t.status !== "open" && openedDate >= todayStart);
    return openedDate >= todayStart || isClosedToday;
  }) || [];
  const todayClosed = todayTrades.filter(t => {
    if (t.status === "open") return false;
    const closedDate = t.closedAt ? new Date(t.closedAt) : null;
    if (closedDate) return closedDate >= todayStart;
    return new Date(t.openedAt) >= todayStart;
  });
  const todayWins = todayClosed.filter(t => (t.pnlPips || 0) > 0).length;
  const todayLosses = todayClosed.filter(t => (t.pnlPips || 0) <= 0).length;
  const todayPnl = todayClosed.reduce((sum, t) => sum + (t.pnlPips ?? 0), 0);
  const todayPnlMoney = todayClosed.reduce((sum, t) => sum + (t.pnlMoney ?? 0), 0);
  const todayOpen = todayTrades.filter(t => t.status === "open").length;
  const acctSym = paperAccount ? (CURRENCY_SYMBOLS[paperAccount.currency] || paperAccount.currency) : "";

  return (
    <Card data-testid="card-simulation">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Trade Simulation
          </CardTitle>
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setSoundEnabled(next);
              }}
              data-testid="button-toggle-sound"
            >
              {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              data-testid="button-update-sim"
            >
              {updateMutation.isPending ? "Updating..." : "Check Prices"}
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Auto-Trade</span>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                data-testid="switch-simulation"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled && (
          <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
            Simulation is disabled. Enable to auto-track signal performance.
          </div>
        )}

        {/* Paper Account */}
        <PaperAccountPanel />

        {/* Daily Performance Summary */}
        {todayTrades.length > 0 && (
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">TODAY'S PERFORMANCE</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-lg font-bold" data-testid="text-today-trades">{todayTrades.length}</div>
                <div className="text-[10px] text-muted-foreground">Trades</div>
              </div>
              <div>
                <div className="text-lg font-bold text-bullish" data-testid="text-today-wins">{todayWins}</div>
                <div className="text-[10px] text-muted-foreground">Wins</div>
              </div>
              <div>
                <div className="text-lg font-bold text-bearish" data-testid="text-today-losses">{todayLosses}</div>
                <div className="text-[10px] text-muted-foreground">Losses</div>
              </div>
              <div>
                <div className={`text-lg font-bold ${todayPnl >= 0 ? "text-bullish" : "text-bearish"}`} data-testid="text-today-pnl">
                  {todayPnlMoney !== 0 ? (
                    <>{todayPnlMoney >= 0 ? "+" : "-"}{acctSym}{Math.abs(todayPnlMoney).toFixed(2)}</>
                  ) : (
                    <>{todayPnl >= 0 ? "+" : ""}{todayPnl.toFixed(1)}</>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {todayPnlMoney !== 0 ? `${todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(1)} pips` : "Pips"}
                </div>
              </div>
            </div>
            {todayOpen > 0 && (
              <div className="text-[10px] text-muted-foreground text-center mt-1">
                {todayOpen} trade{todayOpen > 1 ? "s" : ""} still open
              </div>
            )}
          </div>
        )}

        {/* Stats Overview */}
        {stats && stats.totalTrades > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-xs text-muted-foreground mb-1">TOTAL TRADES</div>
                <div className="text-2xl font-bold" data-testid="text-total-trades">{stats.totalTrades}</div>
                <div className="text-xs text-muted-foreground">
                  {stats.openTrades} open
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">WIN RATE <InfoTooltip text="Percentage of trades that ended in profit. Above 50% means you win more often than you lose." /></div>
                <div className={`text-2xl font-bold ${stats.winRate >= 50 ? "text-bullish" : "text-bearish"}`} data-testid="text-win-rate">
                  {stats.winRate.toFixed(1)}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats.wins}W / {stats.losses}L
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-xs text-muted-foreground mb-1">TOTAL P/L</div>
                <div className={`text-2xl font-bold ${stats.totalPnlPips >= 0 ? "text-bullish" : "text-bearish"}`} data-testid="text-total-pnl">
                  {stats.totalPnlPips >= 0 ? "+" : ""}{stats.totalPnlPips.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground">pips</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">PROFIT FACTOR <InfoTooltip text="Gross profits divided by gross losses. Above 1.5 is good, above 2.0 is excellent." /></div>
                <div className={`text-2xl font-bold ${(stats.profitFactor ?? 0) >= 1 ? "text-bullish" : "text-bearish"}`} data-testid="text-profit-factor">
                  {stats.profitFactor === null ? "N/A" : stats.profitFactor === Infinity ? "\u221E" : stats.profitFactor.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats.profitFactor === null ? "No losses yet" : stats.profitFactor >= 1.5 ? "Good" : stats.profitFactor >= 1 ? "Break even" : "Needs work"}
                </div>
              </div>
            </div>

            {/* Average Win/Loss */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-bullish/10 border border-bullish/20">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-bullish" />
                  <span className="text-xs font-medium text-bullish">AVG WIN</span>
                </div>
                <div className="text-lg font-bold text-bullish">
                  +{stats.avgWinPips.toFixed(1)} pips
                </div>
                <div className="text-xs text-muted-foreground">
                  Best: +{stats.bestTradePips.toFixed(1)} pips
                </div>
              </div>
              <div className="p-3 rounded-lg bg-bearish/10 border border-bearish/20">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-4 h-4 text-bearish" />
                  <span className="text-xs font-medium text-bearish">AVG LOSS</span>
                </div>
                <div className="text-lg font-bold text-bearish">
                  {stats.avgLossPips.toFixed(1)} pips
                </div>
                <div className="text-xs text-muted-foreground">
                  Worst: {stats.worstTradePips.toFixed(1)} pips
                </div>
              </div>
            </div>

            {/* Performance by Instrument */}
            {Object.keys(stats.byInstrument).length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">BY INSTRUMENT</div>
                <div className="space-y-1">
                  {Object.entries(stats.byInstrument).map(([inst, data]) => (
                    <div key={inst} className="flex items-center justify-between p-2 rounded bg-muted/20">
                      <span className="font-medium text-sm">{inst}</span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className={data.winRate >= 50 ? "text-bullish" : "text-bearish"}>
                          {data.winRate.toFixed(0)}% WR
                        </span>
                        <span className={data.pnlPips >= 0 ? "text-bullish" : "text-bearish"}>
                          {data.pnlPips >= 0 ? "+" : ""}{data.pnlPips.toFixed(1)} pips
                        </span>
                        <span className="text-muted-foreground">
                          {data.total} trades
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No simulated trades yet</p>
            <p className="text-xs">View instrument analysis to generate signals and start tracking</p>
          </div>
        )}

        {/* Guardian Status & OANDA Live Trades */}
        {oandaConnected && <GuardianBanner />}
        {oandaConnected && oandaTrades.length > 0 && (
          <OandaTradesSection trades={oandaTrades} />
        )}

        {/* Open Simulated Trades */}
        {openTrades.length > 0 && (
          <OpenTradesSection
            trades={openTrades}
            priceMap={priceMap}
            accountCurrency={paperAccount?.currency || "GBP"}
          />
        )}

        {/* Recent Closed Trades */}
        {recentClosed.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">RECENT CLOSED</div>
            <div className="space-y-1">
              {recentClosed.map((trade) => (
                <ClosedTradeRow key={trade.id} trade={trade} />
              ))}
            </div>
          </div>
        )}

        {/* Learning Insights */}
        <LearningInsights />
      </CardContent>
    </Card>
  );
}

function GuardianBanner() {
  const { data: guardianStatus } = useQuery<{
    enabled: boolean;
    maxTradeDurationHours: number;
    dailyLossLimitPercent: number;
    isNewTradesPaused: boolean;
  }>({
    queryKey: ["/api/oanda/guardian/status"],
    refetchInterval: 30000,
  });

  if (!guardianStatus) return null;

  return (
    <div className={`flex items-center gap-2 p-2 rounded text-xs ${
      guardianStatus.isNewTradesPaused 
        ? "bg-destructive/10 border border-destructive/30 text-destructive" 
        : "bg-muted/20"
    }`} data-testid="guardian-banner">
      <Shield className="w-3 h-3 flex-shrink-0" />
      {guardianStatus.isNewTradesPaused ? (
        <span className="font-medium">Daily loss limit hit - new trades paused. Existing trades running with SL/TP.</span>
      ) : (
        <span className="text-muted-foreground">
          Guardian active: max {guardianStatus.maxTradeDurationHours}h, {guardianStatus.dailyLossLimitPercent}% daily limit
        </span>
      )}
    </div>
  );
}

function OandaTradesSection({ trades }: { trades: OandaTrade[] }) {
  const [killConfirm, setKillConfirm] = useState(false);
  const [killing, setKilling] = useState(false);
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);

  const killAll = async () => {
    setKilling(true);
    try {
      await apiRequest("POST", "/api/oanda/emergency-close-all");
      queryClient.invalidateQueries({ queryKey: ["/api/oanda/status"] });
    } catch (err) {
      console.error("Emergency close failed:", err);
    } finally {
      setKilling(false);
      setKillConfirm(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Globe className="w-3 h-3 text-primary" />
          <span className="text-xs font-medium">OANDA LIVE TRADES ({trades.length})</span>
          <Badge variant="outline" className="text-xs">Live</Badge>
        </div>
        {killConfirm ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-xs"
              onClick={killAll}
              disabled={killing}
              data-testid="btn-confirm-kill-all"
            >
              {killing ? <Loader2 className="w-3 h-3 animate-spin" /> : `CLOSE ALL ${trades.length}`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1"
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
            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => setKillConfirm(true)}
            data-testid="btn-kill-switch"
          >
            <Power className="w-3 h-3 mr-1" />
            Kill All
          </Button>
        )}
      </div>
      <div className="space-y-1">
        {trades.map((trade) => (
          <OandaTradeRow
            key={trade.id}
            trade={trade}
            isExpanded={expandedTradeId === trade.id}
            onToggleExpand={() => setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)}
          />
        ))}
      </div>
    </div>
  );
}

function OandaTradeRow({ trade, isExpanded, onToggleExpand }: { trade: OandaTrade; isExpanded: boolean; onToggleExpand: () => void }) {
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const isMetal = trade.instrument.includes("XAU") || trade.instrument.includes("XAG") || trade.instrument.includes("Gold") || trade.instrument.includes("Silver");
  const instrument = trade.instrument.replace("_", "").replace("XAU_USD", "XAUUSD");
  const decimals = isMetal ? 2 : 5;
  const isBuy = trade.direction === "buy";
  const pnl = trade.unrealizedPL;

  const ageHours = trade.openTime 
    ? ((Date.now() - new Date(trade.openTime).getTime()) / (1000 * 60 * 60)).toFixed(1)
    : null;

  const closeTrade = async () => {
    setClosing(true);
    try {
      await apiRequest("POST", `/api/oanda/close/${trade.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/oanda/status"] });
    } catch (err) {
      console.error("Failed to close trade:", err);
    } finally {
      setClosing(false);
      setConfirmClose(false);
    }
  };

  return (
    <div className="flex flex-col rounded bg-muted/30 text-sm border border-primary/20" data-testid={`row-oanda-trade-${trade.id}`}>
      <div
        className="flex flex-col gap-1 p-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggleExpand}
        data-testid={`btn-expand-oanda-${trade.id}`}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            <Badge variant="outline" className={isBuy ? "border-bullish text-bullish" : "border-bearish text-bearish"}>
              {isBuy ? "BUY" : "SELL"}
            </Badge>
            <span className="font-medium">{instrument}</span>
            {trade.timeframe && (
              <span className="text-xs text-muted-foreground font-medium">{trade.timeframe}</span>
            )}
            <Badge variant="outline" className="text-xs text-primary border-primary/30">OANDA</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className={`font-mono font-medium ${pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
            </span>
            {confirmClose ? (
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-xs"
                  onClick={closeTrade}
                  disabled={closing}
                  data-testid={`btn-confirm-close-${trade.id}`}
                >
                  {closing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Close"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1"
                  onClick={() => setConfirmClose(false)}
                  data-testid={`btn-cancel-close-${trade.id}`}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-bearish"
                onClick={(e) => { e.stopPropagation(); setConfirmClose(true); }}
                data-testid={`btn-close-trade-${trade.id}`}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>Entry: {trade.entryPrice.toFixed(decimals)}</span>
          {trade.stopLoss && <span className="text-bearish">SL: {trade.stopLoss.toFixed(decimals)}</span>}
          {trade.takeProfit && <span className="text-bullish">TP: {trade.takeProfit.toFixed(decimals)}</span>}
          <span>{trade.lotSize ? `${trade.lotSize} lots` : `${Math.abs(trade.units)} units`}</span>
          {trade.openTime && <span>{formatTradeTime(trade.openTime)}</span>}
          {ageHours && <span className={parseFloat(ageHours) > 8 ? "text-amber-500 font-medium" : ""}>{ageHours}h</span>}
        </div>
      </div>
      {isExpanded && (
        <div className="px-2 pb-2" data-testid={`chart-oanda-trade-${trade.id}`}>
          <div className="h-[250px] md:h-[300px]">
            <TradeChart
              instrument={instrument as Instrument}
              timeframe={(trade.timeframe || "15m") as Timeframe}
              mode="oanda-only"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function OpenTradesSection({ trades, priceMap, accountCurrency }: {
  trades: SimulatedTrade[];
  priceMap: Record<string, { bid: number; ask: number }>;
  accountCurrency: string;
}) {
  const [expandedTradeId, setExpandedTradeId] = useState<number | null>(null);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-3 h-3 text-primary" />
        <span className="text-xs font-medium">OPEN POSITIONS ({trades.length})</span>
      </div>
      <div className="space-y-1">
        {trades.map((trade) => (
          <OpenTradeRow
            key={trade.id}
            trade={trade}
            priceData={priceMap[trade.instrument]}
            accountCurrency={accountCurrency}
            isExpanded={expandedTradeId === trade.id}
            onToggleExpand={() => setExpandedTradeId(expandedTradeId === trade.id ? null : trade.id)}
          />
        ))}
      </div>
    </div>
  );
}

function OpenTradeRow({ trade, priceData, accountCurrency, isExpanded, onToggleExpand }: { 
  trade: SimulatedTrade; 
  priceData?: { bid: number; ask: number };
  accountCurrency: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const isMetal = trade.instrument === "XAUUSD" || trade.instrument === "XAGUSD";
  const decimals = isMetal ? 2 : 5;
  const isBuy = trade.direction === "buy";

  const currentPrice = priceData
    ? (isBuy ? priceData.bid : priceData.ask)
    : null;

  const unrealized = currentPrice
    ? calculateUnrealizedPnL(trade, currentPrice, accountCurrency)
    : null;

  const sym = CURRENCY_SYMBOLS[accountCurrency] || accountCurrency;

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await apiRequest("POST", `/api/simulation/trades/${trade.id}/close`);
      queryClient.invalidateQueries({ queryKey: ["/api/simulation/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/simulation/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/paper-account"] });
    } catch {
      setClosing(false);
    }
  };

  return (
    <div className="flex flex-col rounded bg-muted/30 text-sm" data-testid={`row-sim-trade-${trade.id}`}>
      <div
        className="flex flex-col gap-1 p-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggleExpand}
        data-testid={`btn-expand-sim-${trade.id}`}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            <Badge variant="outline" className={isBuy ? "border-bullish text-bullish" : "border-bearish text-bearish"}>
              {isBuy ? "BUY" : "SELL"}
            </Badge>
            <span className="font-medium">{trade.instrument}</span>
            <span className="text-xs text-muted-foreground">{trade.timeframe}</span>
            {trade.oandaTradeId && (
              <Badge variant="outline" className="text-xs text-primary border-primary/30">OANDA</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unrealized ? (
              <div className="flex flex-col items-end" data-testid={`text-trade-pnl-${trade.id}`}>
                <span className={`font-mono font-bold ${unrealized.money >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {unrealized.money >= 0 ? "+" : "-"}{sym}{Math.abs(unrealized.money).toFixed(2)}
                </span>
                <span className={`font-mono text-xs ${unrealized.pips >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {unrealized.pips >= 0 ? "+" : ""}{unrealized.pips.toFixed(1)} pips
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-xs">
                <span>Entry: {trade.entryPrice.toFixed(decimals)}</span>
              </div>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
              disabled={closing}
              data-testid={`button-close-trade-${trade.id}`}
            >
              <XCircle className="w-4 h-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
          <span>Entry: {trade.entryPrice.toFixed(decimals)}</span>
          {currentPrice && (
            <span className={`font-medium ${unrealized && unrealized.pips >= 0 ? "text-bullish" : "text-bearish"}`} data-testid={`text-trade-current-price-${trade.id}`}>
              Now: {currentPrice.toFixed(decimals)}
            </span>
          )}
          <span className="text-bearish">SL: {(trade.stopLoss || 0).toFixed(decimals)}</span>
          <span className="text-bullish">TP: {(trade.takeProfit1 || 0).toFixed(decimals)}</span>
        </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            <span data-testid={`text-trade-opened-${trade.id}`}>Opened: {formatTradeTime(trade.openedAt)}</span>
            <span data-testid={`text-trade-duration-${trade.id}`}>Duration: {formatDuration(trade.openedAt)}</span>
            {trade.lotSize && <span data-testid={`text-trade-lot-${trade.id}`}>{trade.lotSize} lot{trade.lotSize !== 1 ? "s" : ""}</span>}
            <div className="flex items-center gap-1">
              {trade.breakEvenApplied && (
                <Badge variant="secondary" className="text-[10px] py-0 bg-green-500/10 text-green-500 border-green-500/20">
                  {trade.halfProfitLocked ? "LOCKED 70%" : "BE"}
                </Badge>
              )}
              {trade.oandaTradeId && (
                <Badge variant="secondary" className="text-[10px] py-0 bg-amber-500/10 text-amber-500 border-amber-500/20">
                  LIVE
                </Badge>
              )}
            </div>
          </div>
      </div>
      {isExpanded && (
        <div className="px-2 pb-2" data-testid={`chart-sim-trade-${trade.id}`}>
          <div className="h-[250px] md:h-[300px]">
            <TradeChart
              instrument={trade.instrument as Instrument}
              timeframe={(trade.timeframe || "15m") as Timeframe}
              mode={trade.oandaTradeId ? "oanda-only" : "paper-only"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ClosedTradeRow({ trade }: { trade: SimulatedTrade }) {
  const isWin = (trade.pnlPips || 0) > 0;
  const isBuy = trade.direction === "buy";

  const statusLabel = trade.status === "tp1_hit" ? "TP1" :
                      trade.status === "tp2_hit" ? "TP2" :
                      trade.status === "sl_hit" ? "SL" :
                      trade.status === "manual_close" ? "Manual" : trade.status;

  return (
    <div className="flex flex-col gap-1 p-2 rounded bg-muted/20 text-sm" data-testid={`row-closed-trade-${trade.id}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {isWin ? (
            <CheckCircle2 className="w-4 h-4 text-bullish" />
          ) : (
            <XCircle className="w-4 h-4 text-bearish" />
          )}
          <span className="font-medium">{trade.instrument}</span>
          <Badge variant="outline" className={isBuy ? "text-bullish border-bullish/50" : "text-bearish border-bearish/50"}>
            {isBuy ? "B" : "S"}
          </Badge>
          <span className="text-xs text-muted-foreground">{trade.timeframe}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isWin ? "default" : "destructive"} className="text-xs">
            {statusLabel}
          </Badge>
          <div className="flex flex-col items-end">
            {trade.pnlMoney !== undefined && (
              <span className={`font-mono font-bold ${isWin ? "text-bullish" : "text-bearish"}`}>
                {trade.pnlMoney >= 0 ? "+" : ""}{trade.pnlMoney.toFixed(2)}
              </span>
            )}
            <span className={`font-mono text-xs ${isWin ? "text-bullish" : "text-bearish"}`}>
              {trade.pnlPips !== undefined ? (
                <>{trade.pnlPips >= 0 ? "+" : ""}{trade.pnlPips.toFixed(1)} pips</>
              ) : "-"}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
        <span data-testid={`text-trade-opened-${trade.id}`}>Opened: {formatTradeTime(trade.openedAt)}</span>
        {trade.closedAt && (
          <span data-testid={`text-trade-closed-${trade.id}`}>Closed: {formatTradeTime(trade.closedAt)}</span>
        )}
        <span data-testid={`text-trade-duration-${trade.id}`}>Duration: {formatDuration(trade.openedAt, trade.closedAt || undefined)}</span>
        {trade.lotSize && <span>{trade.lotSize} lot{trade.lotSize !== 1 ? "s" : ""}</span>}
      </div>
    </div>
  );
}
