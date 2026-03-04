import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/header";
import { MarketCard, MarketCardSkeleton } from "@/components/market-card";
import { MarketOverview, getCurrentSession, MarketConditionBanner } from "@/components/market-overview";
import { AnalysisDetail } from "@/components/analysis-detail";
import { Disclaimer } from "@/components/disclaimer";
import { TradeJournal } from "@/components/trade-journal";
import { PriceAlerts } from "@/components/price-alerts";
import { MultiTimeframeView } from "@/components/multi-timeframe-view";
import { SmartMoneyPanel } from "@/components/smart-money-panel";
import { SimulationDashboard } from "@/components/simulation-dashboard";
import { InstitutionalDataPanel } from "@/components/institutional-data";
import { RiskManagementPanel } from "@/components/risk-management-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { Activity, TrendingUp, TrendingDown, AlertCircle, Wifi, WifiOff } from "lucide-react";
import type { MarketAnalysis, TradeSignal, Instrument, Timeframe } from "@shared/schema";

const instrumentList: Instrument[] = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDCHF", "AUDUSD", "NZDUSD"];

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>("1h");
  
  const sessionInfo = getCurrentSession();

  const { data: marketData, isLoading: isLoadingMarkets, dataUpdatedAt } = useQuery<MarketAnalysis[]>({
    queryKey: ["/api/markets"],
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const { data: analysisData, isLoading: isLoadingAnalysis } = useQuery<MarketAnalysis>({
    queryKey: ["/api/analysis", selectedInstrument, selectedTimeframe],
    enabled: !!selectedInstrument,
    staleTime: 30000,
  });

  const { data: signalData, isLoading: isLoadingSignal } = useQuery<TradeSignal | null>({
    queryKey: ["/api/signal", selectedInstrument, selectedTimeframe],
    enabled: !!selectedInstrument,
    staleTime: 30000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/refresh"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      if (selectedInstrument) {
        queryClient.invalidateQueries({ queryKey: ["/api/analysis"] });
        queryClient.invalidateQueries({ queryKey: ["/api/signal"] });
      }
    },
  });

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  const handleInstrumentSelect = (instrument: Instrument) => {
    setSelectedInstrument(instrument);
  };

  const handleBack = () => {
    setSelectedInstrument(null);
  };

  const handleTimeframeChange = (tf: Timeframe) => {
    setSelectedTimeframe(tf);
  };

  const getMarketCondition = () => {
    if (!sessionInfo.marketOpen) {
      return { condition: "avoid" as const, message: "Forex markets are closed during weekends. Wait for Asian session open." };
    }
    
    if (marketData) {
      const highRiskCount = marketData.filter(m => m.marketState === "high_risk" || m.marketState === "no_trade").length;
      if (highRiskCount >= 4) {
        return { condition: "avoid" as const, message: "Multiple instruments showing high-risk conditions. Consider standing aside." };
      }
      if (highRiskCount >= 2) {
        return { condition: "caution" as const, message: "Some instruments showing elevated risk. Trade selectively." };
      }
    }
    
    return { condition: "optimal" as const, message: "Market conditions appear favorable for trading. Focus on high-probability setups." };
  };

  const marketCondition = getMarketCondition();

  return (
    <div className="min-h-screen bg-background">
      <Header 
        onRefresh={handleRefresh}
        isRefreshing={refreshMutation.isPending}
        lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined}
      />

      <main className="container mx-auto px-4 py-6">
        <SystemStatusBanner />
        
        {selectedInstrument && analysisData ? (
          <div className="space-y-6">
            <AnalysisDetail
              analysis={analysisData}
              signal={signalData || null}
              onBack={handleBack}
              onTimeframeChange={handleTimeframeChange}
              isLoading={isLoadingAnalysis || isLoadingSignal}
            />
            
            <SmartMoneyPanel 
              instrument={selectedInstrument}
              timeframe={selectedTimeframe}
              currentPrice={analysisData.currentPrice}
            />
            
            <MultiTimeframeView instrument={selectedInstrument} />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold" data-testid="heading-market-overview">Market Overview</h2>
                <p className="text-sm text-muted-foreground">Real-time analysis across major forex pairs and gold</p>
              </div>
              <MarketOverview 
                tradingSession={sessionInfo.session} 
                marketOpen={sessionInfo.marketOpen} 
              />
            </div>

            <MarketConditionBanner {...marketCondition} />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="grid-markets">
              {isLoadingMarkets ? (
                instrumentList.map((inst) => (
                  <MarketCardSkeleton key={inst} />
                ))
              ) : marketData ? (
                marketData.map((analysis) => (
                  <MarketCard
                    key={analysis.instrument}
                    analysis={analysis}
                    onClick={() => handleInstrumentSelect(analysis.instrument)}
                  />
                ))
              ) : (
                instrumentList.map((inst) => (
                  <MarketCard
                    key={inst}
                    analysis={null}
                  />
                ))
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <Tabs defaultValue="simulation" className="w-full">
                  <TabsList className="grid w-full grid-cols-3 min-h-[44px]">
                    <TabsTrigger value="simulation" className="min-h-[40px]" data-testid="tab-simulation">Trades</TabsTrigger>
                    <TabsTrigger value="journal" className="min-h-[40px]" data-testid="tab-journal">Journal</TabsTrigger>
                    <TabsTrigger value="alerts" className="min-h-[40px]" data-testid="tab-alerts">Alerts</TabsTrigger>
                  </TabsList>
                  <TabsContent value="simulation" className="mt-4">
                    <SimulationDashboard />
                  </TabsContent>
                  <TabsContent value="journal" className="mt-4">
                    <TradeJournal />
                  </TabsContent>
                  <TabsContent value="alerts" className="mt-4">
                    <PriceAlerts />
                  </TabsContent>
                </Tabs>
              </div>

              <div className="space-y-4">
                <RiskManagementPanel />
                <InstitutionalDataPanel />
              </div>
            </div>

            <Disclaimer />
          </div>
        )}
      </main>
    </div>
  );
}

