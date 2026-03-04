interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PatternResult {
  pattern: string;
  type: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  startIndex: number;
  endIndex: number;
  description: string;
  targetPrice?: number;
  stopLoss?: number;
}

interface FibonacciLevel {
  level: number;
  price: number;
  label: string;
}

interface ElliottWave {
  wave: string;
  type: 'impulse' | 'corrective';
  direction: 'up' | 'down';
  confidence: number;
  description: string;
}

export class PatternRecognitionService {
  
  detectPatterns(data: OHLCV[]): PatternResult[] {
    const patterns: PatternResult[] = [];
    
    if (data.length < 20) return patterns;

    // Detect Double Top
    const doubleTop = this.detectDoubleTop(data);
    if (doubleTop) patterns.push(doubleTop);

    // Detect Double Bottom
    const doubleBottom = this.detectDoubleBottom(data);
    if (doubleBottom) patterns.push(doubleBottom);

    // Detect Head and Shoulders
    const headShoulders = this.detectHeadAndShoulders(data);
    if (headShoulders) patterns.push(headShoulders);

    // Detect Inverse Head and Shoulders
    const inverseHS = this.detectInverseHeadAndShoulders(data);
    if (inverseHS) patterns.push(inverseHS);

    // Detect Triangle patterns
    const triangle = this.detectTriangle(data);
    if (triangle) patterns.push(triangle);

    // Detect Engulfing patterns
    const engulfing = this.detectEngulfing(data);
    if (engulfing) patterns.push(engulfing);

    return patterns;
  }

  private detectDoubleTop(data: OHLCV[]): PatternResult | null {
    const highs = data.map((d, i) => ({ price: d.high, index: i }));
    const peaks = this.findPeaks(highs.map(h => h.price), 5);
    
    if (peaks.length < 2) return null;

    const lastTwoPeaks = peaks.slice(-2);
    const [peak1, peak2] = lastTwoPeaks;
    
    const priceDiff = Math.abs(data[peak1].high - data[peak2].high);
    const avgPrice = (data[peak1].high + data[peak2].high) / 2;
    const tolerance = avgPrice * 0.02; // 2% tolerance

    if (priceDiff < tolerance && peak2 - peak1 >= 5) {
      const neckline = Math.min(...data.slice(peak1, peak2 + 1).map(d => d.low));
      const patternHeight = avgPrice - neckline;
      
      return {
        pattern: 'Double Top',
        type: 'bearish',
        confidence: Math.min(85, 60 + (1 - priceDiff / tolerance) * 25),
        startIndex: peak1,
        endIndex: peak2,
        description: 'Bearish reversal pattern - two peaks at similar levels',
        targetPrice: neckline - patternHeight,
        stopLoss: avgPrice * 1.01,
      };
    }

    return null;
  }

  private detectDoubleBottom(data: OHLCV[]): PatternResult | null {
    const lows = data.map((d, i) => ({ price: d.low, index: i }));
    const troughs = this.findTroughs(lows.map(l => l.price), 5);
    
    if (troughs.length < 2) return null;

    const lastTwoTroughs = troughs.slice(-2);
    const [trough1, trough2] = lastTwoTroughs;
    
    const priceDiff = Math.abs(data[trough1].low - data[trough2].low);
    const avgPrice = (data[trough1].low + data[trough2].low) / 2;
    const tolerance = avgPrice * 0.02;

    if (priceDiff < tolerance && trough2 - trough1 >= 5) {
      const neckline = Math.max(...data.slice(trough1, trough2 + 1).map(d => d.high));
      const patternHeight = neckline - avgPrice;
      
      return {
        pattern: 'Double Bottom',
        type: 'bullish',
        confidence: Math.min(85, 60 + (1 - priceDiff / tolerance) * 25),
        startIndex: trough1,
        endIndex: trough2,
        description: 'Bullish reversal pattern - two lows at similar levels',
        targetPrice: neckline + patternHeight,
        stopLoss: avgPrice * 0.99,
      };
    }

    return null;
  }

