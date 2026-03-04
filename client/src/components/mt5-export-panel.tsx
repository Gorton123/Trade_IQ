import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Copy, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Instrument, Timeframe } from "@shared/schema";

interface MT5Signal {
  hasSignal: boolean;
  message?: string;
  symbol?: string;
  timeframe?: string;
  direction?: 'buy' | 'sell';
  entryPrice?: number;
  entryRangeMin?: number;
  entryRangeMax?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  confidence?: number;
  reason?: string;
  generatedAt?: string;
  validUntil?: string;
}

interface MT5ExportPanelProps {
  instrument: Instrument;
  timeframe: Timeframe;
}

export function MT5ExportPanel({ instrument, timeframe }: MT5ExportPanelProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<MT5Signal>({
    queryKey: ["/api/mt5-export", instrument, timeframe],
    staleTime: 30000,
  });

  const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
  const decimals = isMetal ? 2 : 5;

  const handleCopySignal = () => {
    if (!data?.hasSignal) return;

    const signalText = `
TradeIQ Signal Export
=====================
Symbol: ${data.symbol}
Timeframe: ${data.timeframe}
Direction: ${data.direction?.toUpperCase()}
Entry: ${data.entryPrice?.toFixed(decimals)}
Entry Range: ${data.entryRangeMin?.toFixed(decimals)} - ${data.entryRangeMax?.toFixed(decimals)}
Stop Loss: ${data.stopLoss?.toFixed(decimals)}
Take Profit 1: ${data.takeProfit1?.toFixed(decimals)}
Take Profit 2: ${data.takeProfit2?.toFixed(decimals)}
Take Profit 3: ${data.takeProfit3?.toFixed(decimals)}
Confidence: ${data.confidence}%
Reason: ${data.reason}
Generated: ${data.generatedAt}
Valid Until: ${data.validUntil}
    `.trim();

    navigator.clipboard.writeText(signalText);
    setCopied(true);
    toast({
      title: "Signal Copied",
      description: "Signal details copied to clipboard for MT5",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJSON = () => {
    if (!data?.hasSignal) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tradeiq_signal_${instrument}_${timeframe}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Signal Downloaded",
      description: "JSON file ready for MT5 EA import",
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/3"></div>
            <div className="h-20 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-mt5-export">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ExternalLink className="h-4 w-4 text-primary" />
          MT5 Signal Export
          {data?.hasSignal ? (
            <Badge variant="outline" className="ml-auto text-xs text-bullish border-bullish/30">
              <CheckCircle className="h-3 w-3 mr-1" />
              Signal Ready
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto text-xs text-muted-foreground">
              <XCircle className="h-3 w-3 mr-1" />
              No Signal
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data?.hasSignal ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-2 rounded bg-muted/30">
                <div className="text-xs text-muted-foreground">Direction</div>
                <div className={`font-bold ${data.direction === 'buy' ? 'text-bullish' : 'text-bearish'}`}>
                  {data.direction?.toUpperCase()}
                </div>
              </div>
              <div className="p-2 rounded bg-muted/30">
                <div className="text-xs text-muted-foreground">Entry Price</div>
                <div className="font-bold font-mono">{data.entryPrice?.toFixed(decimals)}</div>
              </div>
              <div className="p-2 rounded bg-muted/30">
                <div className="text-xs text-muted-foreground">Stop Loss</div>
                <div className="font-bold font-mono text-bearish">{data.stopLoss?.toFixed(decimals)}</div>
              </div>
              <div className="p-2 rounded bg-muted/30">
                <div className="text-xs text-muted-foreground">Take Profit 1</div>
                <div className="font-bold font-mono text-bullish">{data.takeProfit1?.toFixed(decimals)}</div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/20 text-xs">
              <div className="flex justify-between mb-1">
                <span className="text-muted-foreground">Confidence:</span>
                <span className="font-medium">{data.confidence}%</span>
              </div>
              <div className="flex justify-between mb-1">
                <span className="text-muted-foreground">Valid Until:</span>
                <span className="font-medium">{new Date(data.validUntil || '').toLocaleTimeString()}</span>
              </div>
              <div className="text-muted-foreground mt-2">{data.reason}</div>
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={handleCopySignal} 
                variant="outline" 
                size="sm"
                className="flex-1"
                data-testid="button-copy-signal"
              >
                {copied ? <CheckCircle className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? 'Copied!' : 'Copy Signal'}
              </Button>
              <Button 
                onClick={handleDownloadJSON} 
                variant="outline" 
                size="sm"
                className="flex-1"
                data-testid="button-download-json"
              >
                <Download className="h-4 w-4 mr-2" />
                Download JSON
              </Button>
            </div>

            <div className="text-xs text-muted-foreground text-center">
              Import this signal into your MT5 Expert Advisor for automated execution
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <XCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              {data?.message || 'No trade signal available for export'}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Check back when a high-probability setup is detected
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
