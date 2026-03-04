import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Users, Building2, AlertTriangle } from "lucide-react";
import type { COTData, RetailSentiment, CorrelationData, Instrument } from "@shared/schema";

export function InstitutionalDataPanel({ instrument }: { instrument?: Instrument }) {
  const { data: cotData } = useQuery<COTData[]>({
    queryKey: ["/api/cot"],
  });

  const { data: sentimentData } = useQuery<RetailSentiment[]>({
    queryKey: ["/api/sentiment"],
  });

  const { data: correlations } = useQuery<CorrelationData[]>({
    queryKey: ["/api/correlations"],
  });

  const relevantCOT = instrument 
    ? cotData?.find(c => c.instrument === (instrument === "XAUUSD" ? "Gold" : instrument))
    : cotData?.[0];

  const relevantSentiment = instrument
    ? sentimentData?.find(s => s.instrument === instrument)
    : sentimentData?.[0];

  return (
    <div className="space-y-4">
      <Card data-testid="card-cot-data">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Institutional Positioning (COT)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {relevantCOT ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Net Position:</span>
                <Badge 
                  variant="outline"
                  className={relevantCOT.netPosition > 0 ? "border-bullish text-bullish" : "border-bearish text-bearish"}
                >
                  {relevantCOT.netPosition > 0 ? "+" : ""}{relevantCOT.netPosition.toLocaleString()}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Change:</span>
                <span className={`text-sm font-medium flex items-center gap-1 ${relevantCOT.changeFromPrevious > 0 ? "text-bullish" : "text-bearish"}`}>
                  {relevantCOT.changeFromPrevious > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {relevantCOT.changeFromPrevious > 0 ? "+" : ""}{relevantCOT.changeFromPrevious.toLocaleString()}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>Speculators Long</span>
                  <span>{relevantCOT.nonCommercialLong.toLocaleString()}</span>
                </div>
                <Progress value={(relevantCOT.nonCommercialLong / (relevantCOT.nonCommercialLong + relevantCOT.nonCommercialShort)) * 100} className="h-1" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Bias:</span>
                <Badge variant={relevantCOT.bias === "bullish" ? "default" : relevantCOT.bias === "bearish" ? "destructive" : "secondary"}>
                  {relevantCOT.bias.toUpperCase()}
                </Badge>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No COT data available</p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-retail-sentiment">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />
            Retail Sentiment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {relevantSentiment ? (
            <>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-bullish font-medium">{relevantSentiment.longPercentage}% Long</span>
                <span className="text-bearish font-medium">{relevantSentiment.shortPercentage}% Short</span>
              </div>
              <div className="h-2 rounded-full bg-bearish overflow-hidden">
                <div 
                  className="h-full bg-bullish transition-all" 
                  style={{ width: `${relevantSentiment.longPercentage}%` }}
                />
              </div>
              {relevantSentiment.extremeWarning && (
                <div className="flex items-center gap-2 p-2 rounded bg-warning/10 border border-warning/30">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="text-xs text-warning">
                    Extreme positioning! Consider contrarian trade.
                  </span>
                </div>
              )}
              {relevantSentiment.contrarianSignal !== "none" && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Contrarian Signal:</span>
                  <Badge variant={relevantSentiment.contrarianSignal === "buy" ? "default" : "destructive"}>
                    {relevantSentiment.contrarianSignal?.toUpperCase()}
                  </Badge>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No sentiment data available</p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-correlations">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Pair Correlations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {correlations?.slice(0, 4).map((corr, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {corr.pair1}/{corr.pair2}
                </span>
                <div className="flex items-center gap-2">
                  <span className={corr.correlation > 0 ? "text-bullish" : "text-bearish"}>
                    {corr.correlation > 0 ? "+" : ""}{(corr.correlation * 100).toFixed(0)}%
                  </span>
                  {corr.warning && (
                    <AlertTriangle className="h-3 w-3 text-warning" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
