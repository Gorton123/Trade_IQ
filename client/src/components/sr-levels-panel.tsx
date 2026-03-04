import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, ArrowUp, ArrowDown } from "lucide-react";
import type { SRLevel } from "@shared/schema";

interface SRLevelsPanelProps {
  currentPrice: number;
  supportLevels: SRLevel[];
  resistanceLevels: SRLevel[];
  instrument: string;
  isLoading?: boolean;
}

const strengthColors = {
  weak: "bg-muted text-muted-foreground",
  moderate: "bg-amber-500/20 text-amber-500",
  strong: "bg-primary/20 text-primary",
};

export function SRLevelsPanel({ 
  currentPrice, 
  supportLevels, 
  resistanceLevels, 
  instrument,
  isLoading 
}: SRLevelsPanelProps) {
  const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
  const decimals = isMetal ? 2 : 5;
  const formatPrice = (price: number) => price.toFixed(decimals);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const sortedResistance = [...resistanceLevels].sort((a, b) => a.price - b.price);
  const sortedSupport = [...supportLevels].sort((a, b) => b.price - a.price);

  return (
    <Card data-testid="card-sr-levels">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Support & Resistance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            <ArrowUp className="w-3 h-3 text-bearish" />
            Resistance Levels
          </div>
          {sortedResistance.length > 0 ? (
            sortedResistance.map((level, i) => (
              <LevelRow 
                key={i} 
                level={level} 
                formatPrice={formatPrice}
                currentPrice={currentPrice}
                type="resistance"
              />
            ))
          ) : (
            <div className="text-xs text-muted-foreground py-1">No resistance levels detected</div>
          )}
        </div>

        <div className="flex items-center justify-center py-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
            <span className="text-xs text-muted-foreground">Current:</span>
            <span className="font-price font-semibold text-sm">{formatPrice(currentPrice)}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            <ArrowDown className="w-3 h-3 text-bullish" />
            Support Levels
          </div>
          {sortedSupport.length > 0 ? (
            sortedSupport.map((level, i) => (
              <LevelRow 
                key={i} 
                level={level} 
                formatPrice={formatPrice}
                currentPrice={currentPrice}
                type="support"
              />
            ))
          ) : (
            <div className="text-xs text-muted-foreground py-1">No support levels detected</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface LevelRowProps {
  level: SRLevel;
  formatPrice: (price: number) => string;
  currentPrice: number;
  type: "support" | "resistance";
}

function LevelRow({ level, formatPrice, currentPrice, type }: LevelRowProps) {
  const distance = Math.abs(level.price - currentPrice);
  const distancePercent = (distance / currentPrice) * 100;
  
  return (
    <div className={`flex items-center justify-between p-2 rounded-md ${type === 'resistance' ? 'bg-bearish' : 'bg-bullish'}`}>
      <div className="flex items-center gap-2">
        <span className={`font-price font-medium text-sm ${type === 'resistance' ? 'text-bearish' : 'text-bullish'}`}>
          {formatPrice(level.price)}
        </span>
        <Badge variant="secondary" className={`text-xs ${strengthColors[level.strength]}`}>
          {level.strength}
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{level.touches} touches</span>
        <span className="text-muted-foreground/60">|</span>
        <span>{distancePercent.toFixed(2)}%</span>
      </div>
    </div>
  );
}
