import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Globe, AlertTriangle, Ban } from "lucide-react";
import type { TradingSession } from "@shared/schema";

interface SessionInfo {
  currentSession: TradingSession;
  sessionStart: string;
  sessionEnd: string;
  nextSession: TradingSession;
  nextSessionStart: string;
  typicalVolatility: "low" | "medium" | "high";
}

interface SessionFilterData {
  currentSession: TradingSession;
  isPreferredSession: boolean;
  shouldTrade: boolean;
  filterEnabled: boolean;
  preferredSessions: TradingSession[];
  volatility: string;
  recommendation: string;
}

export function SessionIndicator() {
  const { data: sessionFilter } = useQuery<SessionFilterData>({
    queryKey: ["/api/session-filter"],
    refetchInterval: 60000,
  });

  const sessionInfo = useMemo((): SessionInfo => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const currentTime = utcHour + utcMinutes / 60;

    let currentSession: TradingSession;
    let sessionStart: string;
    let sessionEnd: string;
    let nextSession: TradingSession;
    let nextSessionStart: string;
    let typicalVolatility: "low" | "medium" | "high";

    if (currentTime >= 0 && currentTime < 8) {
      currentSession = "asian";
      sessionStart = "00:00 UTC";
      sessionEnd = "08:00 UTC";
      nextSession = "london";
      nextSessionStart = "08:00 UTC";
      typicalVolatility = "low";
    } else if (currentTime >= 8 && currentTime < 12) {
      currentSession = "london";
      sessionStart = "08:00 UTC";
      sessionEnd = "16:00 UTC";
      nextSession = "new_york";
      nextSessionStart = "12:00 UTC";
      typicalVolatility = "high";
    } else if (currentTime >= 12 && currentTime < 16) {
      currentSession = "london";
      sessionStart = "08:00 UTC";
      sessionEnd = "16:00 UTC";
      nextSession = "new_york";
      nextSessionStart = "Active (overlap)";
      typicalVolatility = "high";
    } else if (currentTime >= 16 && currentTime < 21) {
      currentSession = "new_york";
      sessionStart = "12:00 UTC";
      sessionEnd = "21:00 UTC";
      nextSession = "asian";
      nextSessionStart = "00:00 UTC";
      typicalVolatility = "medium";
    } else {
      currentSession = "closed";
      sessionStart = "21:00 UTC";
      sessionEnd = "00:00 UTC";
      nextSession = "asian";
      nextSessionStart = "00:00 UTC";
      typicalVolatility = "low";
    }

    return { currentSession, sessionStart, sessionEnd, nextSession, nextSessionStart, typicalVolatility };
  }, []);

  const sessionConfig: Record<TradingSession, { label: string; color: string; flag: string }> = {
    asian: { label: "Asian Session", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", flag: "Tokyo/Sydney" },
    london: { label: "London Session", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", flag: "London/Frankfurt" },
    new_york: { label: "New York Session", color: "bg-green-500/20 text-green-400 border-green-500/30", flag: "New York" },
    closed: { label: "Market Closed", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", flag: "Weekend" },
  };

  const volatilityConfig = {
    low: { label: "Low Volatility", color: "text-green-400" },
    medium: { label: "Medium Volatility", color: "text-amber-400" },
    high: { label: "High Volatility", color: "text-red-400" },
  };

  const current = sessionConfig[sessionInfo.currentSession];
  const volatility = volatilityConfig[sessionInfo.typicalVolatility];

  const sessions: TradingSession[] = ["asian", "london", "new_york"];

  return (
    <Card data-testid="card-session-indicator">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Trading Sessions</span>
          </div>
          <Badge variant="outline" className={current.color}>
            {current.label}
          </Badge>
        </div>

        <div className="flex gap-1 mb-3">
          {sessions.map((session) => {
            const config = sessionConfig[session];
            const isActive = session === sessionInfo.currentSession;
            return (
              <div
                key={session}
                className={`flex-1 h-1.5 rounded ${
                  isActive ? config.color.split(" ")[0] : "bg-muted"
                }`}
              />
            );
          })}
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current:</span>
            <span>{sessionInfo.sessionStart} - {sessionInfo.sessionEnd}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Next:</span>
            <span>{sessionConfig[sessionInfo.nextSession].label} at {sessionInfo.nextSessionStart}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Typical:</span>
            <span className={volatility.color}>{volatility.label}</span>
          </div>
        </div>

        {sessionFilter && (
          <div className="mt-3 pt-3 border-t space-y-2">
            {sessionFilter.filterEnabled && !sessionFilter.isPreferredSession && (
              <div className="flex items-center gap-2 p-2 rounded bg-warning/10 border border-warning/30">
                <Ban className="h-3 w-3 text-warning" />
                <span className="text-xs text-warning">Non-preferred session - avoid new trades</span>
              </div>
            )}
            {sessionFilter.recommendation && (
              <p className="text-xs text-muted-foreground">{sessionFilter.recommendation}</p>
            )}
          </div>
        )}

        <div className="mt-3 pt-3 border-t">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Times shown in UTC. Overlap (12:00-16:00 UTC) typically has highest volatility.</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
