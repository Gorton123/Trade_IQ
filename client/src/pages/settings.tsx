import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bell, Shield, Palette, Save, Smartphone, Download, Link, Unlink, CheckCircle, AlertCircle, Loader2, Trophy, Clock, ShieldAlert, TrendingUp, RotateCcw, Zap, MessageCircle } from "lucide-react";
import { 
  requestNotificationPermission, 
  checkNotificationPermission, 
  getNotificationSettings, 
  saveNotificationSettings,
  subscribeToPush,
  unsubscribeFromPush
} from "@/lib/notifications";

interface UserSettings {
  autoTradeEnabled: boolean;
  notificationsEnabled: boolean;
  theme: string;
}

const defaultSettings: UserSettings = {
  autoTradeEnabled: true,
  notificationsEnabled: true,
  theme: "dark",
};

interface ServerSettings {
  autoExecuteEnabled: boolean;
  simulationEnabled: boolean;
  showOnLeaderboard: boolean;
  displayName: string;
  confidenceBoostThreshold: number | null;
  confidenceBoostMultiplier: number | null;
  maxAutoExecuteRiskPercent: number;
  oandaInstruments?: string[] | null;
  oandaTimeframes?: string[] | null;
  telegramEnabled?: boolean;
  telegramChatId?: string | null;
  telegramAutoExecute?: boolean;
  telegramRiskPercent?: number;
  telegramAccountType?: string;
}