function SystemStatusBanner() {
  const { data: oandaStatus } = useQuery<{
    connected: boolean;
    environment?: string;
    account?: {
      openTradeCount: number;
      unrealizedPL: string;
    };
  }>({
    queryKey: ["/api/oanda/status"],
    staleTime: 30000,
  });

  const { data: simStats } = useQuery<{
    enabled: boolean;
    stats: {
      openTrades: number;
      totalPnlPips: number;
      winRate: number;
      totalTrades: number;
    };
    openBreakdown?: {
      oandaLinked: number;
      paper: number;
    };
  }>({
    queryKey: ["/api/simulation/stats"],
    refetchInterval: 15000,
  });

  const { data: dailyPnL } = useQuery<{
    currentPnL: number;
    currentPnLPips: number;
    tradesExecuted: number;
  }>({
    queryKey: ["/api/daily-pnl"],
    refetchInterval: 15000,
  });

  const { data: guardianStatus } = useQuery<{
    enabled: boolean;
    isNewTradesPaused: boolean;
  }>({
    queryKey: ["/api/oanda/guardian/status"],
    staleTime: 30000,
  });

  const isConnected = oandaStatus?.connected === true;
  const isLive = oandaStatus?.environment === "live";
  const isPaused = guardianStatus?.isNewTradesPaused === true;

  const oandaOpenCount = oandaStatus?.account?.openTradeCount ?? 0;
  const oandaPnL = parseFloat(oandaStatus?.account?.unrealizedPL || "0");

  const paperOpenCount = simStats?.openBreakdown?.paper ?? 0;

  const todayPnL = dailyPnL?.currentPnL ?? 0;

  let statusColor = "bg-green-500";
  let statusText = "System Active";
  let StatusIcon = Activity;

  if (isPaused) {
    statusColor = "bg-amber-500";
    statusText = "Trading Paused";
    StatusIcon = AlertCircle;
  } else if (!isConnected) {
    statusColor = "bg-muted-foreground";
    statusText = "OANDA Not Connected";
    StatusIcon = WifiOff;
  }

  return (
    <div className="mb-4 rounded-lg border bg-card p-3 flex flex-col gap-2" data-testid="banner-system-status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${statusColor} animate-pulse`} />
          <div className="flex items-center gap-1.5">
            <StatusIcon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm" data-testid="text-system-status">{statusText}</span>
          </div>
          {isConnected && (
            <span className="text-xs text-muted-foreground">
              {isLive ? "Live" : "Demo"} account
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground text-xs">Today's P&L:</span>
          <span className={`font-semibold ${todayPnL >= 0 ? 'text-green-600' : 'text-red-500'}`} data-testid="text-status-pnl">
            {todayPnL >= 0 ? '+' : ''}{typeof todayPnL === 'number' ? `£${todayPnL.toFixed(2)}` : '£0.00'}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs border-t border-border/50 pt-2">
        {isConnected && oandaOpenCount > 0 && (
          <div className="flex items-center gap-1.5" data-testid="text-oanda-open-trades">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">OANDA {isLive ? "Live" : "Demo"}:</span>
            <span className="font-semibold">{oandaOpenCount} trade{oandaOpenCount !== 1 ? 's' : ''}</span>
            <span className={`font-semibold ${oandaPnL >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {oandaPnL >= 0 ? '+' : ''}£{oandaPnL.toFixed(2)}
            </span>
          </div>
        )}
        {paperOpenCount > 0 && (
          <div className="flex items-center gap-1.5" data-testid="text-sim-open-trades">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Paper:</span>
            <span className="font-semibold">{paperOpenCount} trade{paperOpenCount !== 1 ? 's' : ''}</span>
          </div>
        )}
        {oandaOpenCount === 0 && paperOpenCount === 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">No open trades</span>
          </div>
        )}
      </div>
    </div>
  );
}
