import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  Users,
  Wallet,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Banknote,
  BarChart3,
  Globe,
  Activity,
  Clock,
} from "lucide-react";
import { useState, useEffect } from "react";
import { queryClient } from "@/lib/queryClient";

export default function AdminEarningsPage() {
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const { data: balanceData } = useQuery<any>({
    queryKey: ["/api/commission/balance"],
  });

  const { data: adminData, isLoading } = useQuery<any>({
    queryKey: ["/api/commission/admin/overview"],
    enabled: !!balanceData?.isOwner,
  });

  if (!balanceData?.isOwner) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="p-6 text-center">
            <Shield className="h-12 w-12 mx-auto text-red-500 mb-4" />
            <h3 className="text-lg font-semibold">Admin Access Required</h3>
            <p className="text-muted-foreground">This page is only available to the platform owner.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const totalEarned = adminData?.totalEarned || 0;
  const balances = adminData?.balances || [];
  const recentLedger = adminData?.recentLedger || [];

  const totalDeposited = balances.reduce((sum: number, b: any) => sum + (b.totalDeposited || 0), 0);
  const totalCurrentBalance = balances.reduce((sum: number, b: any) => sum + (b.balance || 0), 0);
  const liveUsers = balances.filter((b: any) => b.oandaEnvironment === 'live');
  const demoUsers = balances.filter((b: any) => b.oandaEnvironment !== 'live');

  const getUserLedger = (userId: string) => {
    return recentLedger.filter((e: any) => e.userId === userId);
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-admin-earnings-title">Earnings Dashboard</h1>
          <Badge variant="outline" className="text-green-600">Admin</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/commission/balance"] });
            queryClient.invalidateQueries({ queryKey: ["/api/commission/admin/overview"] });
          }}
          data-testid="button-refresh-admin"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-total-earned">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Your Total Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">£{totalEarned.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">25% commission from profitable trades</p>
          </CardContent>
        </Card>

        <Card data-testid="card-active-users">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{balances.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {liveUsers.length} live · {demoUsers.length} demo
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-deposited">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total User Deposits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">£{totalDeposited.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">All deposits received via Stripe</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-balance">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Remaining User Balances</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">£{totalCurrentBalance.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">Combined commission balances</p>
          </CardContent>
        </Card>
      </div>

      <LiveAccountsSection />

      <Card data-testid="card-user-details">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Individual User Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balances.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No users with commission accounts yet.</p>
          ) : (
            <div className="space-y-3">
              {balances.map((b: any) => {
                const isExpanded = expandedUser === b.userId;
                const userLedger = isExpanded ? getUserLedger(b.userId) : [];
                return (
                  <div
                    key={b.userId}
                    className="rounded-lg border bg-card"
                    data-testid={`row-user-${b.userId}`}
                  >
                    <button
                      className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/50 rounded-lg transition-colors"
                      onClick={() => setExpandedUser(isExpanded ? null : b.userId)}
                      data-testid={`button-expand-user-${b.userId}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-bold text-primary">
                            {(b.displayName || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold">{b.displayName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant={b.oandaEnvironment === 'live' ? 'default' : 'secondary'} className="text-xs">
                              {b.oandaEnvironment === 'live' ? 'Live' : 'Demo'}
                            </Badge>
                            {b.tradingPaused && <Badge variant="destructive" className="text-xs">Paused</Badge>}
                            {b.autoTopUpEnabled && b.stripePaymentMethodId && (
                              <Badge variant="outline" className="text-xs text-green-600">Auto Top-Up</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-muted-foreground">OANDA Balance</p>
                          <p className="font-semibold" data-testid={`text-oanda-balance-${b.userId}`}>
                            {b.oandaFetchFailed ? 'Unavailable' : `${b.oandaCurrency === 'GBP' ? '£' : b.oandaCurrency + ' '}${b.oandaBalance.toFixed(2)}`}
                          </p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-muted-foreground">Deposit Balance</p>
                          <p className={`font-semibold ${b.balance < 20 ? 'text-red-500' : 'text-green-600'}`}>
                            £{b.balance.toFixed(2)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">You Earned</p>
                          <p className="font-semibold text-green-600">
                            £{(b.commissionPaidToOwner || 0).toFixed(2)}
                          </p>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                          <div className="p-3 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-2 mb-1">
                              <Banknote className="h-4 w-4 text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">OANDA Balance</p>
                            </div>
                            <p className="font-bold text-lg">
                              {b.oandaFetchFailed ? 'Unavailable' : `${b.oandaCurrency === 'GBP' ? '£' : b.oandaCurrency + ' '}${b.oandaBalance.toFixed(2)}`}
                            </p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-2 mb-1">
                              <Wallet className="h-4 w-4 text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">Total Deposited</p>
                            </div>
                            <p className="font-bold text-lg">£{(b.totalDeposited || 0).toFixed(2)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-2 mb-1">
                              <Wallet className="h-4 w-4 text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">Deposit Remaining</p>
                            </div>
                            <p className={`font-bold text-lg ${b.balance < 20 ? 'text-red-500' : ''}`}>
                              £{b.balance.toFixed(2)}
                            </p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-2 mb-1">
                              <BarChart3 className="h-4 w-4 text-green-600" />
                              <p className="text-xs text-muted-foreground">Commission Earned</p>
                            </div>
                            <p className="font-bold text-lg text-green-600">
                              £{(b.commissionPaidToOwner || 0).toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              from {b.commissionTradeCount || 0} winning trades
                            </p>
                          </div>
                        </div>

                        {userLedger.length > 0 && (
                          <div className="mt-4">
                            <p className="text-sm font-medium mb-2 flex items-center gap-2">
                              <Receipt className="h-4 w-4" />
                              Recent Transactions
                            </p>
                            <div className="space-y-1.5 max-h-60 overflow-y-auto">
                              {userLedger.slice(0, 20).map((entry: any) => (
                                <div
                                  key={entry.id}
                                  className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm"
                                  data-testid={`row-user-ledger-${entry.id}`}
                                >
                                  <div className="flex items-center gap-2">
                                    {entry.amount > 0 ? (
                                      <ArrowUpRight className="h-3.5 w-3.5 text-green-500" />
                                    ) : (
                                      <ArrowDownRight className="h-3.5 w-3.5 text-red-500" />
                                    )}
                                    <span className="text-muted-foreground">
                                      {entry.description || entry.type}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(entry.createdAt).toLocaleDateString("en-GB", {
                                        day: "numeric",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                    <span className={`font-medium ${entry.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                      {entry.amount > 0 ? '+' : ''}£{Math.abs(entry.amount).toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-all-transactions">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            All Recent Transactions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentLedger.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No transactions yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {recentLedger.slice(0, 50).map((entry: any) => {
                const userBalance = balances.find((b: any) => b.userId === entry.userId);
                const userName = userBalance?.displayName || entry.userId.substring(0, 8);
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    data-testid={`row-admin-ledger-${entry.id}`}
                  >
                    <div className="flex items-center gap-3">
                      {entry.amount > 0 ? (
                        <ArrowUpRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4 text-red-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium">{entry.description || entry.type}</p>
                        <p className="text-xs text-muted-foreground">
                          {userName} ·{" "}
                          {new Date(entry.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {entry.instrument && ` · ${entry.instrument}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${entry.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {entry.amount > 0 ? '+' : ''}£{Math.abs(entry.amount).toFixed(2)}
                      </p>
                      {entry.tradePnl && (
                        <p className="text-xs text-muted-foreground">Trade P&L: £{entry.tradePnl.toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface LiveAccount {
  userId: string;
  displayName: string;
  environment: string;
  balance: number;
  unrealizedPL: number;
  nav: number;
  currency: string;
  openTradeCount: number;
  marginUsed: number;
  marginAvailable: number;
  openTrades: {
    id: string;
    instrument: string;
    units: number;
    direction: string;
    entryPrice: number;
    unrealizedPL: number;
    openTime: string;
  }[];
  isOwner: boolean;
  autoExecuteEnabled: boolean;
  status: string;
}

function LiveAccountsSection() {
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const { data, isLoading, isFetching } = useQuery<{ accounts: LiveAccount[]; timestamp: number }>({
    queryKey: ["/api/admin/live-accounts"],
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (data?.timestamp) {
      setLastUpdated(new Date(data.timestamp));
    }
  }, [data?.timestamp]);

  const accounts = data?.accounts || [];
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalUnrealizedPL = accounts.reduce((sum, a) => sum + a.unrealizedPL, 0);
  const totalOpenTrades = accounts.reduce((sum, a) => sum + a.openTradeCount, 0);
  const liveAccounts = accounts.filter(a => a.environment === "live");
  const demoAccounts = accounts.filter(a => a.environment !== "live");

  const formatCurrency = (amount: number, currency: string = "GBP") => {
    const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency + " ";
    return `${symbol}${Math.abs(amount).toFixed(2)}`;
  };

  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    if (diffHrs > 0) return `${diffHrs}h ${diffMins}m ago`;
    return `${diffMins}m ago`;
  };

  return (
    <Card data-testid="card-live-accounts">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Live OANDA Accounts
            {isFetching && <Activity className="h-4 w-4 animate-pulse text-green-500" />}
          </CardTitle>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-last-updated">
                <Clock className="h-3 w-3" />
                {lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <Badge variant="outline" className="text-xs text-green-600">
              Auto-refresh 10s
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No connected OANDA accounts.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground">Total Balance</p>
                <p className="text-lg font-bold" data-testid="text-total-oanda-balance">{formatCurrency(totalBalance)}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground">Unrealized P&L</p>
                <p className={`text-lg font-bold ${totalUnrealizedPL >= 0 ? 'text-green-600' : 'text-red-500'}`} data-testid="text-total-unrealized-pl">
                  {totalUnrealizedPL >= 0 ? '+' : '-'}{formatCurrency(totalUnrealizedPL)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground">Open Trades</p>
                <p className="text-lg font-bold" data-testid="text-total-open-trades">{totalOpenTrades}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground">Connected</p>
                <p className="text-lg font-bold">{liveAccounts.length} live · {demoAccounts.length} demo</p>
              </div>
            </div>

            <div className="space-y-2">
              {accounts.map((account) => {
                const isExpanded = expandedAccount === account.userId;
                return (
                  <div
                    key={account.userId}
                    className="rounded-lg border bg-card"
                    data-testid={`row-live-account-${account.userId}`}
                  >
                    <button
                      className="w-full p-3 flex items-center justify-between text-left hover:bg-muted/50 rounded-lg transition-colors"
                      onClick={() => setExpandedAccount(isExpanded ? null : account.userId)}
                      data-testid={`button-expand-live-${account.userId}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${account.status === 'connected' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                          <span className={`text-sm font-bold ${account.status === 'connected' ? 'text-green-500' : 'text-red-500'}`}>
                            {(account.displayName || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm">{account.displayName}</p>
                            {account.isOwner && <Badge variant="outline" className="text-xs">Owner</Badge>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant={account.environment === 'live' ? 'default' : 'secondary'} className="text-xs">
                              {account.environment === 'live' ? 'LIVE' : 'Demo'}
                            </Badge>
                            {account.autoExecuteEnabled && (
                              <Badge variant="outline" className="text-xs text-green-600">Auto-Execute</Badge>
                            )}
                            {account.status !== 'connected' && (
                              <Badge variant="destructive" className="text-xs">Offline</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Balance</p>
                          <p className="font-semibold text-sm" data-testid={`text-live-balance-${account.userId}`}>
                            {formatCurrency(account.balance, account.currency)}
                          </p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-muted-foreground">Unrealized</p>
                          <p className={`font-semibold text-sm ${account.unrealizedPL >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {account.unrealizedPL >= 0 ? '+' : '-'}{formatCurrency(account.unrealizedPL, account.currency)}
                          </p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-muted-foreground">Trades</p>
                          <p className="font-semibold text-sm">{account.openTradeCount}</p>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                          <div className="p-2 rounded bg-muted/30">
                            <p className="text-xs text-muted-foreground">NAV</p>
                            <p className="font-bold">{formatCurrency(account.nav, account.currency)}</p>
                          </div>
                          <div className="p-2 rounded bg-muted/30">
                            <p className="text-xs text-muted-foreground">Margin Used</p>
                            <p className="font-bold">{formatCurrency(account.marginUsed, account.currency)}</p>
                          </div>
                          <div className="p-2 rounded bg-muted/30">
                            <p className="text-xs text-muted-foreground">Margin Available</p>
                            <p className="font-bold">{formatCurrency(account.marginAvailable, account.currency)}</p>
                          </div>
                          <div className="p-2 rounded bg-muted/30">
                            <p className="text-xs text-muted-foreground">Equity</p>
                            <p className={`font-bold ${account.unrealizedPL >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {formatCurrency(account.balance + account.unrealizedPL, account.currency)}
                            </p>
                          </div>
                        </div>

                        {account.openTrades.length > 0 ? (
                          <div className="mt-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Open Trades</p>
                            <div className="space-y-1.5">
                              {account.openTrades.map((trade) => (
                                <div
                                  key={trade.id}
                                  className="flex items-center justify-between p-2 rounded bg-muted/20 text-sm"
                                  data-testid={`row-live-trade-${trade.id}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <Badge variant={trade.direction === 'BUY' ? 'default' : 'destructive'} className="text-xs w-12 justify-center">
                                      {trade.direction}
                                    </Badge>
                                    <span className="font-medium">{trade.instrument}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {Math.abs(trade.units)} units @ {trade.entryPrice.toFixed(trade.entryPrice > 100 ? 2 : 5)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground">{formatTime(trade.openTime)}</span>
                                    <span className={`font-semibold ${trade.unrealizedPL >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                      {trade.unrealizedPL >= 0 ? '+' : ''}{formatCurrency(trade.unrealizedPL, account.currency)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground text-center mt-3 py-2">No open trades</p>
                        )}
                      </div>
                    )}
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
