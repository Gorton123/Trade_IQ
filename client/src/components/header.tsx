import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/theme-provider";
import { Sun, Moon, RefreshCw, Activity, Clock, Wifi, WifiOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CacheStatus {
  pricesCacheAgeMinutes: number;
  pricesCacheValid: boolean;
  mode: string;
  message: string;
}

interface HeaderProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastUpdated?: string;
}

export function Header({ onRefresh, isRefreshing, lastUpdated }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  const { data: cacheStatus } = useQuery<CacheStatus>({
    queryKey: ["/api/cache/status"],
    refetchInterval: 60000,
  });

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-GB", { 
      hour: "2-digit", 
      minute: "2-digit",
      second: "2-digit"
    });
  };

  const formatCacheAge = (minutes: number) => {
    if (minutes < 0) return "No data";
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m ago`;
  };

  const getCacheStatusColor = () => {
    if (!cacheStatus) return "bg-yellow-500";
    if (cacheStatus.pricesCacheAgeMinutes < 0) return "bg-yellow-500";
    if (cacheStatus.pricesCacheValid) return "bg-green-500";
    return "bg-orange-500";
  };

  const getCacheStatusText = () => {
    if (!cacheStatus) return "Loading...";
    if (cacheStatus.pricesCacheAgeMinutes < 0) return "No data";
    if (cacheStatus.pricesCacheValid) return "Live";
    return "Stale";
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                <Activity className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">TradeIQ</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">AI Trading Intelligence</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="hidden sm:flex items-center gap-2 mr-2 cursor-help">
                  <Badge variant="outline" className="text-xs font-normal gap-1.5" data-testid="badge-data-status">
                    <span className={`w-1.5 h-1.5 rounded-full ${getCacheStatusColor()} ${cacheStatus?.pricesCacheValid ? 'pulse-live' : ''}`} />
                    {getCacheStatusText()}
                  </Badge>
                  {cacheStatus && cacheStatus.pricesCacheAgeMinutes >= 0 && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatCacheAge(cacheStatus.pricesCacheAgeMinutes)}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-medium">Data Status</p>
                  <p className="text-xs text-muted-foreground">
                    {cacheStatus?.message || "Checking data status..."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Click refresh to update prices (60s cooldown between refreshes).
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  data-testid="button-refresh"
                  className="min-w-[44px] min-h-[44px]"
                >
                  <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh prices from API</p>
              </TooltipContent>
            </Tooltip>

            <Button
              size="icon"
              variant="outline"
              onClick={toggleTheme}
              data-testid="button-theme-toggle"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="min-w-[44px] min-h-[44px]"
            >
              {theme === "dark" ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </Button>

          </div>
        </div>
      </div>
    </header>
  );
}
