import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, Radio, AlertCircle, Clock, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Instrument } from "@shared/schema";

interface LivePriceData {
  instrument: Instrument;
  bid: number;
  ask: number;
  timestamp: Date | string;
  source: 'oanda' | 'twelvedata' | 'connecting' | 'no_api_key' | 'fallback';
}

interface CacheStatus {
  pricesCacheAgeMinutes: number;
  pricesCacheValid: boolean;
  mode: string;
  message: string;
}

const instruments: Instrument[] = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDCHF", "AUDUSD", "NZDUSD"];

const instrumentNames: Record<Instrument, string> = {
  XAUUSD: "Gold",
  XAGUSD: "Silver",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDCHF: "USD/CHF",
  AUDUSD: "AUD/USD",
  NZDUSD: "NZD/USD",
};

const instrumentFlags: Record<Instrument, string> = {
  XAUUSD: "Au",
  XAGUSD: "Ag",
  EURUSD: "EU",
  GBPUSD: "GB",
  USDCHF: "CH",
  AUDUSD: "AU",
  NZDUSD: "NZ",
};

interface RefreshResponse {
  success: boolean;
  message: string;
  nextRefreshIn?: number;
}

export function LivePricesPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const { data: prices, isLoading } = useQuery<LivePriceData[]>({
    queryKey: ["/api/prices/live"],
    refetchInterval: 10000,
    staleTime: 5000,
  });

  // Cache status to show data age
  const { data: cacheStatus } = useQuery<CacheStatus>({
    queryKey: ["/api/cache/status"],
    refetchInterval: 60000, // Check cache status every minute (cheap local call)
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/prices/refresh");
      return res.json() as Promise<RefreshResponse>;
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/prices/live"] });
        queryClient.invalidateQueries({ queryKey: ["/api/cache/status"] });
        toast({ title: "Prices refreshed", description: "Latest market data loaded (1 API call used)" });
      } else {
        toast({ 
          title: "Refresh limited", 
          description: data.message,
          variant: "destructive"
        });
      }
    },
  });

  const hasRealData = prices?.some(p => p.source === 'oanda' || p.source === 'twelvedata');
  const needsApiKey = prices?.every(p => p.source === 'fallback' || p.source === 'no_api_key');
  const cacheAge = cacheStatus?.pricesCacheAgeMinutes ?? -1;
  
  const selectedInstrument = instruments[selectedIndex];
  const selectedPrice = prices?.find(p => p.instrument === selectedInstrument);

  const goToPrev = () => {
    setSelectedIndex((prev) => (prev === 0 ? instruments.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setSelectedIndex((prev) => (prev === instruments.length - 1 ? 0 : prev + 1));
  };

  const isMetal = selectedInstrument === "XAUUSD" || selectedInstrument === "XAGUSD";
  const decimals = isMetal ? 2 : 5;
  const spread = selectedPrice 
    ? ((selectedPrice.ask - selectedPrice.bid) * (selectedInstrument === "XAUUSD" ? 10 : isMetal ? 100 : 100000)).toFixed(1)
    : "0.0";

  return (
    <Card data-testid="card-live-prices" className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-warning" />
          Live Prices
          {hasRealData ? (
            <Badge variant="outline" className="ml-auto text-xs text-bullish border-bullish/30">
              <Radio className="h-3 w-3 mr-1" />
              LIVE
            </Badge>
          ) : needsApiKey ? (
            <Badge variant="outline" className="ml-auto text-xs text-warning">
              <AlertCircle className="h-3 w-3 mr-1" />
              No Data Source
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto text-xs text-warning">
              <RefreshCw className="h-3 w-3 mr-1" />
              Click refresh
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            data-testid="button-refresh-prices"
          >
            <RefreshCw className={`h-3 w-3 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {needsApiKey && !hasRealData && (
          <div className="p-2 rounded bg-warning/10 border border-warning/30 text-xs text-warning">
            No live data source connected. Connect OANDA for real-time prices.
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground text-center py-4">Loading prices...</div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Button 
                size="icon" 
                variant="ghost" 
                onClick={goToPrev}
                className="h-8 w-8"
                data-testid="button-prev-pair"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <div className="flex-1 flex gap-1 justify-center overflow-x-auto py-1">
                {instruments.map((inst, idx) => (
                  <Button
                    key={inst}
                    size="sm"
                    variant={idx === selectedIndex ? "default" : "ghost"}
                    onClick={() => setSelectedIndex(idx)}
                    className="min-w-[40px] h-7 px-2 text-xs"
                    data-testid={`button-select-${inst}`}
                  >
                    {instrumentFlags[inst]}
                  </Button>
                ))}
              </div>
              
              <Button 
                size="icon" 
                variant="ghost" 
                onClick={goToNext}
                className="h-8 w-8"
                data-testid="button-next-pair"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div 
              className="p-4 rounded-lg bg-muted/40 text-center"
              data-testid={`price-display-${selectedInstrument}`}
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="text-lg font-semibold">{instrumentNames[selectedInstrument]}</span>
                {hasRealData && (
                  <Badge variant="outline" className="text-xs text-bullish border-bullish/30">
                    {prices?.find(p => p.instrument === selectedInstrument)?.source === 'oanda' ? 'OANDA' : 'REAL'}
                  </Badge>
                )}
              </div>
              
              {selectedPrice ? (
                <>
                  <div className="flex items-center justify-center gap-3 text-2xl font-mono">
                    <span className="text-bearish">{selectedPrice.bid.toFixed(decimals)}</span>
                    <span className="text-muted-foreground text-lg">/</span>
                    <span className="text-bullish">{selectedPrice.ask.toFixed(decimals)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Spread: {spread} pips
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">Loading...</div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1">
              {prices?.filter(p => p.instrument !== selectedInstrument).slice(0, 3).map((price) => {
                const isG = price.instrument === "XAUUSD" || price.instrument === "XAGUSD";
                const dec = isG ? 2 : 5;
                return (
                  <button
                    key={price.instrument}
                    onClick={() => setSelectedIndex(instruments.indexOf(price.instrument))}
                    className="p-2 rounded bg-muted/20 hover-elevate text-center cursor-pointer"
                    data-testid={`price-quick-${price.instrument}`}
                  >
                    <div className="text-xs font-medium">{instrumentFlags[price.instrument]}</div>
                    <div className="text-xs text-bullish">{price.ask.toFixed(dec)}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
