import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp,
  Zap,
  Signal,
  Settings,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Target,
  LineChart,
  User,
  ShieldCheck,
  Bell,
  CreditCard,
  AlertTriangle,
  Clock,
  Percent,
} from "lucide-react";
import { Link } from "wouter";

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
}

const TOTAL_STEPS = 6;

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          className={`h-2 w-2 rounded-full transition-colors ${
            i === current ? "bg-primary" : "bg-muted"
          }`}
          data-testid={`dot-step-${i}`}
        />
      ))}
    </div>
  );
}

function WelcomeStep({ displayName, onDisplayNameChange }: { displayName: string; onDisplayNameChange: (v: string) => void }) {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-4">
      <div className="rounded-full bg-primary/10 p-4">
        <TrendingUp className="h-10 w-10 text-primary" />
      </div>
      <DialogHeader className="space-y-2">
        <DialogTitle className="text-2xl font-bold text-foreground">
          Welcome to TradeIQ!
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-base">
          Your AI-powered trading intelligence platform for Forex and Gold.
          Let's get you set up in under a minute.
        </DialogDescription>
      </DialogHeader>
      <div className="w-full max-w-xs space-y-2 text-left">
        <Label htmlFor="onboard-name" className="flex items-center gap-1.5 text-sm font-medium">
          <User className="h-3.5 w-3.5" />
          What should we call you?
        </Label>
        <Input
          id="onboard-name"
          placeholder="Your trader name"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          data-testid="input-onboard-display-name"
        />
        <p className="text-xs text-muted-foreground">This appears on the leaderboard. You can change it later in Settings.</p>
      </div>
    </div>
  );
}

