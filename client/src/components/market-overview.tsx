import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Globe,
  AlertTriangle
} from "lucide-react";

interface MarketOverviewProps {
  tradingSession: "london" | "new_york" | "asian" | "closed";
  marketOpen: boolean;
}

const sessions = {
  london: {
    label: "London Session",
    icon: <Globe className="w-3 h-3" />,
    color: "text-blue-500",
  },
  new_york: {
    label: "New York Session",
    icon: <Globe className="w-3 h-3" />,
    color: "text-green-500",
  },
  asian: {
    label: "Asian Session",
    icon: <Globe className="w-3 h-3" />,
    color: "text-amber-500",
  },
  closed: {
    label: "Market Closed",
    icon: <Clock className="w-3 h-3" />,
    color: "text-muted-foreground",
  },
};

export function MarketOverview({ tradingSession, marketOpen }: MarketOverviewProps) {
  const session = sessions[tradingSession];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Badge variant="outline" className={`${session.color}`}>
        {session.icon}
        <span className="ml-1">{session.label}</span>
      </Badge>
      
      {marketOpen ? (
        <Badge variant="secondary" className="bg-bullish text-green-100">
          <TrendingUp className="w-3 h-3 mr-1" />
          Market Open
        </Badge>
      ) : (
        <Badge variant="secondary" className="bg-muted">
          <Clock className="w-3 h-3 mr-1" />
          Market Closed
        </Badge>
      )}
    </div>
  );
}

export function getCurrentSession(): { session: "london" | "new_york" | "asian" | "closed"; marketOpen: boolean } {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const day = now.getUTCDay();
  
  if (day === 0 || day === 6) {
    return { session: "closed", marketOpen: false };
  }
  
  if (utcHour >= 22 || utcHour < 7) {
    return { session: "asian", marketOpen: true };
  }
  
  if (utcHour >= 7 && utcHour < 12) {
    return { session: "london", marketOpen: true };
  }
  
  if (utcHour >= 12 && utcHour < 17) {
    return { session: "new_york", marketOpen: true };
  }
  
  if (utcHour >= 17 && utcHour < 22) {
    return { session: "new_york", marketOpen: true };
  }
  
  return { session: "closed", marketOpen: false };
}

interface MarketConditionBannerProps {
  condition: "optimal" | "caution" | "avoid";
  message: string;
}

export function MarketConditionBanner({ condition, message }: MarketConditionBannerProps) {
  const configs = {
    optimal: {
      bg: "bg-bullish",
      icon: <TrendingUp className="w-4 h-4 text-bullish" />,
      label: "Optimal Conditions",
    },
    caution: {
      bg: "bg-amber-500/15",
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      label: "Trade with Caution",
    },
    avoid: {
      bg: "bg-bearish",
      icon: <TrendingDown className="w-4 h-4 text-bearish" />,
      label: "Avoid Trading",
    },
  };

  const config = configs[condition];

  return (
    <div className={`rounded-lg ${config.bg} p-3 flex items-center gap-3`}>
      {config.icon}
      <div>
        <div className="text-sm font-medium">{config.label}</div>
        <div className="text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
