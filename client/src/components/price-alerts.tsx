import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Bell, BellOff, Plus, Trash2, AlertTriangle } from "lucide-react";
import { instruments, type PriceAlert, type Instrument } from "@shared/schema";

export function PriceAlerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [newAlert, setNewAlert] = useState({
    instrument: "XAUUSD" as Instrument,
    targetPrice: "",
    condition: "above" as "above" | "below" | "crosses",
    note: "",
  });

  const handleAddAlert = () => {
    const alert: PriceAlert = {
      id: Date.now().toString(),
      instrument: newAlert.instrument,
      targetPrice: parseFloat(newAlert.targetPrice),
      condition: newAlert.condition,
      isActive: true,
      isTriggered: false,
      createdAt: new Date().toISOString(),
      note: newAlert.note || undefined,
    };
    setAlerts([alert, ...alerts]);
    setIsOpen(false);
    setNewAlert({
      instrument: "XAUUSD",
      targetPrice: "",
      condition: "above",
      note: "",
    });
  };

  const toggleAlert = (id: string) => {
    setAlerts(alerts.map(alert => 
      alert.id === id ? { ...alert, isActive: !alert.isActive } : alert
    ));
  };

  const deleteAlert = (id: string) => {
    setAlerts(alerts.filter(alert => alert.id !== id));
  };

  const formatPrice = (price: number, instrument: string) => {
    return instrument === "XAUUSD" ? price.toFixed(2) : price.toFixed(5);
  };

  const conditionLabels = {
    above: "Price rises above",
    below: "Price falls below",
    crosses: "Price crosses",
  };

  return (
    <Card data-testid="card-price-alerts">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Price Alerts
          </CardTitle>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="min-h-[44px]" data-testid="button-add-alert">
                <Plus className="w-4 h-4 mr-1" />
                Add Alert
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create Price Alert</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Instrument</Label>
                  <Select
                    value={newAlert.instrument}
                    onValueChange={(v) => setNewAlert({ ...newAlert, instrument: v as Instrument })}
                  >
                    <SelectTrigger data-testid="select-alert-instrument">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {instruments.map((inst) => (
                        <SelectItem key={inst} value={inst}>{inst}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Condition</Label>
                  <Select
                    value={newAlert.condition}
                    onValueChange={(v) => setNewAlert({ ...newAlert, condition: v as "above" | "below" | "crosses" })}
                  >
                    <SelectTrigger data-testid="select-alert-condition">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="above">Price rises above</SelectItem>
                      <SelectItem value="below">Price falls below</SelectItem>
                      <SelectItem value="crosses">Price crosses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Target Price</Label>
                  <Input
                    type="number"
                    step="any"
                    placeholder={newAlert.instrument === "XAUUSD" ? "e.g., 2350.00" : "e.g., 1.0850"}
                    value={newAlert.targetPrice}
                    onChange={(e) => setNewAlert({ ...newAlert, targetPrice: e.target.value })}
                    data-testid="input-target-price"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Note (optional)</Label>
                  <Input
                    value={newAlert.note}
                    onChange={(e) => setNewAlert({ ...newAlert, note: e.target.value })}
                    placeholder="e.g., Key resistance level"
                    data-testid="input-alert-note"
                  />
                </div>

                <Button
                  className="w-full min-h-[44px]"
                  onClick={handleAddAlert}
                  disabled={!newAlert.targetPrice}
                  data-testid="button-submit-alert"
                >
                  Create Alert
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <BellOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No price alerts set</p>
            <p className="text-xs">Create alerts to get notified when prices hit your targets</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-md transition-colors ${
                  alert.isTriggered
                    ? "bg-amber-500/20 border border-amber-500/30"
                    : alert.isActive
                    ? "bg-muted/30 hover:bg-muted/50"
                    : "bg-muted/10 opacity-60"
                }`}
                data-testid={`alert-${alert.id}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{alert.instrument}</Badge>
                    {alert.isTriggered && (
                      <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Triggered
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="min-w-[36px] min-h-[36px]"
                      onClick={() => toggleAlert(alert.id)}
                      data-testid={`button-toggle-alert-${alert.id}`}
                    >
                      {alert.isActive ? (
                        <Bell className="w-4 h-4 text-primary" />
                      ) : (
                        <BellOff className="w-4 h-4 text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="min-w-[36px] min-h-[36px] text-destructive hover:text-destructive"
                      onClick={() => deleteAlert(alert.id)}
                      data-testid={`button-delete-alert-${alert.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">{conditionLabels[alert.condition]}: </span>
                  <span className="font-mono font-medium">{formatPrice(alert.targetPrice, alert.instrument)}</span>
                </div>
                {alert.note && (
                  <div className="text-xs text-muted-foreground mt-1">{alert.note}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
