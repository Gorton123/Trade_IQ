import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Calculator, PoundSterling, AlertCircle, TrendingUp, TrendingDown, ShieldAlert, AlertTriangle, Ban, Target, Rocket, Clock } from "lucide-react";
import { useState, useMemo } from "react";
import { instruments, type Instrument, type PositionSizeResult } from "@shared/schema";

// Account Growth Calculator - Shows realistic path from starting balance to target
interface GrowthProjection {
  daysToTarget: number;
  weeksToTarget: number;
  monthsToTarget: number;
  dailyGrowth: number;
  weeklyGrowth: number;
  milestones: { balance: number; trades: number; days: number }[];
  riskLevel: "conservative" | "moderate" | "aggressive";
  warning?: string;
}

function calculateGrowthProjection(
  startBalance: number,
  targetBalance: number,
  riskPercent: number,
  winRate: number,
  avgRR: number,
  tradesPerDay: number
): GrowthProjection {
  // Expected value per trade = (win rate * avg win) - (loss rate * avg loss)
  // With RR of 1.5:1 and 40% win rate: EV = (0.4 * 1.5) - (0.6 * 1) = 0.6 - 0.6 = 0
  // With RR of 2:1 and 40% win rate: EV = (0.4 * 2) - (0.6 * 1) = 0.8 - 0.6 = 0.2
  const winProbability = winRate / 100;
  const lossProbability = 1 - winProbability;
  
  // Expected R-multiple per trade (where 1R = risk amount)
  const expectedR = (winProbability * avgRR) - lossProbability;
  
  // If negative EV, no growth possible
  if (expectedR <= 0) {
    return {
      daysToTarget: Infinity,
      weeksToTarget: Infinity,
      monthsToTarget: Infinity,
      dailyGrowth: 0,
      weeklyGrowth: 0,
      milestones: [],
      riskLevel: "conservative",
      warning: "With current win rate and R:R ratio, strategy is not profitable. Improve before trading."
    };
  }
  
  // Expected daily return (compounded)
  const dailyExpectedReturn = riskPercent * expectedR * tradesPerDay;
  const dailyGrowthMultiplier = 1 + (dailyExpectedReturn / 100);
  
  // Calculate days to reach target using compound growth
  // Target = Start * (1 + daily)^days
  // days = ln(Target/Start) / ln(1 + daily)
  const daysToTarget = Math.ceil(Math.log(targetBalance / startBalance) / Math.log(dailyGrowthMultiplier));
  const weeksToTarget = Math.ceil(daysToTarget / 5); // Trading days
  const monthsToTarget = Math.ceil(daysToTarget / 22); // ~22 trading days/month
  
  // Calculate milestones
  const milestones: { balance: number; trades: number; days: number }[] = [];
  const milestoneTargets = [
    startBalance * 1.25, // +25%
    startBalance * 1.5,  // +50%
    startBalance * 2,    // Double
    startBalance * 3,    // Triple
    targetBalance
  ].filter(m => m <= targetBalance);
  
  let currentBalance = startBalance;
  let currentDay = 0;
  let totalTrades = 0;
  
  for (const target of milestoneTargets) {
    while (currentBalance < target && currentDay < 365) {
      currentBalance *= dailyGrowthMultiplier;
      currentDay++;
      totalTrades += tradesPerDay;
    }
    milestones.push({
      balance: Math.round(target),
      trades: totalTrades,
      days: currentDay
    });
  }
  
  // Determine risk level
  let riskLevel: "conservative" | "moderate" | "aggressive" = "conservative";
  if (riskPercent >= 3) riskLevel = "aggressive";
  else if (riskPercent >= 2) riskLevel = "moderate";
  
  let warning: string | undefined;
  if (riskPercent >= 4) {
    warning = "Very high risk - could blow account in bad streak";
  } else if (daysToTarget > 180) {
    warning = "Long timeline - stay patient and disciplined";
  }
  
  return {
    daysToTarget: Math.min(daysToTarget, 999),
    weeksToTarget: Math.min(weeksToTarget, 999),
    monthsToTarget: Math.min(monthsToTarget, 99),
    dailyGrowth: dailyExpectedReturn,
    weeklyGrowth: dailyExpectedReturn * 5,
    milestones,
    riskLevel,
    warning
  };
}

