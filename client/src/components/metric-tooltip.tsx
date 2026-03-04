import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

const metricDefinitions: Record<string, string> = {
  winRate: "Percentage of trades that ended in profit. Above 50% means you win more often than you lose.",
  profitFactor: "Gross profits divided by gross losses. Above 1.5 is good, above 2.0 is excellent.",
  pips: "Price movement unit. For forex, 1 pip = 0.0001. For gold, 1 pip = 0.1.",
  confluence: "Number of technical indicators agreeing on trade direction. More confluence = higher probability.",
  confidence: "How strongly the system rates this signal based on multiple technical factors.",
  stopLoss: "Price level where the trade automatically closes to limit losses.",
  takeProfit: "Price level where the trade automatically closes to lock in profits.",
  riskReward: "Ratio of potential profit to potential loss. 2:1 means you could gain twice what you risk.",
  drawdown: "Largest drop from peak balance to lowest point. Lower is better.",
  trendStrength: "How strong the current price trend is. Above 65% is considered a strong trend.",
  atr: "Average True Range - measures how much price typically moves. Used to set dynamic stop losses.",
  equity: "Your total account value including unrealized profits/losses on open trades.",
  lotSize: "Trade size unit. Micro lot = 0.01, Mini lot = 0.1, Standard lot = 1.0.",
  breakEven: "When stop loss is moved to entry price, eliminating risk of loss on the trade.",
  slMultiplier: "How many ATR units away the stop loss is placed. Higher = wider stop, fewer false exits.",
  optimization: "The system automatically tests different parameters to find the most profitable settings.",
  trailingStop: "A stop loss that moves up with price to lock in profits as the trade moves in your favour.",
  paperTrading: "Simulated trading with virtual money. All the analysis is real, but no actual money is risked.",
  returnPercent: "Total percentage gain or loss compared to your starting balance.",
};

interface MetricTooltipProps {
  metric: keyof typeof metricDefinitions | string;
  children?: React.ReactNode;
  className?: string;
}

export function MetricTooltip({ metric, children, className }: MetricTooltipProps) {
  const definition = metricDefinitions[metric];
  if (!definition) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 cursor-help ${className || ""}`}>
          {children}
          <HelpCircle className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-sm">
        <p>{definition}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function InfoTooltip({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className={`h-3 w-3 text-muted-foreground/60 shrink-0 cursor-help ${className || ""}`} />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-sm">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
