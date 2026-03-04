import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, Loader2, WifiOff, RefreshCw, ArrowDown } from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { DailyBriefing } from "@/components/daily-briefing";
import { TradeConfirmDialog } from "@/components/trade-confirm-dialog";
import { useState, useEffect } from "react";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import Dashboard from "@/pages/dashboard";
import SignalsPage from "@/pages/signals";
import AnalysisPage from "@/pages/analysis";
import PerformancePage from "@/pages/performance";
import RiskToolsPage from "@/pages/risk-tools";
import SettingsPage from "@/pages/settings";
import StrategyLabPage from "@/pages/strategy-lab";
import ScalperPage from "@/pages/scalper";
import ReportsPage from "@/pages/reports";
import LiveAccountPage from "@/pages/live-account";
import CommissionPage from "@/pages/commission";
import AdminEarningsPage from "@/pages/admin-earnings";
import BullOrBearPage from "@/pages/bull-or-bear";
import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/signals" component={SignalsPage} />
      <Route path="/analysis" component={AnalysisPage} />
      <Route path="/strategy-lab" component={StrategyLabPage} />
      <Route path="/performance" component={PerformancePage} />
      <Route path="/risk-tools" component={RiskToolsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/scalper" component={ScalperPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/live-account" component={LiveAccountPage} />
      <Route path="/commission" component={CommissionPage} />
      <Route path="/admin-earnings" component={AdminEarningsPage} />
      <Route path="/bull-or-bear" component={BullOrBearPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function PullToRefreshIndicator({ progress, isRefreshing }: { progress: number; isRefreshing: boolean }) {
  if (progress === 0 && !isRefreshing) return null;
  
  return (
    <div 
      className="fixed top-0 left-0 right-0 flex justify-center z-50 pointer-events-none"
      style={{ 
        transform: `translateY(${isRefreshing ? 40 : progress * 60}px)`,
        opacity: isRefreshing ? 1 : progress,
        transition: isRefreshing ? 'transform 0.3s' : 'none'
      }}
    >
      <div className="bg-primary text-primary-foreground rounded-full p-2 shadow-lg">
        {isRefreshing ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ArrowDown className="h-5 w-5" style={{ transform: `rotate(${progress * 180}deg)` }} />
        )}
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { user } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showBriefing, setShowBriefing] = useState(false);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    const briefingDismissed = sessionStorage.getItem("dailyBriefingDismissed");
    
    fetch("/api/user/onboarding-status", { credentials: "include" })
      .then(res => res.json())
      .then(data => {
        if (!data.completed) {
          setShowOnboarding(true);
        } else if (!briefingDismissed) {
          setShowBriefing(true);
        }
      })
      .catch(() => {});
    fetch("/api/user/settings", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.displayName) setDisplayName(data.displayName);
      })
      .catch(() => {});
  }, []);
  
  const handleRefresh = async () => {
    window.location.reload();
  };
  
  const { isPulling, pullProgress } = usePullToRefresh(handleRefresh);
  
  return (
    <SidebarProvider>
      <PullToRefreshIndicator progress={pullProgress} isRefreshing={isPulling} />
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 items-center justify-between gap-2 border-b px-4 sticky top-0 bg-background z-10">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-3">
              {user && (
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={user.profileImageUrl || undefined} alt={user.firstName || "User"} />
                    <AvatarFallback className="text-xs">
                      {displayName?.[0]?.toUpperCase() || user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-muted-foreground hidden sm:inline">
                    {displayName || (user.firstName && user.firstName !== "John" ? user.firstName : null) || user.email?.split("@")[0] || "Trader"}
                  </span>
                </div>
              )}
              <Button variant="ghost" size="icon" asChild data-testid="button-logout">
                <a href="/api/logout" title="Sign out">
                  <LogOut className="h-4 w-4" />
                </a>
              </Button>
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </SidebarInset>
      </div>
      <OnboardingWizard open={showOnboarding} onComplete={() => {
        setShowOnboarding(false);
        const briefingDismissed = sessionStorage.getItem("dailyBriefingDismissed");
        if (!briefingDismissed) setShowBriefing(true);
      }} />
      <DailyBriefing
        open={showBriefing && !showOnboarding}
        onDismiss={() => {
          setShowBriefing(false);
          sessionStorage.setItem("dailyBriefingDismissed", "true");
        }}
        displayName={displayName}
      />
      <TradeConfirmDialog />
    </SidebarProvider>
  );
}

function ConnectionError() {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      const response = await fetch("/api/auth/user", { credentials: "include" });
      if (response.ok) {
        window.location.reload();
      } else {
        window.location.href = "/";
      }
    } catch {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-muted p-4">
            <WifiOff className="h-12 w-12 text-muted-foreground" />
          </div>
        </div>
        
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Connection Lost</h1>
          <p className="text-muted-foreground">
            Unable to connect to the server. Check your internet connection and try again.
          </p>
        </div>

        <Button 
          onClick={handleRetry} 
          size="lg" 
          className="w-full gap-2"
          disabled={isRetrying}
          data-testid="button-retry-connection"
        >
          {isRetrying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isRetrying ? "Reconnecting..." : "Tap to Reconnect"}
        </Button>
      </div>
    </div>
  );
}

function AppContent() {
  const { isLoading, isAuthenticated, error } = useAuth();
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch("/api/auth/user", { 
          credentials: "include",
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok && response.status !== 401) {
          setConnectionError(true);
        }
      } catch {
        setConnectionError(true);
      }
    };

    if (!isLoading && !isAuthenticated && !error) {
      checkConnection();
    }
  }, [isLoading, isAuthenticated, error]);

  if (connectionError) {
    return <ConnectionError />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return isAuthenticated ? <AuthenticatedApp /> : <LandingPage />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
