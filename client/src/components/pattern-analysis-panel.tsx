import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Target, Layers, Activity } from "lucide-react";
import type { Instrument, Timeframe } from "@shared/schema";

interface Pattern {
  pattern: string;
  type: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  description: string;
  targetPrice?: number;
  stopLoss?: number;
}

interface FibonacciLevel {
  level: number;
  price: number;
  label: string;
}

interface ElliottWave {
  wave: string;
  type: 'impulse' | 'corrective';
  direction: 'up' | 'down';
  confidence: number;
  description: string;
}

interface PatternData {
  instrument: string;
  timeframe: string;
  patterns: Pattern[];
  fibonacci: FibonacciLevel[];
  elliottWave: ElliottWave | null;
  dataSource: string;
}

interface PatternAnalysisPanelProps {
  instrument: Instrument;
  timeframe: Timeframe;
  currentPrice: number;
}

export function PatternAnalysisPanel({ instrument, timeframe, currentPrice }: PatternAnalysisPanelProps) {
  const { data, isLoading } = useQuery<PatternData>({
    queryKey: ["/api/patterns", instrument, timeframe],
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
      <Card data-testid="card-patterns">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Chart Patterns Detected
            {data?.dataSource === 'twelvedata' && (
              <Badge variant="outline" className="ml-auto text-xs text-bullish border-bullish/30">
                REAL DATA
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.patterns && data.patterns.length > 0 ? (
            <div className="space-y-3">
              {data.patterns.map((pattern, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-muted/40">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {pattern.type === 'bullish' ? (
                        <TrendingUp className="h-4 w-4 text-bullish" />
                      ) : pattern.type === 'bearish' ? (
                        <TrendingDown className="h-4 w-4 text-bearish" />
                      ) : (
                        <Minus className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">{pattern.pattern}</span>
                    </div>
                    <Badge 
                      variant="outline" 
                      className={
                        pattern.type === 'bullish' ? 'text-bullish border-bullish/30' :
                        pattern.type === 'bearish' ? 'text-bearish border-bearish/30' :
                        ''
                      }
                    >
                      {pattern.confidence}% confidence
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{pattern.description}</p>
                  {(pattern.targetPrice || pattern.stopLoss) && (
                    <div className="flex gap-4 text-xs">
                      {pattern.targetPrice && (
                        <span className="text-bullish">
                          Target: {pattern.targetPrice.toFixed(decimals)}
                        </span>
                      )}
                      {pattern.stopLoss && (
                        <span className="text-bearish">
                          Stop: {pattern.stopLoss.toFixed(decimals)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No chart patterns detected in current data
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-elliott-wave">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-500" />
            Elliott Wave Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.elliottWave ? (
            <div className="p-3 rounded-lg bg-muted/40">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {data.elliottWave.direction === 'up' ? (
                    <TrendingUp className="h-4 w-4 text-bullish" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-bearish" />
                  )}
                  <span className="font-medium">{data.elliottWave.wave}</span>
                  <Badge variant="outline" className="text-xs">
                    {data.elliottWave.type}
                  </Badge>
                </div>
                <Badge variant="outline" className="text-xs">
                  {data.elliottWave.confidence}% confidence
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{data.elliottWave.description}</p>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No clear Elliott Wave pattern detected
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-fibonacci">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Fibonacci Levels
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.fibonacci && data.fibonacci.length > 0 ? (
            <div className="space-y-1">
              {data.fibonacci.map((fib, idx) => {
                const isNearPrice = Math.abs(fib.price - currentPrice) / currentPrice < 0.005;
                return (
                  <div 
                    key={idx} 
                    className={`flex items-center justify-between p-2 rounded ${isNearPrice ? 'bg-primary/20' : 'bg-muted/30'}`}
                  >
                    <span className="text-xs font-medium">{fib.label}</span>
                    <span className={`text-sm font-mono ${isNearPrice ? 'text-primary font-bold' : ''}`}>
                      {fib.price.toFixed(decimals)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              Insufficient data for Fibonacci levels
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
