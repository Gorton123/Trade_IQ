import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, AlertTriangle, TrendingUp } from "lucide-react";
import type { EconomicEvent } from "@shared/schema";

export function EconomicCalendar() {
  const { data: events, isLoading } = useQuery<EconomicEvent[]>({
    queryKey: ["/api/economic-events"],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-economic-calendar">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Economic Calendar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  const sortedEvents = [...(events || [])].sort(
    (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
  );

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const impactConfig = {
    low: { color: "bg-green-500/20 text-green-400 border-green-500/30", icon: null },
    medium: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: TrendingUp },
    high: { color: "bg-red-500/20 text-red-400 border-red-500/30", icon: AlertTriangle },
  };

  const countryLabels: Record<string, string> = {
    USD: "US",
    EUR: "EU",
    GBP: "UK",
    AUD: "AU",
    NZD: "NZ",
    CHF: "CH",
    JPY: "JP",
    CAD: "CA",
  };

  return (
    <Card data-testid="card-economic-calendar">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Economic Calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sortedEvents.map((event) => {
          const impact = impactConfig[event.impact];
          const ImpactIcon = impact.icon;
          
          return (
            <div
              key={event.id}
              className="p-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
              data-testid={`event-${event.id}`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs font-bold">
                    {countryLabels[event.country] || event.country}
                  </Badge>
                  <div>
                    <div className="font-medium text-sm">{event.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(event.dateTime)} at {formatTime(event.dateTime)} UTC
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className={impact.color}>
                  {ImpactIcon && <ImpactIcon className="w-3 h-3 mr-1" />}
                  {event.impact}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                <div>
                  <span className="text-muted-foreground">Forecast: </span>
                  <span className="font-medium">{event.forecast || "N/A"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Previous: </span>
                  <span className="font-medium">{event.previous || "N/A"}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {event.affectedPairs.map((pair) => (
                  <Badge key={pair} variant="secondary" className="text-xs py-0">
                    {pair}
                  </Badge>
                ))}
              </div>
            </div>
          );
        })}

        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            High-impact events may cause significant volatility. Consider reducing position sizes or avoiding trades during these times.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
