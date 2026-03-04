import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, Zap, Target, ArrowUpDown } from "lucide-react";
import type { Instrument, Timeframe } from "@shared/schema";

interface Divergence {
  type: 'bullish' | 'bearish';
  indicator: 'RSI' | 'MACD' | 'momentum';
  strength: 'regular' | 'hidden';
  confidence: number;
  description: string;
}

interface SmartMoneyConcept {
  type: 'FVG' | 'liquiditySweep' | 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
  price: number;
  confidence: number;
  description: string;
}

interface DivergenceData {
  instrument: string;
  timeframe: string;
  divergences: Divergence[];
  smartMoneyConcepts: SmartMoneyConcept[];
  dataSource: string;
}

interface DivergencePanelProps {
  instrument: Instrument;
  timeframe: Timeframe;
  currentPrice: number;
}

const conceptLabels: Record<string, string> = {
  FVG: 'Fair Value Gap',
  liquiditySweep: 'Liquidity Sweep',
  BOS: 'Break of Structure',
  CHoCH: 'Change of Character',
};

export function DivergencePanel({ instrument, timeframe, currentPrice }: DivergencePanelProps) {
  const { data, isLoading } = useQuery<DivergenceData>({
    queryKey: ["/api/divergence", instrument, timeframe],
    staleTime: 60000,
  });

  const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
  const decimals = isMetal ? 2 : 5;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-muted rounded w-1/3"></div>
              <div className="h-20 bg-muted rounded"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card data-testid="card-divergences">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-primary" />
            Divergence Analysis
            {data?.dataSource === 'twelvedata' && (
              <Badge variant="outline" className="ml-auto text-xs text-bullish border-bullish/30">
                REAL DATA
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.divergences && data.divergences.length > 0 ? (
            <div className="space-y-3">
              {data.divergences.map((div, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded-lg ${
                    div.type === 'bullish' 
                      ? 'bg-bullish/10 border border-bullish/20' 
                      : 'bg-bearish/10 border border-bearish/20'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {div.type === 'bullish' ? (
                        <TrendingUp className="h-4 w-4 text-bullish" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-bearish" />
                      )}
                      <span className="font-medium capitalize">{div.type} {div.indicator} Divergence</span>
                    </div>
                    <Badge 
                      variant="outline" 
                      className={div.type === 'bullish' ? 'text-bullish' : 'text-bearish'}
                    >
                      {div.confidence}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{div.description}</p>
                  <div className="mt-2 flex gap-2">
                    <Badge variant="outline" className="text-xs capitalize">{div.strength}</Badge>
                    <Badge variant="outline" className="text-xs">{div.indicator}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No divergences detected in current data
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-smart-money">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-warning" />
            Smart Money Concepts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.smartMoneyConcepts && data.smartMoneyConcepts.length > 0 ? (
            <div className="space-y-2">
              {data.smartMoneyConcepts.map((smc, idx) => (
                <div 
                  key={idx} 
                  className="p-3 rounded-lg bg-muted/40 flex items-start justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {smc.direction === 'bullish' ? (
                        <TrendingUp className="h-3 w-3 text-bullish" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-bearish" />
                      )}
                      <span className="text-sm font-medium">
                        {conceptLabels[smc.type] || smc.type}
                      </span>
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${smc.direction === 'bullish' ? 'text-bullish' : 'text-bearish'}`}
                      >
                        {smc.direction}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{smc.description}</p>
                  </div>
                  <div className="text-right ml-3">
                    <div className="text-sm font-mono">{smc.price.toFixed(decimals)}</div>
                    <div className="text-xs text-muted-foreground">{smc.confidence}% conf</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No smart money patterns detected
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-smc-guide">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Smart Money Guide</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <div><strong>FVG</strong> - Fair Value Gap: Imbalance zone price may revisit</div>
          <div><strong>BOS</strong> - Break of Structure: Confirms trend continuation</div>
          <div><strong>CHoCH</strong> - Change of Character: Early reversal signal</div>
          <div><strong>Liquidity Sweep</strong> - Stop hunt before reversal</div>
        </CardContent>
      </Card>
    </div>
  );
}
