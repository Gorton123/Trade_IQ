import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Settings, Save, RotateCcw } from "lucide-react";
import { instruments, timeframes, type UserSettings, type Instrument, type Timeframe } from "@shared/schema";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/hooks/use-toast";

interface SettingsPanelProps {
  onSettingsChange?: (settings: UserSettings) => void;
}

const defaultSettings: UserSettings = {
  defaultBalance: 10000,
  defaultRiskPercent: 1,
  defaultStopLossPips: 20,
  preferredInstruments: ["XAUUSD", "XAGUSD", "EURUSD"],
  preferredTimeframe: "1h",
  theme: "dark",
  notifications: true,
};

export function SettingsPanel({ onSettingsChange }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem("tradeiq-settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultSettings, ...parsed, preferredInstruments: Array.isArray(parsed.preferredInstruments) ? parsed.preferredInstruments : defaultSettings.preferredInstruments };
      } catch { return defaultSettings; }
    }
    return defaultSettings;
  });
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  useEffect(() => {
    if (settings.theme !== theme) {
      setSettings(prev => ({ ...prev, theme: theme as "dark" | "light" }));
    }
  }, [theme]);

  const saveSettings = () => {
    localStorage.setItem("tradeiq-settings", JSON.stringify(settings));
    setTheme(settings.theme);
    onSettingsChange?.(settings);
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated.",
    });
    setIsOpen(false);
  };

  const resetSettings = () => {
    setSettings(defaultSettings);
    localStorage.removeItem("tradeiq-settings");
    toast({
      title: "Settings reset",
      description: "Default settings restored.",
    });
  };

  const toggleInstrument = (inst: Instrument) => {
    const current = settings.preferredInstruments;
    if (current.includes(inst)) {
      if (current.length > 1) {
        setSettings({
          ...settings,
          preferredInstruments: current.filter(i => i !== inst),
        });
      }
    } else {
      setSettings({
        ...settings,
        preferredInstruments: [...current, inst],
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="min-w-[44px] min-h-[44px]"
          data-testid="button-settings"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Settings
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 pt-4">
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Trading Defaults</h3>
            
            <div className="space-y-2">
              <Label>Default Account Balance (GBP)</Label>
              <Input
                type="number"
                value={settings.defaultBalance}
                onChange={(e) => setSettings({ ...settings, defaultBalance: parseFloat(e.target.value) || 10000 })}
                data-testid="input-default-balance"
              />
            </div>

            <div className="space-y-2">
              <Label>Default Risk Percentage: {settings.defaultRiskPercent}%</Label>
              <Slider
                value={[settings.defaultRiskPercent]}
                onValueChange={([v]) => setSettings({ ...settings, defaultRiskPercent: v })}
                min={0.5}
                max={5}
                step={0.5}
                className="py-2"
                data-testid="slider-default-risk"
              />
            </div>

            <div className="space-y-2">
              <Label>Default Stop Loss (pips)</Label>
              <Input
                type="number"
                value={settings.defaultStopLossPips}
                onChange={(e) => setSettings({ ...settings, defaultStopLossPips: parseFloat(e.target.value) || 20 })}
                data-testid="input-default-sl"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium">Preferred Instruments</h3>
            <div className="flex flex-wrap gap-2">
              {instruments.map((inst) => (
                <Button
                  key={inst}
                  variant={settings.preferredInstruments.includes(inst) ? "default" : "outline"}
                  size="sm"
                  className="min-h-[40px]"
                  onClick={() => toggleInstrument(inst)}
                  data-testid={`button-pref-${inst}`}
                >
                  {inst}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium">Default Timeframe</h3>
            <Select
              value={settings.preferredTimeframe}
              onValueChange={(v) => setSettings({ ...settings, preferredTimeframe: v as Timeframe })}
            >
              <SelectTrigger data-testid="select-default-tf">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeframes.map((tf) => (
                  <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium">Appearance</h3>
            <div className="flex items-center justify-between">
              <Label>Dark Mode</Label>
              <Switch
                checked={settings.theme === "dark"}
                onCheckedChange={(checked) => setSettings({ ...settings, theme: checked ? "dark" : "light" })}
                data-testid="switch-dark-mode"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium">Notifications</h3>
            <div className="flex items-center justify-between">
              <Label>Enable Price Alerts</Label>
              <Switch
                checked={settings.notifications}
                onCheckedChange={(checked) => setSettings({ ...settings, notifications: checked })}
                data-testid="switch-notifications"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              className="flex-1 min-h-[44px]"
              onClick={resetSettings}
              data-testid="button-reset-settings"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button
              className="flex-1 min-h-[44px]"
              onClick={saveSettings}
              data-testid="button-save-settings"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