export function AccountGrowthCalculator() {
  const [startBalance, setStartBalance] = useState("750");
  const [targetBalance, setTargetBalance] = useState("5000");
  const [riskPercent, setRiskPercent] = useState(2);
  const [winRate, setWinRate] = useState(40);
  const [avgRR, setAvgRR] = useState(2);
  const [tradesPerDay, setTradesPerDay] = useState(3);
  
  const projection = useMemo(() => {
    const start = parseFloat(startBalance);
    const target = parseFloat(targetBalance);
    
    if (isNaN(start) || isNaN(target) || start <= 0 || target <= start) {
      return null;
    }
    
    return calculateGrowthProjection(start, target, riskPercent, winRate, avgRR, tradesPerDay);
  }, [startBalance, targetBalance, riskPercent, winRate, avgRR, tradesPerDay]);
  
  return (
    <Card data-testid="card-growth-calculator">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="w-4 h-4 text-primary" />
          Account Growth Planner
          <span className="text-xs font-normal text-muted-foreground ml-auto">Compound Calculator</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Starting Balance</Label>
            <div className="relative">
              <PoundSterling className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="number"
                value={startBalance}
                onChange={(e) => setStartBalance(e.target.value)}
                className="pl-7 font-price"
                data-testid="input-start-balance"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Target Balance</Label>
            <div className="relative">
              <PoundSterling className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="number"
                value={targetBalance}
                onChange={(e) => setTargetBalance(e.target.value)}
                className="pl-7 font-price"
                data-testid="input-target-balance"
              />
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label className="text-xs">Risk Per Trade</Label>
              <span className={`text-xs font-semibold ${riskPercent > 2 ? "text-yellow-500" : "text-primary"}`}>
                {riskPercent}%
              </span>
            </div>
            <Slider
              value={[riskPercent]}
              onValueChange={([v]) => setRiskPercent(v)}
              min={0.5}
              max={5}
              step={0.5}
              data-testid="slider-growth-risk"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label className="text-xs">Win Rate</Label>
              <span className="text-xs font-semibold text-primary">{winRate}%</span>
            </div>
            <Slider
              value={[winRate]}
              onValueChange={([v]) => setWinRate(v)}
              min={30}
              max={70}
              step={5}
              data-testid="slider-win-rate"
            />
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label className="text-xs">Risk:Reward Ratio</Label>
              <span className="text-xs font-semibold text-primary">1:{avgRR}</span>
            </div>
            <Slider
              value={[avgRR]}
              onValueChange={([v]) => setAvgRR(v)}
              min={1}
              max={4}
              step={0.5}
              data-testid="slider-rr"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label className="text-xs">Trades/Day</Label>
              <span className="text-xs font-semibold text-primary">{tradesPerDay}</span>
            </div>
            <Slider
              value={[tradesPerDay]}
              onValueChange={([v]) => setTradesPerDay(v)}
              min={1}
              max={10}
              step={1}
              data-testid="slider-trades-day"
            />
          </div>
        </div>
        
        {projection && (
          <div className="rounded-lg bg-muted/50 p-3 space-y-3">
            {projection.warning && (
              <div className="rounded p-2 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                {projection.warning}
              </div>
            )}
            
            <div className="text-center">
              <div className="text-2xl font-bold text-primary" data-testid="days-to-target">
                {projection.daysToTarget === 999 ? "999+" : projection.daysToTarget} trading days
              </div>
              <div className="text-sm text-muted-foreground">
                ~{projection.weeksToTarget} weeks / ~{projection.monthsToTarget} months
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded p-2 bg-green-500/10 text-center">
                <div className="text-xs text-muted-foreground">Daily Growth</div>
                <div className="font-semibold text-green-600 dark:text-green-400">
                  +{projection.dailyGrowth.toFixed(2)}%
                </div>
              </div>
              <div className="rounded p-2 bg-green-500/10 text-center">
                <div className="text-xs text-muted-foreground">Weekly Growth</div>
                <div className="font-semibold text-green-600 dark:text-green-400">
                  +{projection.weeklyGrowth.toFixed(1)}%
                </div>
              </div>
            </div>
            
            {projection.milestones.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Milestones
                </div>
                <div className="space-y-1">
                  {projection.milestones.slice(0, 4).map((m, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span>£{m.balance.toLocaleString()}</span>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {m.days} days ({m.trades} trades)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className={`text-xs p-2 rounded ${
              projection.riskLevel === "aggressive" 
                ? "bg-red-500/20 text-red-600 dark:text-red-400" 
                : projection.riskLevel === "moderate"
                ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
                : "bg-green-500/20 text-green-600 dark:text-green-400"
            }`}>
              Risk Level: {projection.riskLevel.charAt(0).toUpperCase() + projection.riskLevel.slice(1)}
              {projection.riskLevel === "aggressive" && " - High drawdown risk, consider lower risk %"}
            </div>
          </div>
        )}
        
        <div className="text-xs text-muted-foreground space-y-1 p-2 border rounded">
          <div className="font-medium">Reality Check:</div>
          <ul className="space-y-0.5">
            <li>• These are projections, not guarantees</li>
            <li>• Losses happen - plan for 5-10 loss streaks</li>
            <li>• Consistency beats aggressive risk</li>
            <li>• Professional funds target 20-30%/year</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

interface RiskCalculatorProps {
  defaultInstrument?: Instrument;
  defaultStopLoss?: number;
  onCalculate?: (result: PositionSizeResult) => void;
}

const pipValues: Record<Instrument, number> = {
  XAUUSD: 0.1,
  XAGUSD: 0.01,
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  USDCHF: 0.0001,
  AUDUSD: 0.0001,
  NZDUSD: 0.0001,
};

const contractSizes: Record<Instrument, number> = {
  XAUUSD: 100,
  XAGUSD: 5000,
  EURUSD: 100000,
  GBPUSD: 100000,
  USDCHF: 100000,
  AUDUSD: 100000,
  NZDUSD: 100000,
};

const MIN_SAFE_BALANCE = 50;
const MIN_RECOMMENDED_BALANCE = 200;
const MAX_RISK_PERCENT = 2;

interface RiskWarning {
  level: "critical" | "warning" | "info";
  message: string;
}

export function RiskCalculator({ defaultInstrument = "XAUUSD", defaultStopLoss, onCalculate }: RiskCalculatorProps) {
  const [balance, setBalance] = useState("5000");
  const [riskPercent, setRiskPercent] = useState(1);
  const [stopLossPips, setStopLossPips] = useState(defaultStopLoss?.toString() || "20");
  const [instrument, setInstrument] = useState<Instrument>(defaultInstrument);
  const [takeProfitPips, setTakeProfitPips] = useState("40");

  const calculation = useMemo((): PositionSizeResult | null => {
    const balanceNum = parseFloat(balance);
    const slPips = parseFloat(stopLossPips);
    const tpPips = parseFloat(takeProfitPips);
    
    if (isNaN(balanceNum) || isNaN(slPips) || balanceNum <= 0 || slPips <= 0) {
      return null;
    }

    const riskAmount = balanceNum * (riskPercent / 100);
    const pipValue = pipValues[instrument];
    const contractSize = contractSizes[instrument];
    
    const gbpUsdRate = 1.27;
    const pipValueGBP = (pipValue * contractSize) / gbpUsdRate;
    
    const lotSize = riskAmount / (slPips * pipValueGBP);
    const roundedLotSize = Math.floor(lotSize * 100) / 100;
    
    const potentialLoss = roundedLotSize * slPips * pipValueGBP;
    const potentialProfit = !isNaN(tpPips) && tpPips > 0 
      ? roundedLotSize * tpPips * pipValueGBP 
      : undefined;

    return {
      lotSize: roundedLotSize,
      riskAmount,
      pipValue: pipValueGBP,
      potentialLoss,
      potentialProfit,
    };
  }, [balance, riskPercent, stopLossPips, takeProfitPips, instrument]);

  const riskWarnings = useMemo((): RiskWarning[] => {
    const warnings: RiskWarning[] = [];
    const balanceNum = parseFloat(balance);
    
    if (isNaN(balanceNum) || balanceNum <= 0) return warnings;

    if (balanceNum < MIN_SAFE_BALANCE) {
      warnings.push({
        level: "critical",
        message: `STOP: £${balanceNum.toFixed(0)} is too low to trade safely. Minimum £${MIN_SAFE_BALANCE} recommended.`,
      });
    } else if (balanceNum < MIN_RECOMMENDED_BALANCE) {
      warnings.push({
        level: "warning",
        message: `Low balance warning: £${balanceNum.toFixed(0)} limits your options. Consider £${MIN_RECOMMENDED_BALANCE}+ for better risk management.`,
      });
    }

    if (riskPercent > MAX_RISK_PERCENT) {
      warnings.push({
        level: "warning",
        message: `${riskPercent}% risk is aggressive. Professional traders use 1-2% per trade.`,
      });
    }

    if (calculation && calculation.lotSize < 0.01) {
      warnings.push({
        level: "info",
        message: "Calculated lot is below 0.01 (minimum tradeable). Consider larger balance or higher risk.",
      });
    }

    if ((instrument === "XAUUSD" || instrument === "XAGUSD") && calculation && calculation.lotSize >= 0.1 && balanceNum < 500) {
      warnings.push({
        level: "warning",
        message: "0.1+ lots on Gold with small account is very risky. One bad trade could wipe 20%+ of your account.",
      });
    }

    return warnings;
  }, [balance, riskPercent, calculation, instrument]);

  const maxSafeLotSize = useMemo(() => {
    const balanceNum = parseFloat(balance);
    const slPips = parseFloat(stopLossPips);
    
    if (isNaN(balanceNum) || isNaN(slPips) || balanceNum <= 0 || slPips <= 0) {
      return null;
    }

    const safeRiskAmount = balanceNum * (MAX_RISK_PERCENT / 100);
    const pipValue = pipValues[instrument];
    const contractSize = contractSizes[instrument];
    const gbpUsdRate = 1.27;
    const pipValueGBP = (pipValue * contractSize) / gbpUsdRate;
    
    const maxLot = safeRiskAmount / (slPips * pipValueGBP);
    return Math.floor(maxLot * 100) / 100;
  }, [balance, stopLossPips, instrument]);

  const accountHealthScore = useMemo(() => {
    const balanceNum = parseFloat(balance);
    if (isNaN(balanceNum) || balanceNum <= 0) return 0;
    
    if (balanceNum < MIN_SAFE_BALANCE) return 0;
    if (balanceNum < MIN_RECOMMENDED_BALANCE) return 25;
    if (balanceNum < 500) return 50;
    if (balanceNum < 1000) return 75;
    return 100;
  }, [balance]);

  const handleCalculate = () => {
    if (calculation && onCalculate) {
      onCalculate(calculation);
    }
  };

  const isTradingBlocked = parseFloat(balance) < MIN_SAFE_BALANCE;

  return (
    <Card data-testid="card-risk-calculator">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="w-4 h-4 text-primary" />
          Position Size Calculator
          <span className="text-xs font-normal text-muted-foreground ml-auto">GBP Account</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {riskWarnings.length > 0 && (
          <div className="space-y-2" data-testid="risk-warnings">
            {riskWarnings.map((warning, idx) => (
              <div 
                key={idx}
                className={`rounded-lg p-3 flex items-start gap-2 text-sm ${
                  warning.level === "critical" 
                    ? "bg-destructive/20 text-destructive border border-destructive/30" 
                    : warning.level === "warning"
                    ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30"
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                }`}
                data-testid={`warning-${warning.level}-${idx}`}
              >
                {warning.level === "critical" ? (
                  <Ban className="w-4 h-4 mt-0.5 shrink-0" />
                ) : warning.level === "warning" ? (
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                {warning.message}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="balance" className="text-xs flex items-center gap-1">
              Account Balance
              {accountHealthScore < 50 && (
                <ShieldAlert className="w-3 h-3 text-yellow-500" />
              )}
            </Label>
            <div className="relative">
              <PoundSterling className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                id="balance"
                type="number"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className={`pl-7 font-price ${parseFloat(balance) < MIN_SAFE_BALANCE ? "border-destructive" : ""}`}
                data-testid="input-balance"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="instrument" className="text-xs">Instrument</Label>
            <Select value={instrument} onValueChange={(v) => setInstrument(v as Instrument)}>
              <SelectTrigger id="instrument" data-testid="select-instrument">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {instruments.map((inst) => (
                  <SelectItem key={inst} value={inst}>{inst}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Risk Per Trade</Label>
            <span className={`text-sm font-semibold ${riskPercent > MAX_RISK_PERCENT ? "text-yellow-500" : "text-primary"}`}>
              {riskPercent}%
            </span>
          </div>
          <Slider
            value={[riskPercent]}
            onValueChange={([v]) => setRiskPercent(v)}
            min={0.5}
            max={5}
            step={0.5}
            className="w-full"
            data-testid="slider-risk"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Safe (1-2%)</span>
            <span className="text-yellow-500">Risky (3%+)</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sl-pips" className="text-xs">Stop Loss (pips)</Label>
            <Input
              id="sl-pips"
              type="number"
              value={stopLossPips}
              onChange={(e) => setStopLossPips(e.target.value)}
              className="font-price"
              data-testid="input-stop-loss"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tp-pips" className="text-xs">Take Profit (pips)</Label>
            <Input
              id="tp-pips"
              type="number"
              value={takeProfitPips}
              onChange={(e) => setTakeProfitPips(e.target.value)}
              className="font-price"
              data-testid="input-take-profit"
            />
          </div>
        </div>

        {calculation && !isTradingBlocked && (
          <div className="rounded-lg bg-muted/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Recommended Lot Size</span>
              <span className="text-lg font-bold font-price" data-testid="result-lot-size">
                {calculation.lotSize.toFixed(2)}
              </span>
            </div>
            
            {maxSafeLotSize !== null && maxSafeLotSize > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" />
                  Max Safe Lot (2% risk)
                </span>
                <span className="font-price text-green-600 dark:text-green-400" data-testid="max-safe-lot">
                  {maxSafeLotSize.toFixed(2)}
                </span>
              </div>
            )}
            
            <div className="h-px bg-border" />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-3.5 h-3.5 text-bearish" />
                <span className="text-muted-foreground">Risk:</span>
                <span className="font-price text-bearish" data-testid="result-risk">
                  -£{calculation.potentialLoss.toFixed(2)}
                </span>
              </div>
              {calculation.potentialProfit && (
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-bullish" />
                  <span className="text-muted-foreground">Reward:</span>
                  <span className="font-price text-bullish" data-testid="result-reward">
                    +£{calculation.potentialProfit.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Pip value: £{calculation.pipValue.toFixed(4)}/pip
            </div>
            
            <div className="mt-2 p-2 rounded bg-green-500/10 border border-green-500/20">
              <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                Risk Management Rules:
              </div>
              <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                <li>• Never exceed {MAX_RISK_PERCENT}% per trade</li>
                <li>• Always use stop loss</li>
                <li>• Stop after 2-3 consecutive losses</li>
              </ul>
            </div>
          </div>
        )}

        {isTradingBlocked && (
          <div className="rounded-lg bg-destructive/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-destructive font-semibold">
              <Ban className="w-5 h-5" />
              Trading Not Recommended
            </div>
            <p className="text-sm text-muted-foreground">
              With £{parseFloat(balance).toFixed(0)}, even the smallest trade (0.01 lots) risks too much of your account. 
              Consider depositing at least £{MIN_SAFE_BALANCE} to trade safely with proper risk management.
            </p>
          </div>
        )}

        {!calculation && !isTradingBlocked && (
          <div className="rounded-lg bg-destructive/10 p-3 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" />
            Enter valid values to calculate position size
          </div>
        )}

        <Button 
          className="w-full" 
          onClick={handleCalculate} 
          disabled={!calculation || isTradingBlocked}
          data-testid="button-calculate"
        >
          <Calculator className="w-4 h-4 mr-2" />
          {isTradingBlocked ? "Insufficient Balance" : "Calculate Position"}
        </Button>
      </CardContent>
    </Card>
  );
}