  private detectHeadAndShoulders(data: OHLCV[]): PatternResult | null {
    const peaks = this.findPeaks(data.map(d => d.high), 3);
    
    if (peaks.length < 3) return null;

    const lastThreePeaks = peaks.slice(-3);
    const [leftShoulder, head, rightShoulder] = lastThreePeaks;
    
    const headHigh = data[head].high;
    const leftShoulderHigh = data[leftShoulder].high;
    const rightShoulderHigh = data[rightShoulder].high;

    const shoulderDiff = Math.abs(leftShoulderHigh - rightShoulderHigh);
    const avgShoulderHeight = (leftShoulderHigh + rightShoulderHigh) / 2;
    const tolerance = avgShoulderHeight * 0.03;

    if (headHigh > leftShoulderHigh && 
        headHigh > rightShoulderHigh && 
        shoulderDiff < tolerance &&
        head - leftShoulder >= 3 && 
        rightShoulder - head >= 3) {
      
      const neckline = Math.min(
        ...data.slice(leftShoulder, rightShoulder + 1).map(d => d.low)
      );
      const patternHeight = headHigh - neckline;

      return {
        pattern: 'Head and Shoulders',
        type: 'bearish',
        confidence: Math.min(90, 65 + (headHigh - avgShoulderHeight) / headHigh * 100),
        startIndex: leftShoulder,
        endIndex: rightShoulder,
        description: 'Major bearish reversal pattern - head higher than shoulders',
        targetPrice: neckline - patternHeight,
        stopLoss: headHigh * 1.005,
      };
    }

    return null;
  }

  private detectInverseHeadAndShoulders(data: OHLCV[]): PatternResult | null {
    const troughs = this.findTroughs(data.map(d => d.low), 3);
    
    if (troughs.length < 3) return null;

    const lastThreeTroughs = troughs.slice(-3);
    const [leftShoulder, head, rightShoulder] = lastThreeTroughs;
    
    const headLow = data[head].low;
    const leftShoulderLow = data[leftShoulder].low;
    const rightShoulderLow = data[rightShoulder].low;

    const shoulderDiff = Math.abs(leftShoulderLow - rightShoulderLow);
    const avgShoulderLow = (leftShoulderLow + rightShoulderLow) / 2;
    const tolerance = avgShoulderLow * 0.03;

    if (headLow < leftShoulderLow && 
        headLow < rightShoulderLow && 
        shoulderDiff < tolerance) {
      
      const neckline = Math.max(
        ...data.slice(leftShoulder, rightShoulder + 1).map(d => d.high)
      );
      const patternHeight = neckline - headLow;

      return {
        pattern: 'Inverse Head and Shoulders',
        type: 'bullish',
        confidence: Math.min(90, 65 + (avgShoulderLow - headLow) / avgShoulderLow * 100),
        startIndex: leftShoulder,
        endIndex: rightShoulder,
        description: 'Major bullish reversal pattern - head lower than shoulders',
        targetPrice: neckline + patternHeight,
        stopLoss: headLow * 0.995,
      };
    }

    return null;
  }

  private detectTriangle(data: OHLCV[]): PatternResult | null {
    if (data.length < 15) return null;

    const recentData = data.slice(-15);
    const highs = recentData.map(d => d.high);
    const lows = recentData.map(d => d.low);

    const highSlope = this.calculateSlope(highs);
    const lowSlope = this.calculateSlope(lows);

    // Symmetrical triangle: converging highs and lows
    if (highSlope < -0.0001 && lowSlope > 0.0001) {
      return {
        pattern: 'Symmetrical Triangle',
        type: 'neutral',
        confidence: 70,
        startIndex: data.length - 15,
        endIndex: data.length - 1,
        description: 'Continuation pattern - breakout direction determines bias',
      };
    }

    // Ascending triangle: flat highs, rising lows
    if (Math.abs(highSlope) < 0.0001 && lowSlope > 0.0002) {
      return {
        pattern: 'Ascending Triangle',
        type: 'bullish',
        confidence: 75,
        startIndex: data.length - 15,
        endIndex: data.length - 1,
        description: 'Bullish continuation - expect breakout above resistance',
      };
    }

    // Descending triangle: falling highs, flat lows
    if (highSlope < -0.0002 && Math.abs(lowSlope) < 0.0001) {
      return {
        pattern: 'Descending Triangle',
        type: 'bearish',
        confidence: 75,
        startIndex: data.length - 15,
        endIndex: data.length - 1,
        description: 'Bearish continuation - expect breakout below support',
      };
    }

    return null;
  }

