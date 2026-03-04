import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy, TrendingUp, TrendingDown, Target, Percent, BarChart3, Users, Crown, Medal, Clock, Filter, CalendarDays, DollarSign, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

interface PerformanceData {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPips: number;
  bestInstrument: { name: string; winRate: number };
  worstInstrument: { name: string; winRate: number };
  byTimeframe: Record<string, { trades: number; winRate: number; pips: number; totalMoney: number }>;
  byInstrument: Record<string, { trades: number; winRate: number; pips: number }>;
  byPairTimeframe: Array<{
    instrument: string;
    timeframe: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPips: number;
    avgPips: number;
    totalMoney: number;
    avgMoney: number;
  }>;
  recentTrades: Array<{
    id: string;
    instrument: string;
    direction: string;
    result: "WIN" | "LOSS";
    pips: number;
    timestamp: string;
  }>;
  dailyPnl: Array<{
    date: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    pips: number;
    pnl: number;
    pnlPercent: number;
  }>;
  todayPnl: {
    date: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    pips: number;
    pnl: number;
    pnlPercent: number;
  };
  avgDailyPnl: number;
  avgDailyPips: number;
  avgDailyPct: number;
  profitDays: number;
  lossDays: number;
  tradingDays: number;
  currency: string;
  currencySymbol: string;
  accountBalance: number;
  totalReturnPct: number;
}

interface LeaderboardEntry {
  rank: number;
  odId: string;
  displayName: string;
  profileImage: string | null;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPips: number;
  totalPnl: number;
  returnPct: number;
  currency: string;
  isCurrentUser: boolean;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  systemStats: {
    totalUsers: number;
    totalTrades: number;
    totalWins: number;
    overallWinRate: number;
    totalPips: number;
    totalPnl: number;
    mostTradedInstrument: string;
  };
}

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  variant = "default" 
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string; 
  icon: any; 
  variant?: "default" | "success" | "danger" 
}) {
  const colorClass = variant === "success" ? "text-green-500" : variant === "danger" ? "text-red-500" : "text-primary";
  
  return (
    <Card data-testid={`stat-${title.toLowerCase().replace(/\s/g, '-')}`}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <Icon className={`h-8 w-8 ${colorClass} opacity-50`} />
        </div>
      </CardContent>
    </Card>
  );
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Crown className="h-5 w-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />;
  if (rank === 3) return <Medal className="h-5 w-5 text-amber-600" />;
  return <span className="text-sm font-medium text-muted-foreground w-5 text-center">{rank}</span>;
}

