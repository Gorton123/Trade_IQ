import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  LineChart,
  Calculator,
  Trophy,
  Settings,
  TrendingUp,
  Brain,
  Zap,
  FileText,
  Globe,
  Wallet,
  BadgePoundSterling,
  Signal,
  Shield,
  Gamepad2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";

const tradingItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Signals", url: "/signals", icon: Signal },
  { title: "Live Account", url: "/live-account", icon: Globe },
  { title: "Profit Trapper", url: "/scalper", icon: Zap },
];

const analysisItems = [
  { title: "Analysis", url: "/analysis", icon: LineChart },
  { title: "Strategy Lab", url: "/strategy-lab", icon: Brain },
  { title: "Performance", url: "/performance", icon: Trophy },
  { title: "Reports", url: "/reports", icon: FileText },
];

const learnItems = [
  { title: "Bull or Bear", url: "/bull-or-bear", icon: Gamepad2 },
];

const accountItems = [
  { title: "Commission", url: "/commission", icon: Wallet },
  { title: "Risk Tools", url: "/risk-tools", icon: Calculator },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();

  const { data: oandaStatus } = useQuery<{ connected: boolean; environment?: string; isOwner?: boolean }>({
    queryKey: ["/api/oanda/status"],
    staleTime: 30000,
  });

  const isOwner = oandaStatus?.isOwner === true;
  const isLive = oandaStatus?.environment === "live";
  const isConnected = oandaStatus?.connected === true;

  const adminItems = isOwner ? [
    { title: "Earnings", url: "/admin-earnings", icon: BadgePoundSterling },
  ] : [];

  const renderGroup = (label: string, items: typeof tradingItems) => {
    if (items.length === 0) return null;
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={location === item.url}>
                  <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s/g, '-')}`}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer" data-testid="link-logo">
            <TrendingUp className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">TradeIQ</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {renderGroup("Trading", tradingItems)}
        {renderGroup("Analysis", analysisItems)}
        {renderGroup("Learn & Play", learnItems)}
        {renderGroup("Account", accountItems)}
        {renderGroup("Admin", adminItems)}
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="text-xs text-muted-foreground" data-testid="text-trading-mode">
          {isConnected ? (isLive ? "Live Trading" : "Demo Trading") : "Not Connected"}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