  private detectEngulfing(data: OHLCV[]): PatternResult | null {
    if (data.length < 2) return null;

    const prev = data[data.length - 2];
    const curr = data[data.length - 1];

    // Bullish engulfing
    if (prev.close < prev.open && // Previous bearish
        curr.close > curr.open && // Current bullish
        curr.open < prev.close && // Opens below previous close
        curr.close > prev.open) { // Closes above previous open
      return {
        pattern: 'Bullish Engulfing',
        type: 'bullish',
        confidence: 65,
        startIndex: data.length - 2,
        endIndex: data.length - 1,
        description: 'Bullish reversal candle pattern',
      };
    }

    // Bearish engulfing
    if (prev.close > prev.open && // Previous bullish
        curr.close < curr.open && // Current bearish
        curr.open > prev.close && // Opens above previous close
        curr.close < prev.open) { // Closes below previous open
      return {
        pattern: 'Bearish Engulfing',
        type: 'bearish',
        confidence: 65,
        startIndex: data.length - 2,
        endIndex: data.length - 1,
        description: 'Bearish reversal candle pattern',
      };
    }

    return null;
  }

  calculateFibonacciLevels(data: OHLCV[]): FibonacciLevel[] {
    if (data.length < 10) return [];

    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    
    const swingHigh = Math.max(...highs);
    const swingLow = Math.min(...lows);
    const range = swingHigh - swingLow;

    const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const fibLabels = ['0%', '23.6%', '38.2%', '50%', '61.8%', '78.6%', '100%'];

    // Determine if we're in uptrend or downtrend
    const isUptrend = data[data.length - 1].close > data[0].close;

    return fibLevels.map((level, i) => ({
      level,
      price: isUptrend 
        ? swingHigh - (range * level)
        : swingLow + (range * level),
      label: fibLabels[i],
    }));
  }

  detectElliottWave(data: OHLCV[]): ElliottWave | null {
    if (data.length < 30) return null;

    const closes = data.map(d => d.close);
    const peaks = this.findPeaks(closes, 5);
    const troughs = this.findTroughs(closes, 5);

    if (peaks.length < 3 || troughs.length < 2) return null;

    // Simplified Elliott Wave detection
    // Looking for 5-wave impulse pattern or 3-wave corrective

    const lastClose = closes[closes.length - 1];
    const firstClose = closes[0];
    const isUptrend = lastClose > firstClose;

    // Count significant swings
    const allPivots = [...peaks, ...troughs].sort((a, b) => a - b);
    
    if (allPivots.length >= 5) {
      // Possible impulse wave
      const wave1End = closes[allPivots[0]];
      const wave2End = closes[allPivots[1]];
      const wave3End = closes[allPivots[2]];
      const wave4End = closes[allPivots[3]];
      const wave5End = closes[allPivots[4]];

      if (isUptrend) {
        // Check impulse wave rules (simplified)
        const wave1 = wave1End - firstClose;
        const wave3 = wave3End - wave2End;
        const wave5 = wave5End - wave4End;

        if (wave3 > wave1 && wave3 > wave5) {
          return {
            wave: 'Wave 5',
            type: 'impulse',
            direction: 'up',
            confidence: 65,
            description: 'Possible completion of 5-wave impulse. Watch for corrective ABC pattern.',
          };
        }
      }
    }

    // Check for corrective pattern
    if (allPivots.length === 3) {
      return {
        wave: 'ABC Correction',
        type: 'corrective',
        direction: isUptrend ? 'up' : 'down',
        confidence: 60,
        description: 'Possible ABC corrective wave in progress.',
      };
    }

    return null;
  }

  private findPeaks(data: number[], minDistance: number = 3): number[] {
    const peaks: number[] = [];
    for (let i = minDistance; i < data.length - minDistance; i++) {
      let isPeak = true;
      for (let j = 1; j <= minDistance; j++) {
        if (data[i] <= data[i - j] || data[i] <= data[i + j]) {
          isPeak = false;
          break;
        }
      }
      if (isPeak) peaks.push(i);
    }
    return peaks;
  }

  private findTroughs(data: number[], minDistance: number = 3): number[] {
    const troughs: number[] = [];
    for (let i = minDistance; i < data.length - minDistance; i++) {
      let isTrough = true;
      for (let j = 1; j <= minDistance; j++) {
        if (data[i] >= data[i - j] || data[i] >= data[i + j]) {
          isTrough = false;
          break;
        }
      }
      if (isTrough) troughs.push(i);
    }
    return troughs;
  }

  private calculateSlope(data: number[]): number {
    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += data[i];
      sumXY += i * data[i];
      sumX2 += i * i;
    }
    
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }
}

export const patternRecognitionService = new PatternRecognitionService();
