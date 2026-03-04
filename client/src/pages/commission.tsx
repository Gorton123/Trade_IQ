import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Wallet,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Loader2,
  Shield,
  Receipt,
  TrendingUp,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CommissionPage() {
  const { toast } = useToast();
  const [location] = useLocation();
  const [depositAmount, setDepositAmount] = useState("");
  const [topUpAmount, setTopUpAmount] = useState("");

  const { data: status, isLoading: statusLoading } = useQuery<any>({
    queryKey: ["/api/commission/status"],
  });

  const { data: balanceData, isLoading: balanceLoading } = useQuery<any>({
    queryKey: ["/api/commission/balance"],
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<any>({
    queryKey: ["/api/commission/ledger"],
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const depositResult = params.get("deposit");
    const amount = params.get("amount");
    const sessionId = params.get("session_id");

    if (depositResult === "success" && sessionId) {
      apiRequest("POST", "/api/commission/confirm-deposit", { sessionId })
        .then(() => {
          toast({ title: "Deposit successful!", description: `£${amount || ""} has been added to your commission balance.` });
          queryClient.invalidateQueries({ queryKey: ["/api/commission"] });
          window.history.replaceState({}, "", "/commission");
        })
        .catch(() => {
          toast({ title: "Deposit confirmation failed", description: "Please contact support.", variant: "destructive" });
        });
    } else if (depositResult === "cancelled") {
      toast({ title: "Deposit cancelled", description: "No charge was made." });
      window.history.replaceState({}, "", "/commission");
    }
  }, []);

  const checkoutMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await apiRequest("POST", "/api/commission/create-checkout", { amount });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({ title: "Failed to create checkout", variant: "destructive" });
    },
  });

  const topUpMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await apiRequest("POST", "/api/commission/top-up", { amount });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Top-up successful!", description: `Balance is now £${data.balance?.toFixed(2)}` });
      queryClient.invalidateQueries({ queryKey: ["/api/commission"] });
      setTopUpAmount("");
    },
    onError: () => {
      toast({ title: "Top-up failed", variant: "destructive" });
    },
  });

  const autoTopUpMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/commission/auto-top-up", { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commission"] });
    },
  });

  if (statusLoading || balanceLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (status?.isOwner) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-commission-title">Commission</h1>
          <Badge variant="outline" className="text-green-600">Owner - Commission Free</Badge>
        </div>
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Shield className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Platform Owner Account</h3>
                <p className="text-muted-foreground">You trade commission-free. No deposits required.</p>
              </div>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground mb-3">
                Your users pay 25% commission on profitable trades. Track your earnings and each user's activity from the Earnings Dashboard.
              </p>
              <Button asChild data-testid="button-go-to-earnings">
                <a href="/admin-earnings">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  View Earnings Dashboard
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!status?.isLive) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-commission-title">Commission</h1>
        </div>
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500" />
            <h3 className="text-lg font-semibold">Demo Account - No Commission Required</h3>
            <p className="text-muted-foreground">Commission deposits are only required for live OANDA accounts. Connect a live account on the Settings page to start live trading.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const balance = balanceData?.balance;
  const currentBalance = balance?.balance ?? 0;
  const isLow = currentBalance < 20;
  const isPaused = balance?.tradingPaused;
  const hasPaymentMethod = !!balance?.stripePaymentMethodId;
  const minDeposit = status?.minDeposit || 20;

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-commission-title">Commission Balance</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/commission"] })}
          data-testid="button-refresh-commission"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {isPaused && (
        <Card className="border-red-500/50 bg-red-50 dark:bg-red-950/20">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-700 dark:text-red-400">Trading Paused</h3>
              <p className="text-sm text-red-600 dark:text-red-300">Your commission balance is depleted and the grace period has expired. Top up your balance to resume trading.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-commission-balance">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Commission Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${isLow ? 'text-red-500' : 'text-green-600'}`}>
              £{currentBalance.toFixed(2)}
            </div>
            {isLow && !isPaused && (
              <p className="text-xs text-yellow-600 mt-1">Low balance - auto top-up will trigger</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-commission-rate">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Commission Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">25%</div>
            <p className="text-xs text-muted-foreground mt-1">Of profit per winning trade</p>
          </CardContent>
        </Card>

        <Card data-testid="card-oanda-balance">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">OANDA Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">£{(status?.oandaBalance || 0).toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">Min deposit: £{minDeposit}</p>
          </CardContent>
        </Card>
      </div>

      {!balance ? (
        <Card data-testid="card-initial-deposit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Initial Commission Deposit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              To start live trading, you need to deposit a commission balance. This covers the 25% commission on your profitable trades. Minimum deposit is 10% of your OANDA balance (£{minDeposit}).
            </p>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label>Deposit Amount (£)</Label>
                <Input
                  type="number"
                  min={minDeposit}
                  step="5"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder={`Min £${minDeposit}`}
                  data-testid="input-deposit-amount"
                />
              </div>
              <Button
                className="self-end"
                disabled={checkoutMutation.isPending || !depositAmount || Number(depositAmount) < minDeposit}
                onClick={() => checkoutMutation.mutate(Number(depositAmount))}
                data-testid="button-deposit"
              >
                {checkoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
                Pay with Card
              </Button>
            </div>
            <div className="flex gap-2">
              {[minDeposit, minDeposit * 2, minDeposit * 3].map((preset) => (
                <Button
                  key={preset}
                  variant="outline"
                  size="sm"
                  onClick={() => setDepositAmount(String(preset))}
                  data-testid={`button-preset-${preset}`}
                >
                  £{preset}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card data-testid="card-top-up">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Top Up Balance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasPaymentMethod ? (
                <>
                  <p className="text-sm text-muted-foreground">Quick top-up using your saved card.</p>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        type="number"
                        min="10"
                        step="5"
                        value={topUpAmount}
                        onChange={(e) => setTopUpAmount(e.target.value)}
                        placeholder="Amount (min £10)"
                        data-testid="input-topup-amount"
                      />
                    </div>
                    <Button
                      disabled={topUpMutation.isPending || !topUpAmount || Number(topUpAmount) < 10}
                      onClick={() => topUpMutation.mutate(Number(topUpAmount))}
                      data-testid="button-topup"
                    >
                      {topUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Top Up"}
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    {[20, 50, 100].map((preset) => (
                      <Button
                        key={preset}
                        variant="outline"
                        size="sm"
                        onClick={() => setTopUpAmount(String(preset))}
                        data-testid={`button-topup-preset-${preset}`}
                      >
                        £{preset}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Add funds via card payment.</p>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        type="number"
                        min="10"
                        step="5"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="Amount (min £10)"
                        data-testid="input-deposit-amount"
                      />
                    </div>
                    <Button
                      disabled={checkoutMutation.isPending || !depositAmount || Number(depositAmount) < 10}
                      onClick={() => checkoutMutation.mutate(Number(depositAmount))}
                      data-testid="button-deposit"
                    >
                      {checkoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pay"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-auto-topup">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Auto Top-Up
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Automatically top up your balance when it drops below £20 to prevent trading interruptions.
              </p>
              <div className="flex items-center justify-between">
                <Label>Auto top-up enabled</Label>
                <Switch
                  checked={status?.autoTopUpEnabled ?? false}
                  onCheckedChange={(checked) => autoTopUpMutation.mutate(checked)}
                  disabled={!hasPaymentMethod}
                  data-testid="switch-auto-topup"
                />
              </div>
              {!hasPaymentMethod && (
                <p className="text-xs text-yellow-600">Make a card payment first to enable auto top-up.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card data-testid="card-commission-history">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ledgerLoading ? (
            <Skeleton className="h-32" />
          ) : !ledgerData?.ledger?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No transactions yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {ledgerData.ledger.map((entry: any) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  data-testid={`row-ledger-${entry.id}`}
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
                    <p className="text-xs text-muted-foreground">Bal: £{entry.balanceAfter.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h4 className="font-semibold mb-2">How Commission Works</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• 25% commission is automatically deducted from your deposit balance on each profitable trade</li>
            <li>• Losing trades have zero commission — you only pay when you profit</li>
            <li>• When your balance drops below £20, your saved card is automatically charged</li>
            <li>• If auto top-up fails, you have a 24-hour grace period before trading pauses</li>
            <li>• Demo accounts trade freely with no commission</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
