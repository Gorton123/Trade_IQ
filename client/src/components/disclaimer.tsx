import { AlertTriangle } from "lucide-react";

export function Disclaimer() {
  return (
    <div className="bg-muted/50 border border-border rounded-lg p-3 text-xs text-muted-foreground">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
        <div>
          <span className="font-medium text-foreground">Educational Tool Only.</span>{" "}
          TradeIQ provides market analysis for educational purposes. This is not financial advice. 
          Trading forex and CFDs carries significant risk. You retain full responsibility for all trade execution decisions. 
          Past performance does not guarantee future results.
        </div>
      </div>
    </div>
  );
}
