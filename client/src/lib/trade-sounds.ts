const audioContext = typeof window !== "undefined" ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", volume: number = 0.15) {
  if (!audioContext) return;
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration);
}

export function playTradeOpenedSound() {
  if (!audioContext) return;
  playTone(523, 0.15, "sine", 0.12);
  setTimeout(() => playTone(659, 0.15, "sine", 0.12), 150);
  setTimeout(() => playTone(784, 0.2, "sine", 0.12), 300);
}

export function playTradeWonSound() {
  if (!audioContext) return;
  playTone(523, 0.12, "sine", 0.15);
  setTimeout(() => playTone(659, 0.12, "sine", 0.15), 120);
  setTimeout(() => playTone(784, 0.12, "sine", 0.15), 240);
  setTimeout(() => playTone(1047, 0.3, "sine", 0.15), 360);
}

export function playTradeLostSound() {
  if (!audioContext) return;
  playTone(440, 0.2, "triangle", 0.12);
  setTimeout(() => playTone(349, 0.3, "triangle", 0.12), 200);
}

export function playSignalSound() {
  if (!audioContext) return;
  playTone(880, 0.1, "sine", 0.1);
  setTimeout(() => playTone(1100, 0.15, "sine", 0.1), 100);
}

let soundEnabled = true;

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  if (typeof window !== "undefined") {
    localStorage.setItem("tradeiq-sounds", enabled ? "on" : "off");
  }
}

export function isSoundEnabled(): boolean {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("tradeiq-sounds");
    if (stored !== null) {
      soundEnabled = stored === "on";
    }
  }
  return soundEnabled;
}

export function playIfEnabled(soundFn: () => void) {
  if (isSoundEnabled()) {
    soundFn();
  }
}