function LeaderboardSection() {
  const { data, isLoading } = useQuery<LeaderboardData>({
    queryKey: ["/api/leaderboard"],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-leaderboard">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Trader Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-32" />
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
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card data-testid="stat-platform-traders">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Platform Traders</p>
                  <p className="text-2xl font-bold">{stats.totalUsers}</p>
                </div>
                <Users className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="stat-total-platform-trades">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Total Trades</p>
                  <p className="text-2xl font-bold">{stats.totalTrades}</p>
                  <p className="text-xs text-muted-foreground">{stats.overallWinRate}% win rate</p>
                </div>
                <BarChart3 className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="stat-total-platform-pips">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Total Pips</p>
                  <p className={`text-2xl font-bold ${stats.totalPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {stats.totalPips >= 0 ? "+" : ""}{stats.totalPips.toFixed(0)}
                  </p>
                </div>
                <Target className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="stat-most-traded">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Most Traded</p>
                  <p className="text-2xl font-bold">{stats.mostTradedInstrument}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card data-testid="card-leaderboard">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Trader Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">
              No traders with completed trades yet. Start trading to appear on the leaderboard.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-leaderboard">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-1 px-1 w-8">#</th>
                      <th className="text-left py-1 px-1">Trader</th>
                      <th className="text-right py-1 px-1 whitespace-nowrap">Trades</th>
                      <th className="text-right py-1 px-1 whitespace-nowrap">Win %</th>
                      <th className="text-right py-1 px-1 whitespace-nowrap hidden md:table-cell">PF</th>
                      <th className="text-right py-1 px-1 whitespace-nowrap">Pips</th>
                      <th className="text-right py-1 px-1 whitespace-nowrap">Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr
                        key={entry.odId || entry.rank}
                        data-testid={`leaderboard-row-${entry.rank}`}
                        className={`${entry.isCurrentUser ? "bg-primary/5 outline outline-1 outline-primary/20" : ""}`}
                      >
                        <td className="py-2 px-1 text-center align-middle">
                          {getRankIcon(entry.rank)}
                        </td>
                        <td className="py-2 px-1 align-middle">
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar className="h-7 w-7 shrink-0">
                              {entry.profileImage && <AvatarImage src={entry.profileImage} alt={entry.displayName} />}
                              <AvatarFallback className="text-xs">
                                {entry.displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium truncate">
                              {entry.displayName}
                              {entry.isCurrentUser && (
                                <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">You</Badge>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-1 align-middle">{entry.totalTrades}</td>
                        <td className={`text-right py-2 px-1 align-middle ${entry.winRate >= 50 ? "text-green-500" : entry.winRate >= 40 ? "text-muted-foreground" : "text-red-500"}`}>
                          {entry.winRate}%
                        </td>
                        <td className={`text-right py-2 px-1 align-middle hidden md:table-cell ${entry.profitFactor >= 1.5 ? "text-green-500" : entry.profitFactor >= 1 ? "text-muted-foreground" : "text-red-500"}`}>
                          {entry.profitFactor.toFixed(1)}
                        </td>
                        <td className={`text-right py-2 px-1 align-middle ${entry.totalPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {entry.totalPips >= 0 ? "+" : ""}{entry.totalPips.toFixed(0)}
                        </td>
                        <td className={`text-right py-2 px-1 align-middle font-medium ${entry.returnPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {entry.returnPct >= 0 ? "+" : ""}{entry.returnPct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type SortField = "trades" | "winRate" | "totalPips" | "totalMoney" | "avgMoney";

function PairTimeframeStats({ data }: { data: PerformanceData["byPairTimeframe"] }) {
  const [sortBy, setSortBy] = useState<SortField>("trades");
  const [filterInstrument, setFilterInstrument] = useState<string>("all");

  const instruments = Array.from(new Set((data || []).map(d => d.instrument)));

  const filtered = filterInstrument === "all" ? (data || []) : (data || []).filter(d => d.instrument === filterInstrument);
  const sorted = [...filtered].sort((a, b) => {
    let diff = 0;
    if (sortBy === "trades") diff = b.trades - a.trades;
    else if (sortBy === "winRate") diff = b.winRate - a.winRate;
    else if (sortBy === "totalPips") diff = b.totalPips - a.totalPips;
    else if (sortBy === "totalMoney") diff = b.totalMoney - a.totalMoney;
    else if (sortBy === "avgMoney") diff = b.avgMoney - a.avgMoney;
    if (diff !== 0) return diff;
    return b.trades - a.trades || b.winRate - a.winRate;
  });

  const getWinRateColor = (rate: number) => {
    if (rate >= 75) return "text-green-500";
    if (rate >= 60) return "text-emerald-400";
    if (rate >= 50) return "text-yellow-500";
    return "text-red-500";
  };

  const getWinRateBg = (rate: number) => {
    if (rate >= 75) return "bg-green-500/10 border-green-500/30";
    if (rate >= 60) return "bg-emerald-500/10 border-emerald-500/30";
    if (rate >= 50) return "bg-yellow-500/10 border-yellow-500/30";
    return "bg-red-500/10 border-red-500/30";
  };

  const getRating = (rate: number, trades: number) => {
    if (trades < 3) return "Low Data";
    if (rate >= 75) return "Excellent";
    if (rate >= 60) return "Good";
    if (rate >= 50) return "Fair";
    return "Avoid";
  };

  const getRatingBadge = (rate: number, trades: number) => {
    const rating = getRating(rate, trades);
    if (rating === "Low Data") return <Badge variant="outline" className="text-[10px]">Low Data</Badge>;
    if (rating === "Excellent") return <Badge className="text-[10px] bg-green-500/20 text-green-500 border-green-500/30">Excellent</Badge>;
    if (rating === "Good") return <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Good</Badge>;
    if (rating === "Fair") return <Badge className="text-[10px] bg-yellow-500/20 text-yellow-500 border-yellow-500/30">Fair</Badge>;
    return <Badge variant="destructive" className="text-[10px]">Avoid</Badge>;
  };

  return (
    <Card data-testid="card-pair-timeframe-stats">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Pair + Timeframe Performance
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              data-testid="select-filter-instrument"
              className="text-xs rounded-md border border-input bg-background px-2 py-1"
              value={filterInstrument}
              onChange={e => setFilterInstrument(e.target.value)}
            >
              <option value="all">All Pairs</option>
              {instruments.map(inst => (
                <option key={inst} value={inst}>{inst}</option>
              ))}
            </select>
            <select
              data-testid="select-sort-by"
              className="text-xs rounded-md border border-input bg-background px-2 py-1"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortField)}
            >
              <option value="trades">Sort: Most Trades</option>
              <option value="winRate">Sort: Best Win Rate</option>
              <option value="totalPips">Sort: Most Pips</option>
              <option value="totalMoney">Sort: Most Profit</option>
              <option value="avgMoney">Sort: Best Avg Profit</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          See which pair + timeframe combos are performing best to help decide what to trade
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-pair-timeframe">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2 px-2">Pair</th>
                <th className="text-center py-2 px-2">TF</th>
                <th className="text-center py-2 px-2">W/L</th>
                <th className="text-center py-2 px-2">Win %</th>
                <th className="text-right py-2 px-2">Pips</th>
                <th className="text-right py-2 px-2 hidden sm:table-cell">Avg Pips</th>
                <th className="text-right py-2 px-2">Profit</th>
                <th className="text-right py-2 px-2 hidden sm:table-cell">Avg £/Trade</th>
                <th className="text-center py-2 px-2">Rating</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr
                  key={`${row.instrument}-${row.timeframe}`}
                  data-testid={`row-${row.instrument}-${row.timeframe}`}
                  className={`border-b last:border-0 ${getWinRateBg(row.winRate)}`}
                >
                  <td className="py-2 px-2 font-medium">{row.instrument}</td>
                  <td className="py-2 px-2 text-center">
                    <Badge variant="outline" className="text-xs">{row.timeframe}</Badge>
                  </td>
                  <td className="py-2 px-2 text-center text-xs">
                    <span className="text-green-500">{row.wins}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-red-500">{row.losses}</span>
                  </td>
                  <td className={`py-2 px-2 text-center font-bold ${getWinRateColor(row.winRate)}`}>
                    {row.winRate.toFixed(1)}%
                  </td>
                  <td className={`py-2 px-2 text-right ${row.totalPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {row.totalPips >= 0 ? "+" : ""}{row.totalPips.toFixed(0)}
                  </td>
                  <td className={`py-2 px-2 text-right hidden sm:table-cell ${row.avgPips >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {row.avgPips >= 0 ? "+" : ""}{row.avgPips.toFixed(1)}
                  </td>
                  <td className={`py-2 px-2 text-right font-medium ${row.totalMoney >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {row.totalMoney >= 0 ? "+" : ""}£{row.totalMoney.toFixed(2)}
                  </td>
                  <td className={`py-2 px-2 text-right hidden sm:table-cell ${row.avgMoney >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {row.avgMoney >= 0 ? "+" : ""}£{row.avgMoney.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {getRatingBadge(row.winRate, row.trades)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && (
          <p className="text-muted-foreground text-center py-4">No trades recorded yet</p>
        )}
      </CardContent>
    </Card>
  );
}

function DailyPnlSection({ data }: { data: PerformanceData }) {
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);
  const chartData = [...data.dailyPnl].reverse().slice(-14);
  const todayStr = new Date().toISOString().slice(0, 10);

  const selectedDay = selectedDayIdx !== null
    ? data.dailyPnl[selectedDayIdx]
    : data.dailyPnl.find(d => d.date === todayStr) || data.dailyPnl[0];

  const selectedDayActualIdx = selectedDayIdx !== null
    ? selectedDayIdx
    : data.dailyPnl.findIndex(d => d.date === todayStr) >= 0
      ? data.dailyPnl.findIndex(d => d.date === todayStr)
      : 0;

  const isSelectedToday = selectedDay?.date === todayStr;
  const canGoNewer = selectedDayActualIdx > 0;
  const canGoOlder = selectedDayActualIdx < data.dailyPnl.length - 1;

  const goNewer = () => {
    if (canGoNewer) setSelectedDayIdx(selectedDayActualIdx - 1);
  };
  const goOlder = () => {
    if (canGoOlder) setSelectedDayIdx(selectedDayActualIdx + 1);
  };
  const goToday = () => setSelectedDayIdx(null);

  const handleBarClick = (entry: any) => {
    if (entry?.date) {
      const idx = data.dailyPnl.findIndex(d => d.date === entry.date);
      if (idx >= 0) setSelectedDayIdx(idx);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };

  return (
    <Card data-testid="card-daily-pnl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Daily P&L
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Avg/Day</div>
              <div className={`text-sm font-mono ${data.avgDailyPnl >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-avg-daily-pnl">
                {data.avgDailyPnl >= 0 ? "+" : ""}{data.currencySymbol}{data.avgDailyPnl.toFixed(2)}
                <span className="text-xs ml-1">({data.avgDailyPct >= 0 ? "+" : ""}{data.avgDailyPct.toFixed(1)}%)</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Total Return</div>
              <div className={`text-sm font-mono font-bold ${data.totalReturnPct >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-total-return">
                {data.totalReturnPct >= 0 ? "+" : ""}{data.totalReturnPct.toFixed(1)}%
              </div>
            </div>
            <Badge variant="outline" className="text-xs">
              <span className="text-green-500">{data.profitDays}W</span>
              <span className="mx-1">/</span>
              <span className="text-red-500">{data.lossDays}L</span>
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedDay && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={goOlder} disabled={!canGoOlder} data-testid="button-day-older">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium min-w-[120px] text-center">
                  {formatDate(selectedDay.date)}
                  {isSelectedToday && <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">Today</Badge>}
                </span>
                <Button variant="ghost" size="sm" onClick={goNewer} disabled={!canGoNewer} data-testid="button-day-newer">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {!isSelectedToday && (
                <Button variant="outline" size="sm" onClick={goToday} data-testid="button-go-today">
                  Today
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${selectedDay.pnl >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-selected-pnl">
                  {selectedDay.pnl >= 0 ? "+" : ""}{data.currencySymbol}{selectedDay.pnl.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">
                  P&L
                  <Badge variant="outline" className={`ml-1 text-[10px] px-1 py-0 ${selectedDay.pnlPercent >= 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}`}>
                    {selectedDay.pnlPercent >= 0 ? "+" : ""}{selectedDay.pnlPercent.toFixed(1)}%
                  </Badge>
                </div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${selectedDay.pips >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-selected-pips">
                  {selectedDay.pips >= 0 ? "+" : ""}{selectedDay.pips}p
                </div>
                <div className="text-xs text-muted-foreground">Pips</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold font-mono" data-testid="text-selected-trades">
                  {selectedDay.trades}
                </div>
                <div className="text-xs text-muted-foreground">{selectedDay.wins}W / {selectedDay.losses}L</div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${selectedDay.winRate >= 50 ? "text-green-500" : selectedDay.trades === 0 ? "" : "text-red-500"}`} data-testid="text-selected-winrate">
                  {selectedDay.trades > 0 ? `${selectedDay.winRate.toFixed(0)}%` : "-"}
                </div>
                <div className="text-xs text-muted-foreground">Win Rate</div>
              </div>
            </div>
          </div>
        )}

        {chartData.length > 1 && (
          <div className="h-48" data-testid="chart-daily-pnl">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  className="fill-muted-foreground"
                  tickFormatter={(d: string) => {
                    const date = new Date(d + "T00:00:00");
                    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                  }}
                />
                <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  labelFormatter={(d: string) => {
                    const date = new Date(d + "T00:00:00");
                    return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === "pnl") return [`${data.currencySymbol}${value.toFixed(2)}`, "P&L"];
                    return [`${value}p`, "Pips"];
                  }}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]} onClick={(payload: any) => handleBarClick(payload)}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.pnl >= 0 ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"}
                      opacity={selectedDay?.date === entry.date ? 1 : 0.6}
                      stroke={selectedDay?.date === entry.date ? "hsl(var(--foreground))" : "none"}
                      strokeWidth={selectedDay?.date === entry.date ? 2 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {data.dailyPnl.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground font-medium">Recent Days</div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {data.dailyPnl.slice(0, 10).map((day, idx) => {
                const date = new Date(day.date + "T00:00:00");
                const isToday = day.date === todayStr;
                const isSelected = day.date === selectedDay?.date;
                return (
                  <div
                    key={day.date}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors
                      ${isSelected ? "bg-primary/10 border border-primary/20 ring-1 ring-primary/30" : isToday ? "bg-primary/5 border border-primary/10" : "bg-muted/30 hover:bg-muted/50"}`}
                    onClick={() => setSelectedDayIdx(data.dailyPnl.findIndex(d => d.date === day.date))}
                    data-testid={`row-day-${day.date}`}
                  >
                    <div className="flex items-center gap-2">
                      {day.pnl > 0 ? <TrendingUp className="h-3 w-3 text-green-500" /> : day.pnl < 0 ? <TrendingDown className="h-3 w-3 text-red-500" /> : <DollarSign className="h-3 w-3 text-muted-foreground" />}
                      <span className="text-sm font-medium">
                        {date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                        {isToday && <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">Today</Badge>}
                      </span>
                      <span className="text-xs text-muted-foreground">{day.trades}t · {day.wins}W/{day.losses}L</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono ${day.pips >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {day.pips >= 0 ? "+" : ""}{day.pips}p
                      </span>
                      <span className={`text-sm font-mono font-bold ${day.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {day.pnl >= 0 ? "+" : ""}{data.currencySymbol}{day.pnl.toFixed(2)}
                      </span>
                      <Badge variant="outline" className={`text-[10px] px-1 py-0 ${day.pnlPercent >= 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}`}>
                        {day.pnlPercent >= 0 ? "+" : ""}{day.pnlPercent.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PerformancePage() {
  const { data, isLoading } = useQuery<PerformanceData>({
    queryKey: ["/api/performance"],
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        <h1 className="text-xl md:text-2xl font-bold">Performance Tracking</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const winRate = data?.winRate || 0;
  const profitFactor = data?.profitFactor || 0;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Performance Tracking</h1>
        <p className="text-sm md:text-base text-muted-foreground">Signal accuracy and trade simulation results</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard 
          title="Win Rate" 
          value={`${winRate.toFixed(1)}%`} 
          subtitle={`${data?.wins || 0}W / ${data?.losses || 0}L`}
          icon={Percent} 
          variant={winRate >= 40 ? "success" : winRate >= 30 ? "default" : "danger"}
        />
        <StatCard 
          title="Profit Factor" 
          value={profitFactor.toFixed(2)} 
          subtitle="Risk/Reward Ratio"
          icon={Trophy} 
          variant={profitFactor >= 1.5 ? "success" : profitFactor >= 1 ? "default" : "danger"}
        />
        <StatCard 
          title="Total Pips" 
          value={data?.totalPips?.toFixed(0) || "0"} 
          subtitle={`${data?.totalTrades || 0} trades`}
          icon={Target} 
          variant={(data?.totalPips || 0) > 0 ? "success" : "danger"}
        />
        <StatCard 
          title="Best Pair" 
          value={data?.bestInstrument?.name || "N/A"} 
          subtitle={`${data?.bestInstrument?.winRate?.toFixed(1) || 0}% win rate`}
          icon={TrendingUp} 
          variant="success"
        />
      </div>

      {data && <DailyPnlSection data={data} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card data-testid="card-by-instrument">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Performance by Instrument
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data?.byInstrument && Object.entries(data.byInstrument).map(([instrument, stats]) => (
                <div key={instrument} className="flex items-center justify-between flex-wrap gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{instrument}</span>
                    <Badge variant="outline" className="text-xs">{stats.trades} trades</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={stats.pips >= 0 ? "text-green-500" : "text-red-500"}>
                      {stats.pips >= 0 ? "+" : ""}{stats.pips.toFixed(0)} pips
                    </span>
                    <Badge variant={stats.winRate >= 40 ? "default" : "secondary"}>
                      {stats.winRate.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              ))}
              {!data?.byInstrument && (
                <p className="text-muted-foreground text-center py-4">No data yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-by-timeframe">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Performance by Timeframe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data?.byTimeframe && Object.entries(data.byTimeframe)
                .sort((a, b) => b[1].winRate - a[1].winRate)
                .map(([tf, stats]) => (
                <div key={tf} className="flex items-center justify-between flex-wrap gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{tf}</span>
                    <Badge variant="outline" className="text-xs">{stats.trades} trades</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm ${stats.pips >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {stats.pips >= 0 ? "+" : ""}{stats.pips.toFixed(0)} pips
                    </span>
                    <span className={`text-sm ${stats.totalMoney >= 0 ? "text-green-500" : "text-red-500"}`}>
                      £{stats.totalMoney.toFixed(2)}
                    </span>
                    <Badge variant={stats.winRate >= 70 ? "default" : stats.winRate >= 50 ? "secondary" : "destructive"}>
                      {stats.winRate.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              ))}
              {!data?.byTimeframe && (
                <p className="text-muted-foreground text-center py-4">No data yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <PairTimeframeStats data={data?.byPairTimeframe || []} />

      <Card data-testid="card-recent-trades">
        <CardHeader>
          <CardTitle className="text-base">Recent Trades</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data?.recentTrades && data.recentTrades.length > 0 ? (
              data.recentTrades.slice(0, 10).map((trade) => (
                <div 
                  key={trade.id} 
                  className="flex items-center justify-between py-2 border-b last:border-0 flex-wrap gap-1"
                >
                  <div className="flex items-center gap-3">
                    {trade.result === "WIN" ? (
                      <TrendingUp className="h-4 w-4 text-green-500" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-500" />
                    )}
                    <span className="font-medium">{trade.instrument}</span>
                    <Badge variant="outline" className="text-xs">{trade.direction}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={trade.pips >= 0 ? "text-green-500" : "text-red-500"}>
                      {trade.pips >= 0 ? "+" : ""}{trade.pips.toFixed(1)} pips
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(trade.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-center py-4">
                No trades recorded yet. Signals will be tracked automatically.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg md:text-xl font-bold mb-4">Platform Leaderboard</h2>
        <LeaderboardSection />
      </div>
    </div>
  );
}