function HowItWorksStep() {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-6">
      <DialogHeader className="space-y-2">
        <DialogTitle className="text-2xl font-bold text-foreground">
          How It Works
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-base">
          TradeIQ has two independent trading engines that work around the clock
          to find high-probability opportunities.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 w-full">
        <div className="flex items-start gap-3 text-left rounded-md border p-4">
          <div className="rounded-full bg-primary/10 p-2 shrink-0">
            <Signal className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">Main Signal Scanner</span>
              <Badge variant="secondary" className="text-xs">Swing Trades</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Analyzes multiple timeframes to identify high-probability swing
              trade setups across Forex pairs and Gold.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 text-left rounded-md border p-4">
          <div className="rounded-full bg-primary/10 p-2 shrink-0">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">Profit Trapper</span>
              <Badge variant="secondary" className="text-xs">Scalping</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              High-frequency scalping engine that captures quick profits from
              micro-movements in the market.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RiskAndCommissionStep() {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-4">
      <div className="rounded-full bg-primary/10 p-4">
        <CreditCard className="h-10 w-10 text-primary" />
      </div>
      <DialogHeader className="space-y-2">
        <DialogTitle className="text-2xl font-bold text-foreground">
          Risk & Pricing
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-base">
          Understanding how your money is protected and how TradeIQ earns.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 w-full text-left">
        <div className="flex items-start gap-3 rounded-md border p-3">
          <Percent className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">1% Risk Per Trade</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each trade risks only 1% of your account balance. On a £300 account, that's £3 max per trade.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border p-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">Gold & Silver on Small Accounts</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Metals have minimum trade sizes that may push risk above 1% on accounts under £1,000. You'll see a clear warning with the exact risk before any trade is placed.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border p-3">
          <CreditCard className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">25% Commission on Profits</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live OANDA accounts pay 25% of profitable trades only. Demo accounts trade free. You'll need to deposit a small balance to start.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectOandaStep() {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-4">
      <div className="rounded-full bg-primary/10 p-4">
        <Settings className="h-10 w-10 text-primary" />
      </div>
      <DialogHeader className="space-y-2">
        <DialogTitle className="text-2xl font-bold text-foreground">
          Connect Your Broker
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-base">
          Connect your OANDA account and turn on auto-execute to let TradeIQ
          place and manage trades for you automatically.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 w-full text-left">
        <div className="flex items-start gap-3 rounded-md border p-3">
          <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">Auto-Execute</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, TradeIQ automatically places real trades on your OANDA account when it finds a high-confidence signal. You can also place trades manually.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border p-3">
          <Settings className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">Set Up in Settings</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Go to{" "}
              <Link href="/settings" className="text-primary underline underline-offset-2" data-testid="link-onboard-oanda-settings">
                Settings
              </Link>{" "}
              to enter your OANDA API key and account ID. No pressure to set this up now.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SafetyAndNotificationsStep() {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-4">
      <div className="rounded-full bg-primary/10 p-4">
        <ShieldCheck className="h-10 w-10 text-primary" />
      </div>
      <DialogHeader className="space-y-2">
        <DialogTitle className="text-2xl font-bold text-foreground">
          Safety & Notifications
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-base">
          Your trades are actively monitored and managed around the clock.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 w-full text-left">
        <div className="flex items-start gap-3 rounded-md border p-3">
          <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">Trade Guardian</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically closes trades that exceed time limits, applies trailing stops to lock in profits, and pauses trading if daily losses reach 5%.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border p-3">
          <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">Smart Trade Management</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Trades get break-even stops, trailing profit locks, and time-based exits. Every trade has a safety net.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border p-3">
          <Bell className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">Push Notifications</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Get alerts when trades open, close, hit profit targets, or get stopped out. Enable notifications in{" "}
              <Link href="/settings" className="text-primary underline underline-offset-2" data-testid="link-onboard-notif-settings">
                Settings
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadyStep() {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-4">
      <div className="rounded-full bg-primary/10 p-4">
        <CheckCircle2 className="h-10 w-10 text-primary" />
      </div>
      <DialogHeader className="space-y-2">
        <DialogTitle className="text-2xl font-bold text-foreground">
          You're All Set!
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-base">
          TradeIQ is ready to help you trade smarter. Here's your quick-start checklist.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 w-full">
        <Link href="/settings">
          <div className="flex items-center gap-3 rounded-md border p-3 hover-elevate cursor-pointer" data-testid="link-onboard-settings">
            <Settings className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="text-left">
              <span className="text-sm font-medium text-foreground">1. Connect OANDA</span>
              <p className="text-xs text-muted-foreground">Add your API key and enable auto-execute</p>
            </div>
          </div>
        </Link>
        <Link href="/commission">
          <div className="flex items-center gap-3 rounded-md border p-3 hover-elevate cursor-pointer" data-testid="link-onboard-deposit">
            <CreditCard className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="text-left">
              <span className="text-sm font-medium text-foreground">2. Deposit Funds</span>
              <p className="text-xs text-muted-foreground">Required for live trading (demo is free)</p>
            </div>
          </div>
        </Link>
        <Link href="/">
          <div className="flex items-center gap-3 rounded-md border p-3 hover-elevate cursor-pointer" data-testid="link-onboard-dashboard">
            <LineChart className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="text-left">
              <span className="text-sm font-medium text-foreground">3. Watch the Dashboard</span>
              <p className="text-xs text-muted-foreground">Signals appear automatically as the scanner finds opportunities</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

export function OnboardingWizard({ open, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      if (displayName.trim()) {
        await fetch("/api/user/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ displayName: displayName.trim() }),
        });
      }
      await fetch("/api/user/onboarding-complete", {
        method: "POST",
        credentials: "include",
      });
    } catch {
    } finally {
      setIsCompleting(false);
      onComplete();
    }
  };

  const handleSkip = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
    }
  };

  const skippableSteps = [3, 4];

  const steps = [
    <WelcomeStep key="welcome" displayName={displayName} onDisplayNameChange={setDisplayName} />,
    <HowItWorksStep key="how" />,
    <RiskAndCommissionStep key="risk" />,
    <ConnectOandaStep key="oanda" />,
    <SafetyAndNotificationsStep key="safety" />,
    <ReadyStep key="ready" />,
  ];

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="py-4">{steps[step]}</div>

        <DialogFooter className="flex flex-col gap-3 sm:flex-col">
          <StepDots current={step} />
          <div className="flex items-center justify-between gap-2 w-full">
            {step > 0 ? (
              <Button
                variant="ghost"
                onClick={handleBack}
                data-testid="button-onboard-back"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              {skippableSteps.includes(step) && (
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                  data-testid="button-onboard-skip"
                >
                  Skip
                </Button>
              )}
              {step < TOTAL_STEPS - 1 ? (
                <Button onClick={handleNext} data-testid="button-onboard-next">
                  {step === 0 ? "Get Started" : "Next"}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleComplete}
                  disabled={isCompleting}
                  data-testid="button-onboard-complete"
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  {isCompleting ? "Finishing..." : "Start Trading"}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
