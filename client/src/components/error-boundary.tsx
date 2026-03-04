import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("App Error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  handleClearAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.error("Failed to clear storage:", e);
    }
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="flex justify-center">
              <div className="rounded-full bg-destructive/10 p-4">
                <AlertTriangle className="h-12 w-12 text-destructive" />
              </div>
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
              <p className="text-muted-foreground">
                The app encountered an error. Tap below to reload and try again.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Button 
                onClick={this.handleReload} 
                size="lg" 
                className="w-full gap-2"
                data-testid="button-reload"
              >
                <RefreshCw className="h-4 w-4" />
                Reload App
              </Button>
              
              <Button 
                onClick={this.handleGoHome} 
                variant="outline" 
                size="lg" 
                className="w-full gap-2"
                data-testid="button-go-home"
              >
                <Home className="h-4 w-4" />
                Go to Dashboard
              </Button>

              <Button 
                onClick={this.handleClearAndReload} 
                variant="ghost" 
                size="sm" 
                className="w-full text-muted-foreground"
                data-testid="button-clear-reload"
              >
                Clear cache and reload
              </Button>
            </div>

            {this.state.error && (
              <details className="text-left text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                <summary className="cursor-pointer">Error details</summary>
                <pre className="mt-2 whitespace-pre-wrap overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
