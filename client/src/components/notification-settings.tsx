import { useState, useEffect } from 'react';
import { Bell, BellOff, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

const INSTRUMENTS = ['XAUUSD', 'XAGUSD', 'GBPUSD', 'EURUSD', 'USDCHF', 'AUDUSD', 'NZDUSD'] as const;

export function NotificationSettings() {
  const { toast } = useToast();
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [minConfidence, setMinConfidence] = useState(70);
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>(['XAUUSD']);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);

  useEffect(() => {
    checkSupport();
    loadVapidKey();
    checkSubscription();
  }, []);

  const updatePreferences = async (instruments: string[], confidence: number) => {
    if (!currentEndpoint || !isSubscribed) return;
    
    try {
      await apiRequest('PATCH', '/api/push/preferences', {
        endpoint: currentEndpoint,
        instruments,
        minConfidence: confidence
      });
    } catch (error) {
      console.error('Failed to update preferences:', error);
    }
  };

  const checkSupport = () => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setIsSupported(supported);
  };

  const loadVapidKey = async () => {
    try {
      const response = await fetch('/api/push/vapid-key');
      const data = await response.json();
      if (data.configured) {
        setVapidKey(data.publicKey);
      }
    } catch (error) {
      console.error('Failed to load VAPID key:', error);
    }
  };

  const checkSubscription = async () => {
    if (!('serviceWorker' in navigator)) return;
    
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
      if (subscription) {
        setCurrentEndpoint(subscription.endpoint);
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  };

  const subscribe = async () => {
    if (!vapidKey) {
      toast({
        title: "Push notifications not configured",
        description: "The server needs VAPID keys to enable notifications",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast({
          title: "Permission denied",
          description: "Please enable notifications in your browser settings",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });

      await apiRequest('POST', '/api/push/subscribe', {
        subscription: subscription.toJSON(),
        instruments: selectedInstruments,
        minConfidence
      });

      setCurrentEndpoint(subscription.endpoint);
      setIsSubscribed(true);
      toast({
        title: "Notifications enabled!",
        description: `You'll receive alerts for ${minConfidence}%+ confidence signals`
      });
    } catch (error) {
      console.error('Subscription error:', error);
      toast({
        title: "Failed to enable notifications",
        description: "Please try again or check your browser settings",
        variant: "destructive"
      });
    }
    setIsLoading(false);
  };

  const unsubscribe = async () => {
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
        await apiRequest('POST', '/api/push/unsubscribe', { 
          endpoint: subscription.endpoint 
        });
      }

      setCurrentEndpoint(null);
      setIsSubscribed(false);
      toast({
        title: "Notifications disabled",
        description: "You won't receive signal alerts anymore"
      });
    } catch (error) {
      console.error('Unsubscribe error:', error);
      toast({
        title: "Failed to disable notifications",
        variant: "destructive"
      });
    }
    setIsLoading(false);
  };

  const toggleInstrument = (instrument: string) => {
    const newInstruments = selectedInstruments.includes(instrument)
      ? selectedInstruments.filter(i => i !== instrument)
      : [...selectedInstruments, instrument];
    
    if (newInstruments.length === 0) return;
    
    setSelectedInstruments(newInstruments);
    updatePreferences(newInstruments, minConfidence);
  };

  const handleConfidenceChange = (value: number) => {
    setMinConfidence(value);
    updatePreferences(selectedInstruments, value);
  };

  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellOff className="h-5 w-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Your browser doesn't support push notifications
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Signal Alerts
        </CardTitle>
        <CardDescription>
          Get notified on your phone when high-confidence signals appear
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Enable Notifications</Label>
            <p className="text-sm text-muted-foreground">
              {isSubscribed ? 'Receiving signal alerts' : 'Notifications are off'}
            </p>
          </div>
          <Switch
            checked={isSubscribed}
            onCheckedChange={(checked) => checked ? subscribe() : unsubscribe()}
            disabled={isLoading || !vapidKey}
            data-testid="switch-notifications"
          />
        </div>

        {!vapidKey && (
          <div className="flex items-center gap-2 text-sm text-amber-500">
            <AlertCircle className="h-4 w-4" />
            Server needs VAPID keys configured
          </div>
        )}

        {isSubscribed && (
          <>
            <div className="space-y-3">
              <Label>Minimum Confidence: {minConfidence}%</Label>
              <Slider
                value={[minConfidence]}
                onValueChange={([value]) => handleConfidenceChange(value)}
                min={50}
                max={95}
                step={5}
                className="w-full"
                data-testid="slider-confidence"
              />
              <p className="text-xs text-muted-foreground">
                Only notify for signals with {minConfidence}%+ confidence
              </p>
            </div>

            <div className="space-y-3">
              <Label>Instruments to Monitor</Label>
              <div className="flex flex-wrap gap-2">
                {INSTRUMENTS.map(instrument => (
                  <Button
                    key={instrument}
                    variant={selectedInstruments.includes(instrument) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleInstrument(instrument)}
                    data-testid={`button-instrument-${instrument}`}
                  >
                    {selectedInstruments.includes(instrument) && (
                      <Check className="h-3 w-3 mr-1" />
                    )}
                    {instrument}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
