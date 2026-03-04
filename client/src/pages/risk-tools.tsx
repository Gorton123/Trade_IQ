import { RiskCalculator, AccountGrowthCalculator } from "@/components/risk-calculator";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Coins, TrendingUp, TrendingDown, DollarSign } from "lucide-react";

function GoldLotCalculator() {
  const accountSizes = [
    { balance: 500, recommendedLot: 0.01, maxRiskPips: 50, riskPerTrade: 5 },
    { balance: 1000, recommendedLot: 0.01, maxRiskPips: 100, riskPerTrade: 10 },
    { balance: 2000, recommendedLot: 0.02, maxRiskPips: 100, riskPerTrade: 20 },
    { balance: 2500, recommendedLot: 0.03, maxRiskPips: 83, riskPerTrade: 25 },
    { balance: 5000, recommendedLot: 0.05, maxRiskPips: 100, riskPerTrade: 50 },
    { balance: 10000, recommendedLot: 0.1, maxRiskPips: 100, riskPerTrade: 100 },
  ];

  return (
    <Card data-testid="card-gold-lot-guide">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Coins className="h-4 w-4 text-yellow-500" />
          XAUUSD (Gold) Lot Size Guide
        </CardTitle>
        <CardDescription>
          Safe lot sizes based on your account balance (1% risk per trade)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-yellow-500/10 rounded-lg p-3 text-sm">
          <strong className="text-yellow-500">Gold Trading Reality:</strong>
          <ul className="mt-2 space-y-1 text-muted-foreground text-xs">
            <li>0.01 lot = ~$0.10 per pip (10 cents)</li>
            <li>0.1 lot = ~$1.00 per pip (1 dollar)</li>
            <li>Gold moves 100-300+ pips daily - volatile!</li>
            <li>Typical stop loss: 50-150 pips</li>
          </ul>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-1 text-xs text-muted-foreground">Account</th>
                <th className="text-center py-2 px-1 text-xs text-muted-foreground">Lot Size</th>
                <th className="text-center py-2 px-1 text-xs text-muted-foreground">Max SL</th>
                <th className="text-right py-2 px-1 text-xs text-muted-foreground">Risk/Trade</th>
              </tr>
            </thead>
            <tbody>
              {accountSizes.map((row) => (
                <tr key={row.balance} className="border-b border-muted/50">
                  <td className="py-2 px-1 font-medium">${row.balance.toLocaleString()}</td>
                  <td className="text-center py-2 px-1">
                    <Badge variant="outline">{row.recommendedLot}</Badge>
                  </td>
                  <td className="text-center py-2 px-1 text-muted-foreground">{row.maxRiskPips} pips</td>
                  <td className="text-right py-2 px-1">${row.riskPerTrade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-red-500/10 rounded-lg p-3 text-sm">
          <strong className="text-red-500">Warning: $1,000 account with 0.1 lot</strong>
          <p className="text-xs text-muted-foreground mt-1">
            At 0.1 lot on gold, a 100-pip stop loss = $100 (10% of account). 
            This is too aggressive! Use 0.01-0.02 lots until you reach $2,500+.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-3 rounded-lg bg-green-500/10">
            <TrendingUp className="h-5 w-5 mx-auto text-green-500 mb-1" />
            <div className="text-xs text-muted-foreground">Expected Signals</div>
            <div className="font-bold text-lg">2-4/day</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-yellow-500/10">
            <DollarSign className="h-5 w-5 mx-auto text-yellow-500 mb-1" />
            <div className="text-xs text-muted-foreground">Avg Move (London)</div>
            <div className="font-bold text-lg">150+ pips</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RiskToolsPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Risk Management Tools</h1>
        <p className="text-sm md:text-base text-muted-foreground">Calculate position sizes and plan your growth</p>
      </div>

      <Card className="bg-yellow-500/10 border-yellow-500/20" data-testid="card-risk-warning">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-500">Risk Management Rules</h3>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                <li>Never risk more than 2% per trade (1% recommended for beginners)</li>
                <li>Maximum 2-4 trades per day to avoid overtrading</li>
                <li>Only take signals with 70+ confidence score</li>
                <li>Trade during London/NY sessions for best volatility</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <RiskCalculator />
        </div>
        <div className="space-y-6">
          <GoldLotCalculator />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <AccountGrowthCalculator />
      </div>
    </div>
  );
}