const defaultServerSettings: ServerSettings = {
  autoExecuteEnabled: false,
  simulationEnabled: true,
  showOnLeaderboard: true,
  displayName: "",
  confidenceBoostThreshold: null,
  confidenceBoostMultiplier: null,
  maxAutoExecuteRiskPercent: 0,
  oandaInstruments: null,
  oandaTimeframes: null,
  telegramEnabled: false,
  telegramChatId: null,
  telegramAutoExecute: false,
  telegramRiskPercent: 0.5,
  telegramAccountType: "paper",
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [isDirty, setIsDirty] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<'granted' | 'denied' | 'default'>('default');
  const [isPWAInstallable, setIsPWAInstallable] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  
  const [oandaApiKey, setOandaApiKey] = useState("");
  const [oandaAccountId, setOandaAccountId] = useState("");
  const [oandaConnected, setOandaConnected] = useState(false);
  const [oandaLoading, setOandaLoading] = useState(false);
  const [oandaIsLive, setOandaIsLive] = useState(false);
  const [oandaAccount, setOandaAccount] = useState<{ balance: string; currency: string; openTradeCount: number } | null>(null);
  const [serverSettings, setServerSettings] = useState<ServerSettings>(defaultServerSettings);
  const [serverSettingsLoading, setServerSettingsLoading] = useState(false);
  const [simulationInstruments, setSimulationInstruments] = useState<string[]>([]);

  const ALL_SIMULATION_INSTRUMENTS = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "EURJPY"];

  const [oandaInstruments, setOandaInstruments] = useState<string[]>([]);
  const [oandaTimeframes, setOandaTimeframes] = useState<string[]>([]);

  const ALL_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];
  const ALL_INSTRUMENTS = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDCHF", "AUDUSD", "NZDUSD", "USDJPY", "USDCAD", "EURGBP", "EURJPY", "GBPJPY"];

  useEffect(() => {
    const saved = localStorage.getItem("tradeiq-settings");
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load settings", e);
      }
    }
    
    checkNotificationPermission().then(setNotificationPermission);
    
    const notifSettings = getNotificationSettings();
    if (notifSettings.enabled !== settings.notificationsEnabled) {
      setSettings(prev => ({ ...prev, notificationsEnabled: notifSettings.enabled }));
    }
    
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsPWAInstallable(true);
    };
    
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsPWAInstallable(false);
    }
    
    fetch("/api/oanda/status")
      .then(res => res.json())
      .then(data => {
        if (data.connected) {
          setOandaConnected(true);
          setOandaAccount(data.account);
        }
      })
      .catch(() => {});

    fetch("/api/user/settings", { credentials: "include" })
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then(data => {
        if (data) {
          setServerSettings({
            autoExecuteEnabled: data.autoExecuteEnabled ?? false,
            simulationEnabled: data.simulationEnabled ?? true,
            showOnLeaderboard: data.showOnLeaderboard ?? true,
            displayName: data.displayName || "",
            confidenceBoostThreshold: data.confidenceBoostThreshold ?? null,
            confidenceBoostMultiplier: data.confidenceBoostMultiplier ?? null,
            maxAutoExecuteRiskPercent: data.maxAutoExecuteRiskPercent ?? 0,
            oandaInstruments: data.oandaInstruments ?? null,
            oandaTimeframes: data.oandaTimeframes ?? null,
            telegramEnabled: data.telegramEnabled ?? false,
            telegramChatId: data.telegramChatId ?? null,
            telegramAutoExecute: data.telegramAutoExecute ?? false,
            telegramRiskPercent: data.telegramRiskPercent ?? 0.5,
            telegramAccountType: data.telegramAccountType ?? "paper",
          });
          if (data.simulationInstruments) {
            setSimulationInstruments(data.simulationInstruments);
          }
          if (data.oandaInstruments) {
            setOandaInstruments(data.oandaInstruments);
          }
          if (data.oandaTimeframes) {
            setOandaTimeframes(data.oandaTimeframes);
          }
        }
      })
      .catch(() => {});
    
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const toggleOandaInstrument = async (instrument: string) => {
    const current = oandaInstruments || [];
    let updated: string[];
    if (current.includes(instrument)) {
      updated = current.filter(i => i !== instrument);
    } else {
      updated = [...current, instrument];
    }
    setOandaInstruments(updated);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ oandaInstruments: updated.length > 0 ? updated : null }),
      });
      if (res.ok) {
        toast({
          title: "OANDA Instruments Updated",
          description: updated.length === 0 
            ? "Trading all instruments allowed in simulation"
            : `OANDA restricted to: ${updated.join(', ')}`,
        });
      } else {
        setOandaInstruments(current);
        toast({ title: "Error", description: "Failed to update OANDA instruments.", variant: "destructive" });
      }
    } catch {
      setOandaInstruments(current);
      toast({ title: "Error", description: "Failed to update OANDA instruments.", variant: "destructive" });
    }
  };

  const toggleOandaTimeframe = async (timeframe: string) => {
    const current = oandaTimeframes || [];
    let updated: string[];
    if (current.includes(timeframe)) {
      updated = current.filter(t => t !== timeframe);
    } else {
      updated = [...current, timeframe];
    }
    setOandaTimeframes(updated);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ oandaTimeframes: updated.length > 0 ? updated : null }),
      });
      if (res.ok) {
        toast({
          title: "OANDA Timeframes Updated",
          description: updated.length === 0
            ? "Trading all timeframes allowed in simulation"
            : `OANDA timeframes restricted to: ${updated.join(', ')}`,
        });
      } else {
        setOandaTimeframes(current);
        toast({ title: "Error", description: "Failed to update OANDA timeframes.", variant: "destructive" });
      }
    } catch {
      setOandaTimeframes(current);
      toast({ title: "Error", description: "Failed to update OANDA timeframes.", variant: "destructive" });
    }
  };

  const updateServerSetting = async (key: keyof ServerSettings, value: boolean | string | number | null) => {
    setServerSettingsLoading(true);
    setServerSettings(prev => ({ ...prev, [key]: value } as ServerSettings));
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [key]: value }),
      });
      if (res.ok) {
        const data = await res.json();
          setServerSettings({
            autoExecuteEnabled: data.autoExecuteEnabled ?? false,
            simulationEnabled: data.simulationEnabled ?? true,
            showOnLeaderboard: data.showOnLeaderboard ?? true,
            displayName: data.displayName || "",
            confidenceBoostThreshold: data.confidenceBoostThreshold ?? null,
            confidenceBoostMultiplier: data.confidenceBoostMultiplier ?? null,
            maxAutoExecuteRiskPercent: data.maxAutoExecuteRiskPercent ?? 0,
            oandaInstruments: data.oandaInstruments ?? null,
            oandaTimeframes: data.oandaTimeframes ?? null,
            telegramEnabled: data.telegramEnabled ?? false,
            telegramChatId: data.telegramChatId ?? null,
            telegramAutoExecute: data.telegramAutoExecute ?? false,
            telegramRiskPercent: data.telegramRiskPercent ?? 0.5,
            telegramAccountType: data.telegramAccountType ?? "paper",
          });
        if (key === "displayName" || key === "showOnLeaderboard") {
          queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
          queryClient.invalidateQueries({ queryKey: ["/api/scalper/leaderboard"] });
        }
        toast({
          title: "Setting Updated",
          description: key === "autoExecuteEnabled"
            ? (value ? "OANDA auto-execute is now ON" : "OANDA auto-execute is now OFF")
            : key === "showOnLeaderboard"
            ? (value ? "You are now visible on the leaderboard" : "You are now hidden from the leaderboard")
            : key === "displayName"
            ? "Display name updated on leaderboard."
            : "Setting saved successfully.",
        });
      } else {
        setServerSettings(prev => ({ ...prev, [key]: typeof value === 'boolean' ? !value : prev[key] } as ServerSettings));
        toast({
          title: "Error",
          description: "Failed to save setting. Please sign in first.",
          variant: "destructive",
        });
      }
    } catch {
      setServerSettings(prev => ({ ...prev, [key]: !value }));
      toast({
        title: "Error",
        description: "Failed to save setting. Check your connection.",
        variant: "destructive",
      });
    } finally {
      setServerSettingsLoading(false);
    }
  };

  const toggleInstrument = async (instrument: string) => {
    const current = simulationInstruments.length > 0 ? simulationInstruments : [];
    let updated: string[];
    if (current.includes(instrument)) {
      updated = current.filter(i => i !== instrument);
    } else {
      updated = [...current, instrument];
    }
    setSimulationInstruments(updated);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ simulationInstruments: updated.length > 0 ? updated : null }),
      });
      if (res.ok) {
        toast({
          title: "Instruments Updated",
          description: updated.length === 0
            ? "Trading all instruments (no filter)"
            : `Trading ${updated.length} instrument${updated.length > 1 ? 's' : ''}: ${updated.join(', ')}`,
        });
      } else {
        setSimulationInstruments(current);
        toast({ title: "Error", description: "Failed to update instruments. Please sign in.", variant: "destructive" });
      }
    } catch {
      setSimulationInstruments(current);
      toast({ title: "Error", description: "Failed to update instruments.", variant: "destructive" });
    }
  };

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const saveSettings = () => {
    localStorage.setItem("tradeiq-settings", JSON.stringify(settings));
    saveNotificationSettings({ 
      enabled: settings.notificationsEnabled
    });
    setIsDirty(false);
    toast({
      title: "Settings Saved",
      description: "Your preferences have been saved successfully.",
    });
  };
  
  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      setNotificationPermission('granted');
      updateSetting('notificationsEnabled', true);
      saveNotificationSettings({ enabled: true });
      toast({
        title: "Notifications Enabled",
        description: "You'll receive alerts for new high-confidence signals.",
      });
    } else {
      setNotificationPermission('denied');
      toast({
        title: "Permission Denied",
        description: "Please enable notifications in your browser settings.",
        variant: "destructive",
      });
    }
  };
  
  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    
    const promptEvent = deferredPrompt as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    await promptEvent.prompt();
    const result = await promptEvent.userChoice;
    
    if (result.outcome === 'accepted') {
      toast({
        title: "App Installed",
        description: "TradeIQ has been added to your home screen.",
      });
      setIsPWAInstallable(false);
    }
    setDeferredPrompt(null);
  };

  const handleConnectOanda = async () => {
    if (!oandaApiKey.trim() || !oandaAccountId.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter your OANDA API key and Account ID.",
        variant: "destructive",
      });
      return;
    }

    setOandaLoading(true);
    try {
      const response = await fetch("/api/oanda/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: oandaApiKey,
          accountId: oandaAccountId,
          isLive: oandaIsLive,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setOandaConnected(true);
        setOandaAccount(data.account);
        toast({
          title: "Connected to OANDA",
          description: `${oandaIsLive ? "LIVE" : "Demo"} account connected. Balance: ${data.account.currency} ${parseFloat(data.account.balance).toFixed(2)}`,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.error || "Check your API key and Account ID",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to connect to OANDA. Please try again.",
        variant: "destructive",
      });
    } finally {
      setOandaLoading(false);
    }
  };

  const handleDisconnectOanda = () => {
    fetch("/api/oanda/disconnect", { method: "POST" });
    setOandaConnected(false);
    setOandaAccount(null);
    setOandaApiKey("");
    setOandaAccountId("");
    toast({
      title: "Disconnected",
      description: "OANDA account has been disconnected.",
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Settings</h1>
          <p className="text-sm md:text-base text-muted-foreground">Customize your trading experience</p>
        </div>
        <Button onClick={saveSettings} disabled={!isDirty} data-testid="button-save-settings" className="w-full sm:w-auto">
          <Save className="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-notification-settings">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications & Automation
            </CardTitle>
            <CardDescription>Manage alerts and automatic features</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="autoTrade">Auto-Trade Simulation</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically track signal performance
                </p>
              </div>
              <Switch
                id="autoTrade"
                checked={serverSettings.simulationEnabled}
                onCheckedChange={(val) => updateServerSetting("simulationEnabled", val)}
                disabled={serverSettingsLoading}
                data-testid="switch-auto-trade"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="autoExecute">OANDA Auto-Execute</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically place trades on your OANDA account
                </p>
              </div>
              <Switch
                id="autoExecute"
                checked={serverSettings.autoExecuteEnabled}
                onCheckedChange={(val) => updateServerSetting("autoExecuteEnabled", val)}
                disabled={serverSettingsLoading || !oandaConnected}
                data-testid="switch-auto-execute"
              />
            </div>
            {!oandaConnected && (
              <p className="text-xs text-muted-foreground">Connect your OANDA account below to enable auto-execute.</p>
            )}

            {serverSettings.autoExecuteEnabled && oandaConnected && (
              <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/20">
                <Label htmlFor="maxRisk" className="flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Max Risk Per Trade
                </Label>
                <p className="text-sm text-muted-foreground">
                  Block auto-execution when a trade's actual risk exceeds this percentage of your account. Some instruments (like Gold) require minimum lot sizes that can push risk above your normal setting.
                </p>
                <div className="flex items-center gap-3">
                  <select
                    id="maxRisk"
                    value={serverSettings.maxAutoExecuteRiskPercent}
                    onChange={(e) => updateServerSetting("maxAutoExecuteRiskPercent", parseFloat(e.target.value))}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid="select-max-risk"
                  >
                    <option value={0}>Match my risk setting (recommended)</option>
                    <option value={2}>2% — allow slightly elevated risk</option>
                    <option value={3}>3% — moderate</option>
                    <option value={5}>5% — permissive</option>
                    <option value={10}>10% — very permissive</option>
                  </select>
                </div>
                <p className="text-xs text-green-400">
                  {serverSettings.maxAutoExecuteRiskPercent === 0
                    ? "Trades that can't match your risk setting will be blocked from auto-execute. You can still place them manually."
                    : `Trades requiring more than ${serverSettings.maxAutoExecuteRiskPercent}% risk will be skipped by auto-execute. You can still place them manually from the Signals Hub.`
                  }
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="displayName" className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5" />
                Display Name
              </Label>
              <p className="text-sm text-muted-foreground">
                Your name shown on the leaderboard and across the platform
              </p>
              <div className="flex items-center gap-2">
                <Input
                  id="displayName"
                  placeholder="Enter your trader name"
                  value={serverSettings.displayName}
                  onChange={(e) => setServerSettings(prev => ({ ...prev, displayName: e.target.value }))}
                  className="max-w-xs"
                  data-testid="input-display-name"
                />
                <Button
                  variant="outline"
                  onClick={() => updateServerSetting("displayName", serverSettings.displayName)}
                  disabled={serverSettingsLoading}
                  data-testid="button-save-display-name"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  Save
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="showOnLeaderboard" className="flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5" />
                  Show on Leaderboard
                </Label>
                <p className="text-sm text-muted-foreground">
                  Display your performance on the platform leaderboard
                </p>
              </div>
              <Switch
                id="showOnLeaderboard"
                checked={serverSettings.showOnLeaderboard}
                onCheckedChange={(val) => updateServerSetting("showOnLeaderboard", val)}
                disabled={serverSettingsLoading}
                data-testid="switch-show-leaderboard"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="notifications">Push Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Get alerts for new signals (60%+ for approved, 80%+ for universal)
                </p>
              </div>
              {notificationPermission === 'granted' ? (
                <Switch
                  id="notifications"
                  checked={settings.notificationsEnabled}
                  onCheckedChange={async (val) => {
                    updateSetting("notificationsEnabled", val);
                    saveNotificationSettings({ enabled: val });
                    if (val) {
                      await subscribeToPush();
                    } else {
                      await unsubscribeFromPush();
                    }
                  }}
                  data-testid="switch-notifications"
                />
              ) : notificationPermission === 'denied' ? (
                <Badge variant="outline" className="text-muted-foreground">Blocked</Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={handleEnableNotifications} data-testid="button-enable-notifications">
                  Enable
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-mobile-app">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Mobile App
            </CardTitle>
            <CardDescription>Install TradeIQ on your device</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPWAInstallable ? (
              <Button onClick={handleInstallPWA} className="w-full" data-testid="button-install-app">
                <Download className="h-4 w-4 mr-2" />
                Install TradeIQ App
              </Button>
            ) : (
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <Smartphone className="h-8 w-8 mx-auto text-green-500 mb-2" />
                <p className="text-sm font-medium">App Ready</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {window.matchMedia('(display-mode: standalone)').matches 
                    ? "You're using the installed app!" 
                    : "Add to home screen from your browser menu"}
                </p>
              </div>
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>iOS:</strong> Tap Share then "Add to Home Screen"</p>
              <p><strong>Android:</strong> Tap menu then "Install app"</p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-risk-limits">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Risk Limits
            </CardTitle>
            <CardDescription>Protect your account with trading limits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 rounded-lg bg-muted/50 border border-green-500/20">
                <div className="text-2xl font-bold text-green-500">60%</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">OANDA (Approved)</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50 border border-amber-500/20">
                <div className="text-2xl font-bold text-amber-500">80%</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">OANDA (Universal)</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              These limits are recommended based on professional risk management practices
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-confidence-boost">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Confidence Lot Boost
            </CardTitle>
            <CardDescription>
              Automatically increase lot size on high-confidence signals
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              When a signal's confidence exceeds your threshold, the lot size is multiplied by your chosen amount. Applies to both auto-execute and manual OANDA trades.
            </p>
            
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="boostThreshold">Confidence Threshold (%)</Label>
                <p className="text-xs text-muted-foreground">Signals above this confidence level get boosted lots</p>
                <div className="flex items-center gap-2">
                  <Input
                    id="boostThreshold"
                    type="number"
                    min={55}
                    max={95}
                    step={5}
                    placeholder="e.g. 75"
                    value={serverSettings.confidenceBoostThreshold ?? ""}
                    onChange={(e) => setServerSettings(prev => ({ 
                      ...prev, 
                      confidenceBoostThreshold: e.target.value ? parseFloat(e.target.value) : null 
                    }))}
                    className="max-w-[100px]"
                    data-testid="input-boost-threshold"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="boostMultiplier">Lot Multiplier</Label>
                <p className="text-xs text-muted-foreground">How much to multiply the normal lot size by (max 3x)</p>
                <div className="flex items-center gap-2">
                  <Input
                    id="boostMultiplier"
                    type="number"
                    min={1.1}
                    max={3}
                    step={0.1}
                    placeholder="e.g. 1.5"
                    value={serverSettings.confidenceBoostMultiplier ?? ""}
                    onChange={(e) => setServerSettings(prev => ({ 
                      ...prev, 
                      confidenceBoostMultiplier: e.target.value ? parseFloat(e.target.value) : null 
                    }))}
                    className="max-w-[100px]"
                    data-testid="input-boost-multiplier"
                  />
                  <span className="text-sm text-muted-foreground">x lots</span>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                const threshold = serverSettings.confidenceBoostThreshold;
                const multiplier = serverSettings.confidenceBoostMultiplier;
                if (threshold && multiplier) {
                  if (threshold < 55 || threshold > 95) {
                    toast({ title: "Invalid Threshold", description: "Threshold must be between 55% and 95%", variant: "destructive" });
                    return;
                  }
                  if (multiplier < 1.1 || multiplier > 3) {
                    toast({ title: "Invalid Multiplier", description: "Multiplier must be between 1.1x and 3x", variant: "destructive" });
                    return;
                  }
                }
                setServerSettingsLoading(true);
                try {
                  const res = await fetch("/api/user/settings", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ 
                      confidenceBoostThreshold: threshold, 
                      confidenceBoostMultiplier: multiplier 
                    }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setServerSettings(prev => ({
                      ...prev,
                      confidenceBoostThreshold: data.confidenceBoostThreshold ?? null,
                      confidenceBoostMultiplier: data.confidenceBoostMultiplier ?? null,
                    }));
                    toast({
                      title: threshold && multiplier ? "Lot Boost Saved" : "Lot Boost Disabled",
                      description: threshold && multiplier 
                        ? `Signals above ${threshold}% confidence will use ${multiplier}x lot size`
                        : "Standard lot sizing will be used for all trades",
                    });
                  } else {
                    toast({ title: "Save Failed", description: "Could not save boost settings. Please try again.", variant: "destructive" });
                  }
                } catch {
                  toast({ title: "Save Failed", description: "Network error. Please try again.", variant: "destructive" });
                } finally {
                  setServerSettingsLoading(false);
                }
              }}
              disabled={serverSettingsLoading}
              data-testid="button-save-boost"
            >
              <Save className="h-4 w-4 mr-2" />
              {serverSettings.confidenceBoostThreshold && serverSettings.confidenceBoostMultiplier 
                ? "Save Boost Settings" 
                : "Save (Boost Disabled)"}
            </Button>

            {serverSettings.confidenceBoostThreshold && serverSettings.confidenceBoostMultiplier && (
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <Zap className="h-3 w-3 inline mr-1" />
                  Active: Signals above {serverSettings.confidenceBoostThreshold}% will get {serverSettings.confidenceBoostMultiplier}x lot size
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-mt5-ea">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              MT5 Auto-Trading
            </CardTitle>
            <CardDescription>
              Download the Expert Advisor to automate trades on MetaTrader 5
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-md bg-muted/30 space-y-2">
              <div className="text-sm font-medium">How it works:</div>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Download the EA file below</li>
                <li>Copy to MT5 Experts folder</li>
                <li>Drag EA onto XAUUSD chart</li>
                <li>Add server URL to allowed WebRequests in MT5</li>
                <li>Enable Auto-Trade in MT5 settings</li>
              </ol>
            </div>
            
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2 rounded bg-muted/20">
                <div className="text-muted-foreground">Risk Per Trade</div>
                <div className="font-medium">1%</div>
              </div>
              <div className="p-2 rounded bg-muted/20">
                <div className="text-muted-foreground">Min Confidence</div>
                <div className="font-medium">70%</div>
              </div>
              <div className="p-2 rounded bg-muted/20">
                <div className="text-muted-foreground">Poll Interval</div>
                <div className="font-medium">30 seconds</div>
              </div>
              <div className="p-2 rounded bg-muted/20">
                <div className="text-muted-foreground">Timeframes</div>
                <div className="font-medium">5m, 15m, 1h</div>
              </div>
            </div>

            <a 
              href="/downloads/TradeIQ_EA.mq5" 
              download="TradeIQ_EA.mq5"
              className="w-full"
            >
              <Button className="w-full min-h-[44px]" data-testid="button-download-ea">
                <Download className="h-4 w-4 mr-2" />
                Download TradeIQ EA (.mq5)
              </Button>
            </a>
            
            <p className="text-xs text-muted-foreground">
              Server URL to add in MT5: <code className="bg-muted px-1 rounded">{window.location.origin}</code>
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-oanda">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Link className="h-4 w-4" />
              OANDA Broker Connection
              {oandaConnected && (
                <Badge variant="outline" className="ml-2 text-green-500 border-green-500">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Connect your OANDA account for auto-trading (no MT5 required)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {oandaConnected && oandaAccount ? (
              <div className="space-y-4">
                <div className="p-3 rounded-md bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center gap-2 text-green-500 mb-2">
                    <CheckCircle className="h-4 w-4" />
                    <span className="font-medium">Account Connected</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Balance:</span>
                      <span className="ml-2 font-medium">{oandaAccount.currency} {parseFloat(oandaAccount.balance).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Open Trades:</span>
                      <span className="ml-2 font-medium">{oandaAccount.openTradeCount}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {serverSettings.autoExecuteEnabled 
                      ? "Auto-execute is ON. Signals will automatically trade on this account."
                      : "Auto-execute is OFF. Enable it above to auto-trade signals."}
                  </p>
                  {serverSettings.autoExecuteEnabled && (
                    <Badge variant="default" className="text-xs shrink-0">Auto ON</Badge>
                  )}
                </div>
                <Button 
                  variant="destructive" 
                  className="w-full min-h-[44px]"
                  onClick={handleDisconnectOanda}
                  data-testid="button-disconnect-oanda"
                >
                  <Unlink className="h-4 w-4 mr-2" />
                  Disconnect Account
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-md bg-muted/30 space-y-2">
                  <div className="text-sm font-medium">How to get your credentials:</div>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Create a free OANDA demo account at oanda.com</li>
                    <li>Log into the OANDA portal</li>
                    <li>Go to "Manage API Access" under "My Services"</li>
                    <li>Generate a new API token</li>
                    <li>Copy your Account ID from the account list</li>
                  </ol>
                </div>

                <div className="space-y-2">
                  <Label>Account Type</Label>
                  <div className="flex gap-2">
                    <Button
                      variant={!oandaIsLive ? "default" : "outline"}
                      className="flex-1"
                      onClick={() => setOandaIsLive(false)}
                      data-testid="button-oanda-demo"
                    >
                      Demo
                    </Button>
                    <Button
                      variant={oandaIsLive ? "destructive" : "outline"}
                      className="flex-1"
                      onClick={() => setOandaIsLive(true)}
                      data-testid="button-oanda-live"
                    >
                      Live
                    </Button>
                  </div>
                </div>

                {oandaIsLive && (
                  <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20" data-testid="banner-live-oanda-warning">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-red-500">Live Account Warning</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          This will connect to your real OANDA account with real money. 
                          We recommend starting with 1% risk per trade and enabling the Trade Guardian.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="oandaApiKey">API Key (Token)</Label>
                  <Input
                    id="oandaApiKey"
                    type="password"
                    placeholder="Enter your OANDA API key"
                    value={oandaApiKey}
                    onChange={(e) => setOandaApiKey(e.target.value)}
                    data-testid="input-oanda-api-key"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="oandaAccountId">Account ID</Label>
                  <Input
                    id="oandaAccountId"
                    placeholder="e.g., 101-004-12345678-001"
                    value={oandaAccountId}
                    onChange={(e) => setOandaAccountId(e.target.value)}
                    data-testid="input-oanda-account-id"
                  />
                </div>

                <Button 
                  className="w-full min-h-[44px]"
                  variant={oandaIsLive ? "destructive" : "default"}
                  onClick={handleConnectOanda}
                  disabled={oandaLoading}
                  data-testid="button-connect-oanda"
                >
                  {oandaLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Link className="h-4 w-4 mr-2" />
                      Connect {oandaIsLive ? "Live" : "Demo"} Account
                    </>
                  )}
                </Button>

                <p className="text-xs text-muted-foreground flex items-start gap-1">
                  <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  Your credentials are encrypted and stored securely.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <GuardianSettingsCard oandaConnected={oandaConnected} />

        {oandaConnected && serverSettings.autoExecuteEnabled && (
          <Card data-testid="card-oanda-pairs">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4" />
                OANDA Trading Pairs
              </CardTitle>
              <CardDescription>Select which instruments and timeframes to trade on OANDA</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Instruments</Label>
                  {oandaInstruments.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="xs" 
                      onClick={() => {
                        setOandaInstruments([]);
                        fetch("/api/user/settings", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ oandaInstruments: null }),
                        });
                      }}
                      className="h-6 text-[10px] uppercase font-bold text-muted-foreground hover:text-destructive"
                    >
                      Clear Filter
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {ALL_INSTRUMENTS.map((inst) => (
                    <Button
                      key={inst}
                      variant={oandaInstruments.includes(inst) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleOandaInstrument(inst)}
                      className={`h-8 ${inst === "XAUUSD" || inst === "XAGUSD" ? "border-amber-500/50" : ""}`}
                      data-testid={`oanda-inst-${inst}`}
                    >
                      {inst}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <Label>Timeframes</Label>
                <div className="flex flex-wrap gap-2">
                  {ALL_TIMEFRAMES.map((tf) => (
                    <Button
                      key={tf}
                      variant={oandaTimeframes.includes(tf) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleOandaTimeframe(tf)}
                      className="h-8"
                      data-testid={`oanda-tf-${tf}`}
                    >
                      {tf}
                    </Button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                If none selected, all instruments/timeframes allowed in simulation will be used. This allows you to trade Silver exclusively on your live account while paper trading everything else.
              </p>
            </CardContent>
          </Card>
        )}

        {oandaConnected && (
          <Card data-testid="card-telegram-signals" className="border-blue-500/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-blue-500" />
                Telegram Signal Integration
              </CardTitle>
              <CardDescription>
                Forward signals from your Telegram groups to auto-execute on OANDA
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="telegramEnabled">Enable Telegram Signals</Label>
                <Switch
                  id="telegramEnabled"
                  data-testid="switch-telegram-enabled"
                  checked={serverSettings.telegramEnabled ?? false}
                  onCheckedChange={(checked) => {
                    setServerSettings(prev => ({ ...prev, telegramEnabled: checked }));
                    updateServerSetting("telegramEnabled", checked);
                  }}
                />
              </div>

              {serverSettings.telegramEnabled && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="telegramChatId">Your Telegram Chat ID</Label>
                    <div className="flex gap-2">
                      <Input
                        id="telegramChatId"
                        data-testid="input-telegram-chat-id"
                        placeholder="Send /start to the bot to get this"
                        value={serverSettings.telegramChatId ?? ""}
                        onChange={(e) => setServerSettings(prev => ({ ...prev, telegramChatId: e.target.value }))}
                      />
                      <Button
                        data-testid="button-save-telegram-chat-id"
                        size="sm"
                        onClick={() => updateServerSetting("telegramChatId", serverSettings.telegramChatId ?? "")}
                      >
                        <Save className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Open the bot in Telegram, send /start, and it will give you your Chat ID
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="telegramAutoExecute">Auto-Execute Trades</Label>
                      <p className="text-xs text-muted-foreground">Automatically place trades from forwarded signals</p>
                    </div>
                    <Switch
                      id="telegramAutoExecute"
                      data-testid="switch-telegram-auto-execute"
                      checked={serverSettings.telegramAutoExecute ?? false}
                      onCheckedChange={(checked) => {
                        setServerSettings(prev => ({ ...prev, telegramAutoExecute: checked }));
                        updateServerSetting("telegramAutoExecute", checked);
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Trade Destination</Label>
                    <div className="flex gap-2">
                      <Button
                        data-testid="button-telegram-paper"
                        size="sm"
                        variant={serverSettings.telegramAccountType === "paper" ? "default" : "outline"}
                        className={serverSettings.telegramAccountType === "paper" ? "flex-1 bg-blue-600 hover:bg-blue-700" : "flex-1"}
                        onClick={() => {
                          setServerSettings(prev => ({ ...prev, telegramAccountType: "paper" }));
                          updateServerSetting("telegramAccountType", "paper");
                        }}
                      >
                        <Shield className="h-3 w-3 mr-1" />
                        Paper (Safe)
                      </Button>
                      <Button
                        data-testid="button-telegram-live"
                        size="sm"
                        variant={serverSettings.telegramAccountType === "live" ? "default" : "outline"}
                        className={serverSettings.telegramAccountType === "live" ? "flex-1 bg-red-600 hover:bg-red-700" : "flex-1"}
                        onClick={() => {
                          setServerSettings(prev => ({ ...prev, telegramAccountType: "live" }));
                          updateServerSetting("telegramAccountType", "live");
                        }}
                      >
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Live (Real Money)
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {serverSettings.telegramAccountType === "live"
                        ? "Trades will be placed on your connected OANDA account with real money"
                        : "Trades are simulated on your paper account — no real money at risk"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="telegramRiskPercent">
                      Risk Per Trade: {serverSettings.telegramRiskPercent ?? 0.5}%
                    </Label>
                    <input
                      id="telegramRiskPercent"
                      data-testid="input-telegram-risk"
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                      value={serverSettings.telegramRiskPercent ?? 0.5}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setServerSettings(prev => ({ ...prev, telegramRiskPercent: val }));
                      }}
                      onMouseUp={(e) => {
                        updateServerSetting("telegramRiskPercent", serverSettings.telegramRiskPercent ?? 0.5);
                      }}
                      onTouchEnd={(e) => {
                        updateServerSetting("telegramRiskPercent", serverSettings.telegramRiskPercent ?? 0.5);
                      }}
                      className="w-full accent-blue-500"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.1% (Tiny)</span>
                      <span>1% (Normal)</span>
                      <span>3% (High)</span>
                    </div>
                  </div>

                  <div className="rounded-md bg-muted/50 p-3 space-y-1">
                    <p className="text-xs font-medium">How it works:</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                      <li>Open your TradeIQ bot in Telegram and send /start</li>
                      <li>Copy the Chat ID it gives you and paste it above</li>
                      <li>Forward any message from your signal group to the bot</li>
                      <li>The bot parses signals like "SELL XAUUSD @ 5390 SL 5420 TP 5340"</li>
                      <li>Non-signal messages (jargon, commentary) are safely ignored</li>
                      <li>All safety checks applied: max positions, daily loss limit, risk %</li>
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-about">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4" />
              About TradeIQ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span>1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Win Rate Target</span>
                <span>64%+ (1h/4h timeframes)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Profit Factor</span>
                <span>2-4x</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Instruments</span>
                <span>7 pairs</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              TradeIQ uses AI-powered analysis to generate high-probability trading signals.
              Always use proper risk management and never risk more than you can afford to lose.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const RECOMMENDED_DURATIONS: Record<string, number> = {
  "1m": 3,
  "5m": 4,
  "15m": 6,
  "1h": 12,
  "4h": 24,
};

const TIMEFRAME_LABELS: Record<string, string> = {
  "1m": "1 Minute",
  "5m": "5 Minute",
  "15m": "15 Minute",
  "1h": "1 Hour",
  "4h": "4 Hour",
};

function GuardianSettingsCard({ oandaConnected }: { oandaConnected: boolean }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  
  const { data: guardianStatus } = useQuery<{
    enabled: boolean;
    maxTradeDurationHours: number;
    dailyLossLimitPercent: number;
    maxOpenPositions: number;
    timeframeDurations: Record<string, number>;
    timeframeDurationLimits: Record<string, number>;
    isNewTradesPaused: boolean;
  }>({
    queryKey: ["/api/oanda/guardian/status"],
    enabled: oandaConnected,
    refetchInterval: 30000,
  });

  const [lossLimit, setLossLimit] = useState("5");
  const [maxPositions, setMaxPositions] = useState("3");
  const [enabled, setEnabled] = useState(true);
  const [tfDurations, setTfDurations] = useState<Record<string, string>>({
    "1m": "3",
    "5m": "4",
    "15m": "6",
    "1h": "12",
    "4h": "24",
  });

  useEffect(() => {
    if (guardianStatus) {
      setLossLimit(guardianStatus.dailyLossLimitPercent.toString());
      setMaxPositions((guardianStatus.maxOpenPositions ?? 3).toString());
      setEnabled(guardianStatus.enabled);
      if (guardianStatus.timeframeDurations) {
        const durations: Record<string, string> = {};
        for (const tf of Object.keys(RECOMMENDED_DURATIONS)) {
          durations[tf] = (guardianStatus.timeframeDurations[tf] ?? RECOMMENDED_DURATIONS[tf]).toString();
        }
        setTfDurations(durations);
      }
    }
  }, [guardianStatus]);

  const isCustomised = Object.entries(tfDurations).some(
    ([tf, val]) => parseFloat(val) !== RECOMMENDED_DURATIONS[tf]
  );

  const resetToRecommended = () => {
    const defaults: Record<string, string> = {};
    for (const tf of Object.keys(RECOMMENDED_DURATIONS)) {
      defaults[tf] = RECOMMENDED_DURATIONS[tf].toString();
    }
    setTfDurations(defaults);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const timeframeDurations: Record<string, number> = {};
      for (const [tf, val] of Object.entries(tfDurations)) {
        const num = parseFloat(val);
        timeframeDurations[tf] = num > 0 ? num : RECOMMENDED_DURATIONS[tf];
      }
      await apiRequest("POST", "/api/oanda/guardian/config", {
        maxTradeDurationHours: Math.max(...Object.values(timeframeDurations)),
        dailyLossLimitPercent: parseFloat(lossLimit) || 5,
        maxOpenPositions: parseInt(maxPositions) || 3,
        timeframeDurations,
        enabled,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/oanda/guardian/status"] });
      toast({ title: "Guardian settings saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!oandaConnected) return null;

  return (
    <Card data-testid="card-guardian">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          OANDA Account Protection
          {guardianStatus?.isNewTradesPaused && (
            <Badge variant="destructive" className="ml-2 text-xs">
              Trades Paused
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Automatic safety limits for your OANDA trading account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="guardianEnabled">Guardian Enabled</Label>
            <p className="text-sm text-muted-foreground">
              Auto-close overdue trades and enforce daily loss limits
            </p>
          </div>
          <Switch
            id="guardianEnabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            data-testid="switch-guardian-enabled"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Trade Duration Limits
            </Label>
            {isCustomised && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetToRecommended}
                className="h-7 text-xs gap-1 text-muted-foreground"
                data-testid="button-reset-durations"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to Recommended
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Maximum hours a trade can stay open per timeframe. Based on real trading results.
          </p>
          <div className="space-y-2">
            {Object.entries(RECOMMENDED_DURATIONS).map(([tf, recommended]) => {
              const current = parseFloat(tfDurations[tf] || recommended.toString());
              const isDefault = current === recommended;
              return (
                <div key={tf} className="flex items-center gap-3" data-testid={`row-tf-${tf}`}>
                  <div className="w-20 shrink-0">
                    <span className="text-sm font-medium">{TIMEFRAME_LABELS[tf]}</span>
                  </div>
                  <Input
                    type="number"
                    min="1"
                    max="72"
                    step="1"
                    value={tfDurations[tf]}
                    onChange={(e) => setTfDurations(prev => ({ ...prev, [tf]: e.target.value }))}
                    className="w-20 h-8 text-sm"
                    data-testid={`input-tf-${tf}`}
                  />
                  <span className="text-xs text-muted-foreground">hrs</span>
                  {isDefault ? (
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0">
                      Recommended
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0 border-amber-500/50 text-amber-500">
                      Custom (rec: {recommended}h)
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dailyLoss" className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Daily Loss Limit (%)
          </Label>
          <p className="text-sm text-muted-foreground">
            Stops placing new trades when losses reach this % of balance. Existing trades keep running with their SL/TP.
          </p>
          <Input
            id="dailyLoss"
            type="number"
            min="1"
            max="20"
            step="0.5"
            value={lossLimit}
            onChange={(e) => setLossLimit(e.target.value)}
            className="max-w-[120px]"
            data-testid="input-daily-loss-limit"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxPositions" className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Max Open Trades
          </Label>
          <p className="text-sm text-muted-foreground">
            Maximum number of trades that can be open at the same time (1-10)
          </p>
          <Input
            id="maxPositions"
            type="number"
            min="1"
            max="10"
            step="1"
            value={maxPositions}
            onChange={(e) => setMaxPositions(e.target.value)}
            className="max-w-[120px]"
            data-testid="input-max-positions"
          />
        </div>

        <Button
          onClick={saveConfig}
          disabled={saving}
          className="w-full min-h-[44px]"
          data-testid="button-save-guardian"
        >
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Guardian Settings
        </Button>

        {guardianStatus?.isNewTradesPaused && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            <ShieldAlert className="h-4 w-4 inline mr-2" />
            Daily loss limit reached. New trades are paused until your unrealized losses recover. Existing positions continue with their stop-loss and take-profit.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

