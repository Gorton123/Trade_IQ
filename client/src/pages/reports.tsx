import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "@/components/metric-tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import {
  CalendarDays,
  TrendingUp,
  TrendingDown,
  Target,
  Award,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Lock,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!isAuthenticated) return (
    <div className="flex flex-col items-center justify-center p-12 gap-4">
      <Lock className="h-10 w-10 text-muted-foreground" />
      <p className="text-muted-foreground">Sign in to view your trading reports</p>
      <Button asChild data-testid="button-login-reports"><a href="/api/login">Sign In</a></Button>
    </div>
  );
  return <>{children}</>;
}

function EquityCurveSection() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/equity-curve"],
  });

  if (isLoading) return <Card><CardContent className="p-6"><div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div></CardContent></Card>;
  if (!data || !data.equityPoints || data.equityPoints.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Equity Curve</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm text-center py-6">No closed trades yet. Your equity curve will appear here as trades complete.</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.equityPoints.map((p: any, i: number) => ({
    ...p,
    index: i,
    label: new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
  }));

  const isProfit = data.totalReturn >= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Equity Curve
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Balance</div>
              <div className="text-sm font-mono" data-testid="text-equity-balance">{data.currency} {data.currentBalance.toFixed(2)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Return</div>
              <div className={`text-sm font-mono ${isProfit ? "text-green-500" : "text-red-500"}`} data-testid="text-equity-return">
                {isProfit ? "+" : ""}{data.returnPercent}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground flex items-center gap-0.5">Max DD <InfoTooltip text="Largest drop from peak balance to lowest point. Lower is better." /></div>
              <div className="text-sm font-mono text-red-500" data-testid="text-equity-drawdown">{data.maxDrawdown}%</div>
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64" data-testid="chart-equity-curve">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isProfit ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={isProfit ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 12 }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(value: number) => [`${data.currency} ${value.toFixed(2)}`, "Balance"]}
              />
              <Area type="monotone" dataKey="balance" stroke={isProfit ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"} fill="url(#equityGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function DailyReportSection() {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const { data: datesData } = useQuery<any>({
    queryKey: ["/api/reports/dates"],
  });

  const { data: report, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/daily", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/reports/daily?date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
  });

  const dates = datesData?.dates || [];
  const currentIndex = dates.indexOf(selectedDate);

  const goToDate = (dir: number) => {
    if (dir < 0 && currentIndex < dates.length - 1) setSelectedDate(dates[currentIndex + 1]);
    if (dir > 0 && currentIndex > 0) setSelectedDate(dates[currentIndex - 1]);
  };

  const formatDate = (d: string) => {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Daily Report
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => goToDate(-1)} disabled={currentIndex >= dates.length - 1} data-testid="button-prev-day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {dates.length > 0 ? (
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger className="w-48" data-testid="select-report-date">
                  <SelectValue>{formatDate(selectedDate)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {dates.map((d: string) => (
                    <SelectItem key={d} value={d}>{formatDate(d)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm text-muted-foreground">{formatDate(selectedDate)}</span>
            )}
            <Button variant="ghost" size="icon" onClick={() => goToDate(1)} disabled={currentIndex <= 0} data-testid="button-next-day">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : !report || report.totalTrades === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-6">No trades closed on this date.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center">
                <div className="text-2xl font-bold" data-testid="text-daily-trades">{report.totalTrades}</div>
                <div className="text-xs text-muted-foreground">Trades</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold" data-testid="text-daily-winrate">{report.winRate}%</div>
                <div className="text-xs text-muted-foreground">Win Rate</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${report.totalPips >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-daily-pips">
                  {report.totalPips >= 0 ? "+" : ""}{report.totalPips}
                </div>
                <div className="text-xs text-muted-foreground">Pips</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${report.totalPnl >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-daily-pnl">
                  {report.totalPnl >= 0 ? "+" : ""}{report.totalPnl.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">P&L</div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Badge variant="default" data-testid="badge-daily-wins">
                {report.wins}W
              </Badge>
              <Badge variant="destructive" data-testid="badge-daily-losses">
                {report.losses}L
              </Badge>
              {report.breakevens > 0 && (
                <Badge variant="secondary">{report.breakevens}BE</Badge>
              )}
            </div>

            {Object.keys(report.byInstrument).length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground font-medium">By Instrument</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(report.byInstrument).map(([inst, data]: [string, any]) => (
                    <div key={inst} className="flex items-center justify-between p-2 rounded-md bg-muted/30">
                      <span className="text-sm font-medium">{inst}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{data.trades} trades</span>
                        <span className={`text-sm font-mono ${data.pips >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {data.pips >= 0 ? "+" : ""}{Math.round(data.pips * 10) / 10}p
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.trades.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground font-medium">Trade Log</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {report.trades.map((t: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/30 text-sm">
                      <div className="flex items-center gap-2">
                        {(t.pnlPips || 0) > 0 ? <ArrowUpRight className="h-3 w-3 text-green-500" /> : (t.pnlPips || 0) < 0 ? <ArrowDownRight className="h-3 w-3 text-red-500" /> : <Minus className="h-3 w-3" />}
                        <span className="font-medium">{t.instrument}</span>
                        <Badge variant="secondary" className="text-xs">{t.direction}</Badge>
                        <span className="text-xs text-muted-foreground">{t.timeframe}</span>
                      </div>
                      <span className={`font-mono ${(t.pnlPips || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {(t.pnlPips || 0) >= 0 ? "+" : ""}{t.pnlPips}p
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeeklyReportSection() {
  const { data: report, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/weekly"],
  });

  if (isLoading) return <Card><CardContent className="p-6"><div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div></CardContent></Card>;
  if (!report || report.totalTrades === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" />Weekly Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm text-center py-6">No trades closed this week yet.</p>
        </CardContent>
      </Card>
    );
  }

  const dailyData = Object.entries(report.dailyBreakdown || {}).map(([date, d]: [string, any]) => ({
    date: new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" }),
    pips: Math.round(d.pips * 10) / 10,
    trades: d.trades,
    pnl: Math.round(d.pnl * 100) / 100,
  })).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Weekly Summary
          </div>
          <span className="text-xs text-muted-foreground font-normal">
            {report.weekStart} to {report.weekEnd}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold" data-testid="text-weekly-trades">{report.totalTrades}</div>
            <div className="text-xs text-muted-foreground">Trades</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold" data-testid="text-weekly-winrate">{report.winRate}%</div>
            <div className="text-xs text-muted-foreground">Win Rate</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-bold ${report.totalPips >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-weekly-pips">
              {report.totalPips >= 0 ? "+" : ""}{report.totalPips}
            </div>
            <div className="text-xs text-muted-foreground">Pips</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-bold ${report.totalPnl >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-weekly-pnl">
              {report.totalPnl >= 0 ? "+" : ""}{report.totalPnl.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">P&L ({report.accountCurrency})</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-md bg-muted/30">
            <div className="text-sm font-bold">{report.profitFactor}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-0.5">Profit Factor <InfoTooltip text="Gross profits divided by gross losses. Above 1.5 is good, above 2.0 is excellent." /></div>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/30">
            <div className={`text-sm font-bold ${report.returnPercent >= 0 ? "text-green-500" : "text-red-500"}`}>
              {report.returnPercent >= 0 ? "+" : ""}{report.returnPercent}%
            </div>
            <div className="text-xs text-muted-foreground">Return</div>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/30">
            <div className="text-sm font-bold">{report.accountCurrency} {report.accountBalance?.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Balance</div>
          </div>
        </div>

        {report.bestInstrument && report.worstInstrument && (
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <div className="flex items-center gap-1">
              <Award className="h-4 w-4 text-green-500" />
              <span className="text-sm">Best: <span className="font-medium">{report.bestInstrument.name}</span></span>
              <span className="text-xs text-green-500 font-mono">+{report.bestInstrument.pips}p</span>
            </div>
            <div className="flex items-center gap-1">
              <Target className="h-4 w-4 text-red-500" />
              <span className="text-sm">Worst: <span className="font-medium">{report.worstInstrument.name}</span></span>
              <span className="text-xs text-red-500 font-mono">{report.worstInstrument.pips}p</span>
            </div>
          </div>
        )}

        {dailyData.length > 1 && (
          <div className="h-40" data-testid="chart-weekly-pips">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  formatter={(value: number) => [`${value} pips`, "P&L"]}
                />
                <Bar dataKey="pips" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {Object.keys(report.byInstrument).length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground font-medium">By Instrument</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(report.byInstrument).sort((a: any, b: any) => b[1].pips - a[1].pips).map(([inst, data]: [string, any]) => (
                <div key={inst} className="flex items-center justify-between p-2 rounded-md bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{inst}</span>
                    <span className="text-xs text-muted-foreground">{data.wins}W/{data.losses}L</span>
                  </div>
                  <span className={`text-sm font-mono ${data.pips >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {data.pips >= 0 ? "+" : ""}{Math.round(data.pips * 10) / 10}p
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  return (
    <AuthGuard>
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold" data-testid="text-reports-title">Trading Reports</h1>
        </div>

        <EquityCurveSection />

        <div className="grid gap-4 lg:grid-cols-2">
          <DailyReportSection />
          <WeeklyReportSection />
        </div>
      </div>
    </AuthGuard>
  );
}
