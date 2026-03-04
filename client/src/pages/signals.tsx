import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  Clock,
  RefreshCw,
  Radio,
  ChevronLeft,
  ChevronRight,
  Trophy,
  XCircle,
  Timer,
  BarChart3,
  Zap,
  Medal,
  ChevronDown,
  ChevronUp,
  Filter,
} from "lucide-react";
import { checkForNewSignals } from "@/lib/notifications";
import { TradeSignalCard } from "@/components/trade-signal-card";
import type { TradeSignal } from "@shared/schema";

interface SignalHistoryRecord {
  id: string;
  instrument: string;
  timeframe: string;
  direction: string;
  confidence: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  riskRewardRatio: number;
  reasoning: string[];
  marketState: string | null;
  trendStrength: number | null;
  volatility: string | null;
  outcome: string | null;
  outcomePrice: number | null;
  outcomeTime: string | null;
  generatedAt: string;
  expiresAt: string | null;
}

interface DailyResponse {
  date: string;
  signals: SignalHistoryRecord[];
  stats: {
    total: number;
    wins: number;
    losses: number;
    pending: number;
    winRate: number;
    totalPips: number;
  };
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatPrice(price: number | null | undefined, instrument: string): string {
  const p = price ?? 0;
  if (instrument === "XAUUSD") return p.toFixed(2);
  if (instrument === "XAGUSD") return p.toFixed(4);
  if (instrument.includes("JPY")) return p.toFixed(3);
  return p.toFixed(5);
}

function HistorySignalCard({ signal }: { signal: SignalHistoryRecord }) {
  const isBuy = signal.direction === "buy";
  const pipSize = signal.instrument === "XAUUSD" ? 0.1 : signal.instrument === "XAGUSD" ? 0.01 : signal.instrument.includes("JPY") ? 0.01 : 0.0001;
  const entryMid = (signal.entryLow + signal.entryHigh) / 2;

  let pnlPips: number | null = null;
  if (signal.outcomePrice) {
    pnlPips = isBuy
      ? (signal.outcomePrice - entryMid) / pipSize
      : (entryMid - signal.outcomePrice) / pipSize;
    pnlPips = Math.round(pnlPips * 10) / 10;
  }

  const outcomeBadge = () => {
    if (!signal.outcome) {
      return <Badge variant="outline" className="text-yellow-500 border-yellow-500/30" data-testid={`badge-outcome-pending-${signal.id}`}><Timer className="h-3 w-3 mr-1" />Pending</Badge>;
    }
    if (signal.outcome === "tp1_hit" || signal.outcome === "tp2_hit") {
      return <Badge className="bg-green-500/20 text-green-500 border-green-500/30" data-testid={`badge-outcome-win-${signal.id}`}><Trophy className="h-3 w-3 mr-1" />TP Hit</Badge>;
    }
    if (signal.outcome === "managed_close") {
      return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30" data-testid={`badge-outcome-managed-${signal.id}`}><Trophy className="h-3 w-3 mr-1" />Managed</Badge>;
    }
    if (signal.outcome === "sl_hit") {
      return <Badge className="bg-red-500/20 text-red-500 border-red-500/30" data-testid={`badge-outcome-loss-${signal.id}`}><XCircle className="h-3 w-3 mr-1" />SL Hit</Badge>;
    }
    return <Badge variant="secondary" data-testid={`badge-outcome-expired-${signal.id}`}>Expired</Badge>;
  };

  const time = new Date(signal.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <Card className="border-border/50" data-testid={`card-history-signal-${signal.id}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={isBuy ? "default" : "destructive"} className="text-xs">
              {isBuy ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
              {signal.direction.toUpperCase()}
            </Badge>
            <span className="font-semibold text-sm">{signal.instrument}</span>
            <Badge variant="outline" className="text-xs">{signal.timeframe}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {outcomeBadge()}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Entry</span>
            <div className="font-medium">{formatPrice(entryMid, signal.instrument)}</div>
          </div>
          <div>
            <span className="text-muted-foreground">SL</span>
            <div className="font-medium text-red-500">{formatPrice(signal.stopLoss, signal.instrument)}</div>
          </div>
          <div>
            <span className="text-muted-foreground">TP1</span>
            <div className="font-medium text-green-500">{formatPrice(signal.takeProfit1, signal.instrument)}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Confidence</span>
            <div className={`font-bold ${signal.confidence >= 80 ? "text-green-500" : signal.confidence >= 60 ? "text-yellow-500" : "text-muted-foreground"}`}>{signal.confidence}%</div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {time}
          </div>
          {pnlPips !== null && (
            <span className={`font-semibold ${pnlPips >= 0 ? "text-green-500" : "text-red-500"}`} data-testid={`text-pnl-${signal.id}`}>
              {pnlPips >= 0 ? "+" : ""}{pnlPips} pips
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface InstrumentStats {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPips: number;
  avgPips: number;
  bestPips: number;
  worstPips: number;
  rating: string;
  byTimeframe?: Record<string, InstrumentStats>;
}

interface HistoryStatsResponse {
  totalSignals: number;
  signalsWithOutcome: number;
  pendingSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPips: number;
  byInstrument: Record<string, InstrumentStats>;
}

function getRatingColor(rating: string) {
  switch (rating) {
    case "Excellent": return "text-green-400 bg-green-500/15 border-green-500/30";
    case "Good": return "text-blue-400 bg-blue-500/15 border-blue-500/30";
    case "Average": return "text-yellow-400 bg-yellow-500/15 border-yellow-500/30";
    case "Poor": return "text-red-400 bg-red-500/15 border-red-500/30";
    default: return "text-muted-foreground bg-muted/50 border-border";
  }
}

function PairScoreboard({ data }: { data: HistoryStatsResponse }) {
  const [expandedPair, setExpandedPair] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"winRate" | "totalPips" | "total">("totalPips");

  const pairs = Object.entries(data.byInstrument)
    .sort((a, b) => {
      if (sortBy === "winRate") return b[1].winRate - a[1].winRate;
      if (sortBy === "totalPips") return b[1].totalPips - a[1].totalPips;
      return b[1].total - a[1].total;
    });

  if (pairs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Medal className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-base font-medium mb-1">No Signal History Yet</h3>
          <p className="text-muted-foreground text-sm">Performance data will appear once signals start resolving.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="mb-3">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-xl font-bold text-primary" data-testid="text-overall-signals">{data.signalsWithOutcome}</div>
              <div className="text-xs text-muted-foreground">Resolved</div>
            </div>
            <div>
              <div className="text-xl font-bold text-green-500" data-testid="text-overall-winrate">{data.winRate}%</div>
              <div className="text-xs text-muted-foreground">Win Rate</div>
            </div>
            <div>
              <div className={`text-xl font-bold ${data.totalPips >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-overall-pips">
                {data.totalPips >= 0 ? "+" : ""}{data.totalPips}
              </div>
              <div className="text-xs text-muted-foreground">Total Pips</div>
            </div>
            <div>
              <div className="text-xl font-bold text-primary" data-testid="text-overall-pairs">{pairs.length}</div>
              <div className="text-xs text-muted-foreground">Active Pairs</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-1 mb-2">
        {(["totalPips", "winRate", "total"] as const).map((key) => (
          <Button
            key={key}
            variant={sortBy === key ? "default" : "ghost"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setSortBy(key)}
            data-testid={`button-sort-${key}`}
          >
            {key === "totalPips" ? "Pips" : key === "winRate" ? "Win %" : "Trades"}
          </Button>
        ))}
      </div>

      <div className="space-y-2">
        {pairs.map(([instrument, stats]) => {
          const isExpanded = expandedPair === instrument;
          const tfEntries = stats.byTimeframe ? Object.entries(stats.byTimeframe) : [];

          return (
            <Card key={instrument} className="border-border/50 overflow-hidden" data-testid={`card-pair-${instrument}`}>
              <CardContent className="p-0">
                <button
                  className="w-full p-3 sm:p-4 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedPair(isExpanded ? null : instrument)}
                  data-testid={`button-expand-${instrument}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm whitespace-nowrap">{instrument}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 ${getRatingColor(stats.rating)}`} data-testid={`badge-rating-${instrument}`}>
                        {stats.rating}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="hidden sm:inline text-muted-foreground">{stats.total} trades</span>
                      <span className="text-green-500 font-medium">{stats.wins}W</span>
                      <span className="text-red-500 font-medium">{stats.losses}L</span>
                      <span className={`font-bold ${stats.winRate >= 55 ? "text-green-500" : stats.winRate >= 40 ? "text-yellow-500" : "text-red-500"}`}>
                        {stats.winRate}%
                      </span>
                      <span className={`font-bold ${stats.totalPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {stats.totalPips >= 0 ? "+" : ""}{stats.totalPips}p
                      </span>
                      {tfEntries.length > 0 && (
                        isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-muted-foreground">
                    <div>Avg: <span className={`font-medium ${stats.avgPips >= 0 ? "text-green-500" : "text-red-500"}`}>{stats.avgPips >= 0 ? "+" : ""}{stats.avgPips}p</span></div>
                    <div>Best: <span className="font-medium text-green-500">+{stats.bestPips}p</span></div>
                    <div>Worst: <span className="font-medium text-red-500">{stats.worstPips}p</span></div>
                  </div>
                </button>

                {isExpanded && tfEntries.length > 0 && (
                  <div className="border-t border-border/50 bg-muted/20 p-3 space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground mb-1">By Timeframe</div>
                    {tfEntries
                      .sort((a, b) => b[1].totalPips - a[1].totalPips)
                      .map(([tf, tfStats]) => (
                        <div key={tf} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-background/50" data-testid={`row-tf-${instrument}-${tf}`}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{tf}</Badge>
                            <Badge className={`text-[10px] px-1.5 py-0 ${getRatingColor(tfStats.rating)}`}>{tfStats.rating}</Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{tfStats.total}t</span>
                            <span className="text-green-500">{tfStats.wins}W</span>
                            <span className="text-red-500">{tfStats.losses}L</span>
                            <span className={`font-medium ${tfStats.winRate >= 55 ? "text-green-500" : tfStats.winRate >= 40 ? "text-yellow-500" : "text-red-500"}`}>{tfStats.winRate}%</span>
                            <span className={`font-bold ${tfStats.totalPips >= 0 ? "text-green-500" : "text-red-500"}`}>{tfStats.totalPips >= 0 ? "+" : ""}{tfStats.totalPips}p</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

type TypeFilter = "all" | "forex" | "metals";
type DirectionFilter = "all" | "buy" | "sell";
type TimeframeFilter = "all" | "1m" | "5m" | "15m" | "1h" | "4h" | "1D" | "1W" | "1M";

const METAL_INSTRUMENTS = ["XAUUSD", "XAGUSD"];

function filterSignals<T extends TradeSignal>(
  signals: T[],
  typeFilter: TypeFilter,
  directionFilter: DirectionFilter,
  timeframeFilter: TimeframeFilter,
): T[] {
  return signals.filter((s) => {
    if (typeFilter === "metals" && !METAL_INSTRUMENTS.includes(s.instrument)) return false;
    if (typeFilter === "forex" && METAL_INSTRUMENTS.includes(s.instrument)) return false;
    if (directionFilter !== "all" && s.direction !== directionFilter) return false;
    if (timeframeFilter !== "all" && s.timeframe !== timeframeFilter) return false;
    return true;
  });
}

export default function SignalsPage() {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [timeframeFilter, setTimeframeFilter] = useState<TimeframeFilter>("all");

  const { data: activeData, isLoading: activeLoading, refetch, isFetching } = useQuery<{ signals: (TradeSignal & { signalScore?: number; isTopPick?: boolean; pairWinRate?: number; pairTotalTrades?: number })[] }>({
    queryKey: ["/api/signals/active"],
    refetchInterval: 30000,
  });

  const { data: historyStats, isLoading: statsLoading } = useQuery<HistoryStatsResponse>({
    queryKey: ["/api/signals/history/stats"],
    refetchInterval: 120000,
  });

  const { data: dailyData, isLoading: dailyLoading } = useQuery<DailyResponse>({
    queryKey: ["/api/signals/daily", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/signals/daily?date=${selectedDate}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: selectedDate === new Date().toISOString().split("T")[0] ? 60000 : false,
  });

  const allActiveSignals = activeData?.signals || [];
  const activeSignals = filterSignals(allActiveSignals, typeFilter, directionFilter, timeframeFilter);
  const hasActiveFilters = typeFilter !== "all" || directionFilter !== "all" || timeframeFilter !== "all";
  const historySignals = dailyData?.signals?.filter(s => s.direction !== "stand_aside") || [];
  const stats = dailyData?.stats;

  const goDay = (offset: number) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + offset);
    const newDate = d.toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    if (newDate <= today) setSelectedDate(newDate);
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Signals Hub</h1>
          <p className="text-muted-foreground text-sm">Live signals across all timeframes — trade directly or review history</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-signals"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Active Signals</h2>
          {allActiveSignals.length > 0 && (
            <Badge variant="default" className="ml-1" data-testid="badge-active-count">{allActiveSignals.length}</Badge>
          )}
        </div>

        {!activeLoading && allActiveSignals.length > 0 && (
          <div className="mb-3 space-y-2" data-testid="filter-panel">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs text-muted-foreground mr-1">Type</span>
                {(["all", "forex", "metals"] as const).map((val) => (
                  <Button
                    key={val}
                    variant={typeFilter === val ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTypeFilter(val)}
                    data-testid={`button-filter-type-${val}`}
                  >
                    {val === "all" ? "All" : val === "forex" ? "Forex" : "Metals"}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs text-muted-foreground mr-1">Direction</span>
                {(["all", "buy", "sell"] as const).map((val) => (
                  <Button
                    key={val}
                    variant={directionFilter === val ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDirectionFilter(val)}
                    data-testid={`button-filter-direction-${val}`}
                  >
                    {val === "all" ? "All" : val === "buy" ? "Buy" : "Sell"}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs text-muted-foreground mr-1">Timeframe</span>
                {(["all", "1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"] as const).map((val) => (
                  <Button
                    key={val}
                    variant={timeframeFilter === val ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTimeframeFilter(val)}
                    data-testid={`button-filter-tf-${val}`}
                  >
                    {val === "all" ? "All" : val}
                  </Button>
                ))}
              </div>
            </div>
            {hasActiveFilters && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground" data-testid="text-filter-count">
                  Showing {activeSignals.length} of {allActiveSignals.length} signals
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setTypeFilter("all"); setDirectionFilter("all"); setTimeframeFilter("all"); }}
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        )}

        {activeLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : activeSignals.length === 0 && !hasActiveFilters ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Radio className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="text-base font-medium mb-1">No Active Signals</h3>
              <p className="text-muted-foreground text-sm">
                Waiting for trading opportunities across all timeframes. The scanner runs every 60 seconds.
              </p>
            </CardContent>
          </Card>
        ) : activeSignals.length === 0 && hasActiveFilters ? (
          <Card>
            <CardContent className="py-6 text-center" data-testid="text-no-filter-results">
              <p className="text-muted-foreground text-sm">No signals match your filters. Try adjusting or clearing filters above.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeSignals.map((signal) => (
              <TradeSignalCard 
                key={`${signal.instrument}_${signal.timeframe}`} 
                signal={signal}
                isTopPick={signal.isTopPick}
                signalScore={signal.signalScore}
                pairWinRate={signal.pairWinRate}
                pairTotalTrades={signal.pairTotalTrades}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Medal className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Pair Performance</h2>
        </div>

        {statsLoading ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ) : historyStats ? (
          <PairScoreboard data={historyStats} />
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Signal Log</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goDay(-1)} data-testid="button-prev-day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[80px] text-center" data-testid="text-selected-date">
              {formatDate(selectedDate)}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goDay(1)} disabled={isToday} data-testid="button-next-day">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {stats && stats.total > 0 && (
          <Card className="mb-4">
            <CardContent className="p-3 sm:p-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                <div>
                  <div className="text-xl font-bold text-primary" data-testid="text-stat-total">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">Signals</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-green-500" data-testid="text-stat-wins">{stats.wins}</div>
                  <div className="text-xs text-muted-foreground">Wins</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-red-500" data-testid="text-stat-losses">{stats.losses}</div>
                  <div className="text-xs text-muted-foreground">Losses</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-yellow-500" data-testid="text-stat-pending">{stats.pending}</div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </div>
                <div>
                  <div className={`text-xl font-bold ${stats.totalPips >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-stat-pips">
                    {stats.totalPips >= 0 ? "+" : ""}{stats.totalPips}
                  </div>
                  <div className="text-xs text-muted-foreground">Pips</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {dailyLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : historySignals.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="text-base font-medium mb-1">No Signals on {formatDate(selectedDate)}</h3>
              <p className="text-muted-foreground text-sm">
                {isToday ? "No signals generated yet today. Check back during market hours." : "No signals were generated on this day."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {historySignals.map((signal) => (
              <HistorySignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
