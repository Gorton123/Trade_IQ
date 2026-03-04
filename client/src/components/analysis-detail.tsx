import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  Activity,
  BarChart3,
  Target,
  Layers,
  FlaskConical,
  Database,
  Crosshair
} from "lucide-react";
import { TradeSignalCard } from "./trade-signal-card";
import { SRLevelsPanel } from "./sr-levels-panel";
import { RiskCalculator } from "./risk-calculator";
import { TradingViewChart } from "./tradingview-chart";
import { TradeChart } from "./trade-chart";
import { PatternAnalysisPanel } from "./pattern-analysis-panel";
import { BacktestPanel } from "./backtest-panel";
import { DivergencePanel } from "./divergence-panel";
import BatchBacktestPanel from "./batch-backtest-panel";
import type { MarketAnalysis, TradeSignal, Timeframe } from "@shared/schema";

interface AnalysisDetailProps {
  analysis: MarketAnalysis;
  signal: TradeSignal | null;
  onBack: () => void;
  onTimeframeChange: (tf: Timeframe) => void;
  isLoading?: boolean;
}

const timeframeOptions: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

export function AnalysisDetail({ 
  analysis, 
  signal, 
  onBack, 
  onTimeframeChange,
  isLoading 
}: AnalysisDetailProps) {
  const isMetal = analysis.instrument === "XAUUSD" || analysis.instrument === "XAGUSD";
  const isSilver = analysis.instrument === "XAGUSD";
  const decimals = isMetal ? 2 : 5;
  const isPositive = analysis.changePercent >= 0;

  return (
    <div className="space-y-4" data-testid="analysis-detail">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onBack}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${isSilver ? 'bg-slate-400/20 text-slate-400' : isMetal ? 'bg-amber-500/20 text-gold' : 'bg-primary/20 text-primary'}`}>
              {analysis.instrument === "XAGUSD" ? "Ag" : isMetal ? "Au" : analysis.instrument.slice(0, 2)}
            </div>
            <div>
              <h2 className="text-xl font-bold">{analysis.instrument}</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-price">{analysis.currentPrice.toFixed(decimals)}</span>
                <span className={isPositive ? 'text-bullish' : 'text-bearish'}>
                  {isPositive ? '+' : ''}{analysis.changePercent.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-1 flex-wrap" data-testid="timeframe-selector">
          {timeframeOptions.map((tf) => (
            <Button
              key={tf}
              variant={analysis.timeframe === tf ? "default" : "ghost"}
              size="sm"
              className="px-2 text-xs sm:px-3 sm:text-sm"
              onClick={() => onTimeframeChange(tf)}
              data-testid={`button-tf-${tf}`}
            >
              {tf}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Market State"
          value={analysis.marketState.replace('_', ' ')}
          icon={
            analysis.marketState === 'uptrend' ? <TrendingUp className="w-4 h-4 text-bullish" /> :
            analysis.marketState === 'downtrend' ? <TrendingDown className="w-4 h-4 text-bearish" /> :
            <Minus className="w-4 h-4 text-muted-foreground" />
          }
          valueClass={
            analysis.marketState === 'uptrend' ? 'text-bullish' :
            analysis.marketState === 'downtrend' ? 'text-bearish' : ''
          }
        />
        <StatCard
          label="Trend Strength"
          value={`${analysis.trend.strength}%`}
          icon={<Activity className="w-4 h-4 text-primary" />}
        />
        <StatCard
          label="Volatility"
          value={analysis.volatility}
          icon={<BarChart3 className="w-4 h-4 text-amber-500" />}
          valueClass="capitalize"
        />
        <StatCard
          label="Timeframe"
          value={analysis.timeframe}
          icon={<Target className="w-4 h-4 text-muted-foreground" />}
        />
      </div>

      <Tabs defaultValue="chart" className="w-full">
        <TabsList className="w-full flex flex-wrap gap-1">
          <TabsTrigger value="chart" data-testid="tab-chart" className="flex-1 min-w-[80px]">
            <BarChart3 className="h-3 w-3 mr-1" />
            Chart
          </TabsTrigger>
          <TabsTrigger value="trades" data-testid="tab-trades" className="flex-1 min-w-[80px]">
            <Crosshair className="h-3 w-3 mr-1" />
            My Trades
          </TabsTrigger>
          <TabsTrigger value="signal" data-testid="tab-signal" className="flex-1 min-w-[80px]">
            <Target className="h-3 w-3 mr-1" />
            Signal
          </TabsTrigger>
          <TabsTrigger value="patterns" data-testid="tab-patterns" className="flex-1 min-w-[80px]">
            <Layers className="h-3 w-3 mr-1" />
            Patterns
          </TabsTrigger>
          <TabsTrigger value="backtest" data-testid="tab-backtest" className="flex-1 min-w-[80px]">
            <FlaskConical className="h-3 w-3 mr-1" />
            Backtest
          </TabsTrigger>
          <TabsTrigger value="levels" data-testid="tab-levels" className="flex-1 min-w-[80px]">
            S/R
          </TabsTrigger>
          <TabsTrigger value="divergence" data-testid="tab-divergence" className="flex-1 min-w-[80px]">
            <Activity className="h-3 w-3 mr-1" />
            SMC
          </TabsTrigger>
          <TabsTrigger value="strategy" data-testid="tab-strategy" className="flex-1 min-w-[80px]">
            <Database className="h-3 w-3 mr-1" />
            Strategy
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="chart" className="mt-4">
          <TradingViewChart instrument={analysis.instrument} timeframe={analysis.timeframe} />
        </TabsContent>
        
        <TabsContent value="trades" className="mt-4">
          <TradeChart instrument={analysis.instrument} timeframe={analysis.timeframe} />
        </TabsContent>
        
        <TabsContent value="signal" className="mt-4">
          <TradeSignalCard signal={signal} isLoading={isLoading} />
        </TabsContent>
        
        <TabsContent value="patterns" className="mt-4">
          <PatternAnalysisPanel 
            instrument={analysis.instrument} 
            timeframe={analysis.timeframe}
            currentPrice={analysis.currentPrice}
          />
        </TabsContent>
        
        <TabsContent value="backtest" className="mt-4">
          <BacktestPanel instrument={analysis.instrument} timeframe={analysis.timeframe} />
        </TabsContent>
        
        <TabsContent value="levels" className="mt-4">
          <SRLevelsPanel
            currentPrice={analysis.currentPrice}
            supportLevels={analysis.supportLevels}
            resistanceLevels={analysis.resistanceLevels}
            instrument={analysis.instrument}
            isLoading={isLoading}
          />
        </TabsContent>
        
        <TabsContent value="divergence" className="mt-4">
          <DivergencePanel 
            instrument={analysis.instrument} 
            timeframe={analysis.timeframe}
            currentPrice={analysis.currentPrice}
          />
        </TabsContent>
        
        <TabsContent value="strategy" className="mt-4">
          <BatchBacktestPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  valueClass?: string;
}

function StatCard({ label, value, icon, valueClass = "" }: StatCardProps) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={`text-sm font-semibold capitalize ${valueClass}`}>
        {value}
      </div>
    </Card>
  );
}
