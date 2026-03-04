import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, TrendingDown, AlertCircle, CheckCircle } from "lucide-react";
import type { LearningPerformance } from "@shared/schema";

export function LearningInsights() {
  const { data: learning, isLoading } = useQuery<LearningPerformance>({
    queryKey: ["/api/learning/performance"],
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-learning">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Learning Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading learning data...</p>
        </CardContent>
      </Card>
    );
  }

  const totalTrades = Object.values(learning?.byTimeframe || {}).reduce((sum, tf) => sum + tf.total, 0);
  const hasEnoughData = totalTrades >= (learning?.minTradesForLearning || 5);

  return (
    <Card data-testid="card-learning">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4" />
          Learning Insights
          {hasEnoughData ? (
            <Badge variant="default" className="ml-auto text-xs">Active</Badge>
          ) : (
            <Badge variant="secondary" className="ml-auto text-xs">
              {learning?.minTradesForLearning || 5 - totalTrades} more trades needed
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasEnoughData ? (
          <div className="text-sm text-muted-foreground flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Need at least {learning?.minTradesForLearning || 5} closed trades before learning kicks in. 
              Keep simulating trades to build the dataset!
            </p>
          </div>
        ) : (
          <>
            {learning && learning.overallAdjustment !== 0 && (
              <div className="flex items-center gap-2 text-sm">
                {learning.overallAdjustment > 0 ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-green-500 font-medium">
                      +{learning.overallAdjustment}% confidence boost applied
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    <span className="text-yellow-500 font-medium">
                      {learning.overallAdjustment}% confidence adjustment
                    </span>
                  </>
                )}
              </div>
            )}

            {learning?.bestSetups && learning.bestSetups.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-green-500" />
                  BEST PERFORMING SETUPS
                </h4>
                <div className="space-y-1">
                  {learning.bestSetups.map((setup, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="capitalize">{setup.description}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="text-xs bg-green-500/20 text-green-500 hover:bg-green-500/30">
                          {setup.winRate.toFixed(0)}% win
                        </Badge>
                        <span className="text-muted-foreground">({setup.totalTrades} trades)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {learning?.worstSetups && learning.worstSetups.length > 0 && learning.worstSetups[0].winRate < 50 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-red-500" />
                  SETUPS TO AVOID
                </h4>
                <div className="space-y-1">
                  {learning.worstSetups.filter(s => s.winRate < 50).slice(0, 2).map((setup, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="capitalize">{setup.description}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-xs">
                          {setup.winRate.toFixed(0)}% win
                        </Badge>
                        <span className="text-muted-foreground">({setup.totalTrades} trades)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 pt-2 border-t">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">By Volatility</p>
                {Object.entries(learning?.byVolatility || {}).map(([key, val]) => (
                  val.total > 0 && (
                    <div key={key} className="text-xs">
                      <span className="capitalize">{key}:</span>{" "}
                      <span className={val.winRate >= 50 ? "text-green-500" : "text-red-500"}>
                        {val.winRate.toFixed(0)}%
                      </span>
                    </div>
                  )
                ))}
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">By Market</p>
                {Object.entries(learning?.byMarketState || {}).map(([key, val]) => (
                  val.total > 0 && (
                    <div key={key} className="text-xs">
                      <span className="capitalize">{key}:</span>{" "}
                      <span className={val.winRate >= 50 ? "text-green-500" : "text-red-500"}>
                        {val.winRate.toFixed(0)}%
                      </span>
                    </div>
                  )
                ))}
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">By Trend</p>
                {Object.entries(learning?.byTrendStrength || {}).map(([key, val]) => (
                  val.total > 0 && (
                    <div key={key} className="text-xs">
                      <span className="capitalize">{key}:</span>{" "}
                      <span className={val.winRate >= 50 ? "text-green-500" : "text-red-500"}>
                        {val.winRate.toFixed(0)}%
                      </span>
                    </div>
                  )
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
