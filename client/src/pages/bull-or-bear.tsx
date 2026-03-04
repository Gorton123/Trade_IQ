import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  TrendingUp,
  TrendingDown,
  Flame,
  Trophy,
  Brain,
  Target,
  Zap,
  CheckCircle2,
  XCircle,
  ArrowRight,
  BarChart3,
  CandlestickChart,
  Lightbulb,
  Star,
  Crown,
  Medal,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface QuizQuestion {
  id: string;
  question: string;
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  options?: string[];
  correctAnswer: number;
  explanation: string;
  isBullBear?: boolean;
}

interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CandleChallenge {
  id: string;
  candles: CandleData[];
  nextDirection: "bullish" | "bearish";
  patternName: string;
  explanation: string;
}

interface TradeScenario {
  id: string;
  instrument: string;
  direction: "buy" | "sell";
  entryPrice: number;
  currentPrice: number;
  context: string;
  question: string;
  questionType: "tp" | "sl" | "decision";
  correctValue: number;
  tolerance: number;
  explanation: string;
  options?: string[];
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "q1",
    question: "A long green candle with small wicks indicates strong buying pressure.",
    category: "Candlesticks",
    difficulty: "beginner",
    correctAnswer: 0,
    explanation: "A long green (bullish) candle with small wicks shows buyers dominated the session with little resistance from sellers. This indicates strong bullish momentum.",
    isBullBear: true,
  },
  {
    id: "q2",
    question: "You should always trade against the trend for bigger profits.",
    category: "Strategy",
    difficulty: "beginner",
    correctAnswer: 1,
    explanation: "Trading against the trend (counter-trend) is risky and leads to more losses. Our strategy is trend-following — we trade WITH the trend because the probability of success is much higher. 'The trend is your friend.'",
    isBullBear: true,
  },
  {
    id: "q3",
    question: "Risking 1% of your account per trade is a safe risk management approach.",
    category: "Risk Management",
    difficulty: "beginner",
    correctAnswer: 0,
    explanation: "The 1% rule means even 10 consecutive losses only costs 10% of your account. This preserves capital and gives you many chances to recover. Our platform defaults to 1% risk per trade.",
    isBullBear: true,
  },
  {
    id: "q4",
    question: "What does a 'doji' candle indicate?",
    category: "Candlesticks",
    difficulty: "beginner",
    options: ["Strong trend continuation", "Market indecision", "Guaranteed reversal", "High volume"],
    correctAnswer: 1,
    explanation: "A doji has nearly equal open and close prices, creating a cross shape. It shows neither buyers nor sellers won the session — the market is undecided. It can signal a potential reversal when found at key levels.",
  },
  {
    id: "q5",
    question: "What is the purpose of a stop loss?",
    category: "Risk Management",
    difficulty: "beginner",
    options: ["To lock in profits", "To limit potential losses", "To increase position size", "To identify trends"],
    correctAnswer: 1,
    explanation: "A stop loss automatically closes your trade at a predetermined price to limit how much you can lose. It's your safety net — never trade without one. Our system places SL on every trade automatically.",
  },
  {
    id: "q6",
    question: "Moving your stop loss to break-even locks in a risk-free trade.",
    category: "Strategy",
    difficulty: "intermediate",
    correctAnswer: 0,
    explanation: "Once price moves enough in your favour, moving the SL to your entry price means the worst outcome is breaking even (zero loss). Our system does this automatically when the trade reaches a certain profit threshold.",
    isBullBear: true,
  },
  {
    id: "q7",
    question: "Higher timeframes generally produce more reliable signals than lower timeframes.",
    category: "Technical Analysis",
    difficulty: "intermediate",
    correctAnswer: 0,
    explanation: "Higher timeframes (1h, 4h) filter out market noise and show clearer trends. A signal on the 4h chart carries more weight than one on the 1m chart because it represents more price action and larger market participation.",
    isBullBear: true,
  },
  {
    id: "q8",
    question: "You should increase your lot size after a losing streak to recover faster.",
    category: "Risk Management",
    difficulty: "intermediate",
    correctAnswer: 1,
    explanation: "Increasing size after losses (revenge trading or Martingale) is one of the fastest ways to blow an account. Stick to consistent position sizing. Our system calculates lot size based on your current balance and risk percentage — it naturally scales down after losses to protect you.",
    isBullBear: true,
  },
  {
    id: "q9",
    question: "What is 'confluence' in trading?",
    category: "Technical Analysis",
    difficulty: "intermediate",
    options: ["A type of chart pattern", "Multiple indicators agreeing on a trade", "A risk management technique", "A broker fee"],
    correctAnswer: 1,
    explanation: "Confluence means multiple independent signals point the same way — for example, price at support + RSI oversold + bullish candle pattern. More confluence = higher probability trade. Our signal scanner requires minimum confluence before generating a signal.",
  },
  {
    id: "q10",
    question: "What does ATR (Average True Range) measure?",
    category: "Technical Analysis",
    difficulty: "intermediate",
    options: ["Trend direction", "Market volatility", "Trading volume", "Price momentum"],
    correctAnswer: 1,
    explanation: "ATR measures how much an instrument typically moves in a given period. We use it to set appropriate stop losses — a volatile market needs wider stops, while a calm market can use tighter stops. This ensures your SL isn't too tight (getting stopped out by noise) or too wide (risking too much).",
  },
  {
    id: "q11",
    question: "A hammer candle at the bottom of a downtrend is typically bullish.",
    category: "Candlesticks",
    difficulty: "intermediate",
    correctAnswer: 0,
    explanation: "A hammer has a small body with a long lower wick, showing that sellers pushed price down but buyers fought back and closed near the open. At the bottom of a downtrend, this suggests buyers are stepping in and a reversal may be coming.",
    isBullBear: true,
  },
  {
    id: "q12",
    question: "What is a 'trailing stop'?",
    category: "Risk Management",
    difficulty: "intermediate",
    options: ["A stop that gets wider over time", "A stop that follows price to lock in profits", "A stop at the day's low", "A mental stop loss"],
    correctAnswer: 1,
    explanation: "A trailing stop moves in the direction of your trade as price moves in your favour, locking in more profit the further price goes. Our system uses ATR-based trailing stops to protect profits while giving trades room to run.",
  },
  {
    id: "q13",
    question: "What is the ideal risk-to-reward ratio for our trading system?",
    category: "Strategy",
    difficulty: "intermediate",
    options: ["1:0.5 (risk more than you can gain)", "1:1 (risk equals reward)", "1:1.5 or better (risk less than you can gain)", "Doesn't matter"],
    correctAnswer: 2,
    explanation: "We target at least 1:1.5 risk-to-reward, meaning for every £1 risked, we aim to make at least £1.50. Combined with a 70%+ win rate, this creates strong positive expectancy over many trades.",
  },
  {
    id: "q14",
    question: "Trading during major news events is recommended for best results.",
    category: "Strategy",
    difficulty: "advanced",
    correctAnswer: 1,
    explanation: "Major news events (NFP, interest rate decisions) cause extreme volatility and unpredictable spikes. Our system has news blackout periods that pause trading around these events to avoid being whipsawed by sudden price moves.",
    isBullBear: true,
  },
  {
    id: "q15",
    question: "What is 'walk-forward analysis' in strategy testing?",
    category: "Strategy",
    difficulty: "advanced",
    options: ["Testing on future data", "Training on past data then validating on unseen data", "Walking through trades manually", "Forward-testing on a demo"],
    correctAnswer: 1,
    explanation: "Walk-forward analysis splits data: train the strategy on 70% of history, then test on the remaining 30% it's never seen. If it works on both, the strategy is robust and not over-fitted. Our auto-optimizer uses this to validate every strategy before approving it for live trading.",
  },
  {
    id: "q16",
    question: "A bearish engulfing pattern after an uptrend suggests potential reversal.",
    category: "Candlesticks",
    difficulty: "intermediate",
    correctAnswer: 0,
    explanation: "A bearish engulfing is a large red candle that completely engulfs the previous green candle. After an uptrend, this shows sellers have overwhelmed buyers and a reversal may be starting.",
    isBullBear: true,
  },
  {
    id: "q17",
    question: "What does 'drawdown' mean?",
    category: "Risk Management",
    difficulty: "beginner",
    options: ["A chart pattern", "The decline from peak account value", "A type of order", "Withdrawing funds"],
    correctAnswer: 1,
    explanation: "Drawdown is the percentage drop from your account's highest point to its lowest. A 10% drawdown from a £1,000 peak means your account dropped to £900. Our daily loss limit (5% by default) prevents excessive drawdown in a single day.",
  },
  {
    id: "q18",
    question: "Support and resistance levels are prices where buying or selling pressure is concentrated.",
    category: "Technical Analysis",
    difficulty: "beginner",
    correctAnswer: 0,
    explanation: "Support is a price level where buyers tend to step in (floor), resistance is where sellers tend to appear (ceiling). These levels are key for placing SL and TP targets. Our analysis detects these automatically.",
    isBullBear: true,
  },
  {
    id: "q19",
    question: "What is position sizing?",
    category: "Risk Management",
    difficulty: "beginner",
    options: ["How long you hold a trade", "How much capital you put in each trade", "Where you place your stop loss", "The spread on a trade"],
    correctAnswer: 1,
    explanation: "Position sizing determines how many lots/units you trade based on your account size and risk tolerance. If you risk 1% on a £500 account, that's £5 at stake. Our system calculates the optimal lot size automatically for every trade.",
  },
  {
    id: "q20",
    question: "Spreads on Gold (XAUUSD) are typically tighter than major forex pairs.",
    category: "Market Knowledge",
    difficulty: "intermediate",
    correctAnswer: 1,
    explanation: "Gold typically has wider spreads than major pairs like EUR/USD. This means gold trades cost more to enter. Our system accounts for spread when calculating trade viability — if the spread is too wide relative to the target, it skips the trade.",
    isBullBear: true,
  },
  {
    id: "q21",
    question: "What is the London session known for?",
    category: "Market Knowledge",
    difficulty: "intermediate",
    options: ["Lowest volatility of the day", "Highest trading volume and volatility", "Only gold trading", "Markets are closed"],
    correctAnswer: 1,
    explanation: "The London session (8am-5pm GMT) overlaps with both Asian close and New York open, creating the highest volume and best trading opportunities. Our system factors in trading sessions when generating signals.",
  },
  {
    id: "q22",
    question: "A 70% win rate means you'll never have losing streaks.",
    category: "Risk Management",
    difficulty: "advanced",
    correctAnswer: 1,
    explanation: "Even with a 70% win rate, you can still have 5-6 losses in a row — it's statistically normal. That's why proper risk management (1% per trade, daily loss limits) is essential. The edge plays out over many trades, not individual ones.",
    isBullBear: true,
  },
  {
    id: "q23",
    question: "What does 'pip' stand for in forex?",
    category: "Market Knowledge",
    difficulty: "beginner",
    options: ["Price in Points", "Percentage in Point", "Profit in Pence", "Position in Price"],
    correctAnswer: 1,
    explanation: "A pip (Percentage in Point) is the smallest standard price movement. For most forex pairs it's 0.0001 (4th decimal). For gold, 1 pip = $0.10. Understanding pips is crucial for measuring profit/loss and setting SL/TP levels.",
  },
  {
    id: "q24",
    question: "Divergence between price and RSI always guarantees a reversal.",
    category: "Technical Analysis",
    difficulty: "advanced",
    correctAnswer: 1,
    explanation: "Divergence (price making new highs while RSI makes lower highs) suggests weakening momentum, but it's not a guarantee. Price can continue trending despite divergence. That's why our system uses divergence as ONE signal among many — never as a standalone trigger.",
    isBullBear: true,
  },
  {
    id: "q25",
    question: "What is the Trade Guardian?",
    category: "Platform",
    difficulty: "beginner",
    options: ["A chart pattern indicator", "A safety system that auto-closes risky trades", "A type of market order", "A premium feature"],
    correctAnswer: 1,
    explanation: "The Trade Guardian is our background safety system. It monitors all open trades and auto-closes positions that exceed maximum duration, enforces daily loss limits, and can emergency-close all trades if needed. It runs every 60 seconds to protect your account.",
  },
  {
    id: "q26",
    question: "An inverted hammer at a support level can signal a bullish reversal.",
    category: "Candlesticks",
    difficulty: "advanced",
    correctAnswer: 0,
    explanation: "An inverted hammer has a small body with a long upper wick. At support, it shows buyers attempted to push price up. While they didn't hold all gains, the attempt itself (combined with support) suggests a reversal is possible, especially if confirmed by the next candle.",
    isBullBear: true,
  },
  {
    id: "q27",
    question: "What does 'auto-execute' mean in our platform?",
    category: "Platform",
    difficulty: "beginner",
    options: ["Manually placing trades", "The system places trades on your OANDA account automatically", "Backtesting a strategy", "Simulating trades"],
    correctAnswer: 1,
    explanation: "When auto-execute is enabled and your OANDA account is connected, our system will automatically place trades on your real broker account when it detects high-probability signals. The lot size, SL, and TP are all calculated and set automatically.",
  },
  {
    id: "q28",
    question: "Three consecutive doji candles at resistance suggest the trend will continue up.",
    category: "Candlesticks",
    difficulty: "advanced",
    correctAnswer: 1,
    explanation: "Multiple dojis at resistance show extreme indecision right at a level where sellers typically appear. This often precedes a reversal downward, not continuation. The market is struggling to push through resistance.",
    isBullBear: true,
  },
  {
    id: "q29",
    question: "What is 'lot size' in forex trading?",
    category: "Market Knowledge",
    difficulty: "beginner",
    options: ["The number of trades per day", "The unit of measurement for trade volume", "The distance between entry and exit", "The commission charged"],
    correctAnswer: 1,
    explanation: "A lot is the standard unit for trade size. A standard lot = 100,000 units of currency, mini = 10,000, micro = 1,000. Our system calculates the right lot size for your account to keep risk at your chosen percentage.",
  },
  {
    id: "q30",
    question: "Running more open trades at once always means more profit.",
    category: "Risk Management",
    difficulty: "intermediate",
    correctAnswer: 1,
    explanation: "More open trades means more exposure and more risk. If the market moves against you, multiple correlated trades can all lose simultaneously. Our system limits max open positions (default 3) to prevent over-exposure. Quality over quantity.",
    isBullBear: true,
  },
];

const CANDLE_CHALLENGES: CandleChallenge[] = [
  {
    id: "c1",
    candles: [
      { open: 100, high: 103, low: 99, close: 102 },
      { open: 102, high: 105, low: 101, close: 104 },
      { open: 104, high: 108, low: 103, close: 107 },
      { open: 107, high: 109, low: 106, close: 108 },
      { open: 108, high: 109, low: 104, close: 105 },
    ],
    nextDirection: "bearish",
    patternName: "Shooting Star / Reversal",
    explanation: "After a strong uptrend, the last candle shows a long upper wick and closes near its low — a shooting star pattern. This suggests buyers tried to push higher but sellers took control. The next candle is likely bearish as selling pressure continues.",
  },
  {
    id: "c2",
    candles: [
      { open: 110, high: 111, low: 106, close: 107 },
      { open: 107, high: 108, low: 103, close: 104 },
      { open: 104, high: 105, low: 100, close: 101 },
      { open: 101, high: 102, low: 98, close: 99 },
      { open: 99, high: 103, low: 98, close: 102 },
    ],
    nextDirection: "bullish",
    patternName: "Hammer at Bottom",
    explanation: "After a clear downtrend, the last candle shows a long lower wick with close near the high — a hammer pattern. Sellers pushed price down but buyers aggressively stepped in. This classic reversal signal suggests bullish momentum is building.",
  },
  {
    id: "c3",
    candles: [
      { open: 100, high: 102, low: 99, close: 101 },
      { open: 101, high: 104, low: 100, close: 103 },
      { open: 103, high: 106, low: 102, close: 105 },
      { open: 105, high: 107, low: 104, close: 106 },
      { open: 106, high: 109, low: 105, close: 108 },
    ],
    nextDirection: "bullish",
    patternName: "Strong Uptrend Continuation",
    explanation: "Five consecutive bullish candles with higher highs and higher lows — a clear uptrend with momentum. Each candle closes above the previous, showing consistent buying pressure. Trend continuation is more likely than reversal.",
  },
  {
    id: "c4",
    candles: [
      { open: 100, high: 103, low: 99, close: 102 },
      { open: 102, high: 104, low: 101, close: 103 },
      { open: 103, high: 104, low: 101, close: 102 },
      { open: 102, high: 104, low: 101, close: 101.5 },
      { open: 101.5, high: 103, low: 100, close: 100.5 },
    ],
    nextDirection: "bearish",
    patternName: "Rising Wedge Breakdown",
    explanation: "Price made an initial move up but then started making equal highs while lows crept higher — a rising wedge pattern. The last candle broke down with a bearish close, suggesting the upside momentum has exhausted. Expect further downside.",
  },
  {
    id: "c5",
    candles: [
      { open: 105, high: 106, low: 101, close: 102 },
      { open: 102, high: 103, low: 99, close: 100 },
      { open: 100, high: 101, low: 97, close: 98 },
      { open: 98, high: 99, low: 97, close: 97.5 },
      { open: 97.5, high: 101, low: 97, close: 100 },
    ],
    nextDirection: "bullish",
    patternName: "Bullish Engulfing",
    explanation: "After a downtrend, the last candle opens near the low but closes significantly higher, engulfing the previous candle's body. This bullish engulfing pattern shows buyers overwhelming sellers — a strong reversal signal, especially near support.",
  },
  {
    id: "c6",
    candles: [
      { open: 100, high: 104, low: 99, close: 103 },
      { open: 103, high: 106, low: 102, close: 105 },
      { open: 105, high: 108, low: 104, close: 107 },
      { open: 107, high: 108, low: 106, close: 107.5 },
      { open: 107.5, high: 108, low: 103, close: 104 },
    ],
    nextDirection: "bearish",
    patternName: "Bearish Engulfing at Top",
    explanation: "After a strong uptrend, a doji (indecision) is followed by a large bearish candle that engulfs it. This is a powerful reversal pattern — the bulls ran out of steam at the top, and sellers took over aggressively.",
  },
  {
    id: "c7",
    candles: [
      { open: 100, high: 102, low: 99, close: 101 },
      { open: 101, high: 103, low: 100, close: 102 },
      { open: 102, high: 103, low: 100, close: 101 },
      { open: 101, high: 103, low: 100, close: 102 },
      { open: 102, high: 104, low: 101, close: 103 },
    ],
    nextDirection: "bullish",
    patternName: "Range Breakout",
    explanation: "Price consolidated in a tight range (100-103) for several candles, then the last candle closed at the top of the range with a bullish body. This suggests accumulation — buyers were building positions and are now pushing for a breakout above resistance.",
  },
  {
    id: "c8",
    candles: [
      { open: 108, high: 109, low: 105, close: 106 },
      { open: 106, high: 107, low: 103, close: 104 },
      { open: 104, high: 106, low: 103, close: 105 },
      { open: 105, high: 106, low: 102, close: 103 },
      { open: 103, high: 104, low: 100, close: 101 },
    ],
    nextDirection: "bearish",
    patternName: "Lower Highs Downtrend",
    explanation: "Each candle is making lower highs and lower lows — the definition of a downtrend. The brief pullback (3rd candle) was sold into, confirming sellers are in control. The trend is likely to continue lower. This is exactly the kind of pattern our trend-following system looks for.",
  },
];

const TRADE_SCENARIOS: TradeScenario[] = [
  {
    id: "t1",
    instrument: "XAUUSD",
    direction: "buy",
    entryPrice: 2650.00,
    currentPrice: 2650.00,
    context: "Gold is in a clear uptrend on the 1h chart. Price just bounced off the 20 EMA with a bullish hammer candle. ATR is 15 points. Support is at 2635.",
    question: "Where would you place the stop loss?",
    questionType: "sl",
    correctValue: 2635,
    tolerance: 5,
    explanation: "The ideal SL is at or just below the nearest support at 2635, giving about 15 points of room (1x ATR). Placing it too tight risks getting stopped by normal noise. Too wide wastes risk budget. Our system uses ATR-based stops for optimal placement.",
  },
  {
    id: "t2",
    instrument: "EURUSD",
    direction: "sell",
    entryPrice: 1.0850,
    currentPrice: 1.0850,
    context: "EUR/USD has broken below a key support level at 1.0860. The trend is bearish on both 15m and 1h timeframes. Next support is at 1.0800.",
    question: "Where would you set the take profit?",
    questionType: "tp",
    correctValue: 1.0800,
    tolerance: 0.0010,
    explanation: "The next support at 1.0800 is the natural target — it's where buyers are likely to step in. This gives a 50-pip target against roughly a 30-pip SL (above broken support), creating a favourable 1:1.6 risk-to-reward ratio.",
  },
  {
    id: "t3",
    instrument: "GBPUSD",
    direction: "buy",
    entryPrice: 1.2700,
    currentPrice: 1.2700,
    context: "GBP/USD is ranging between 1.2680 and 1.2720. No clear trend on any timeframe. RSI is at 50 (neutral). There's a high-impact news event in 30 minutes.",
    question: "Should you take this trade?",
    questionType: "decision",
    correctValue: 1,
    tolerance: 0,
    options: ["Yes, enter the trade", "No, skip this trade"],
    explanation: "Skip! Two red flags: the market is ranging (no clear trend), and there's high-impact news in 30 minutes. Our system would flag this as 'no trade' — we only trade clear trends and pause during news events. Patience is a skill.",
  },
  {
    id: "t4",
    instrument: "XAUUSD",
    direction: "buy",
    entryPrice: 2680.00,
    currentPrice: 2695.00,
    context: "You entered a gold buy at 2680 with SL at 2665. Price has moved to 2695 (+15 points in your favour). The trend is still bullish. Your break-even level would be at entry (2680).",
    question: "Should you move your stop to break-even now?",
    questionType: "decision",
    correctValue: 0,
    tolerance: 0,
    options: ["Yes, move to break-even", "No, let it run"],
    explanation: "Yes! Price is +15 points (1x ATR) in your favour — the ideal time to move SL to break-even. This eliminates risk while keeping upside potential open. Our system does this automatically when trades reach the break-even threshold.",
  },
  {
    id: "t5",
    instrument: "XAGUSD",
    direction: "sell",
    entryPrice: 31.50,
    currentPrice: 31.50,
    context: "Silver is at 31.50. There's strong resistance at 31.80 and support at 31.00. The 4h trend is bearish with lower highs. The RSI shows bearish divergence.",
    question: "Where would you place the stop loss?",
    questionType: "sl",
    correctValue: 31.80,
    tolerance: 0.10,
    explanation: "SL should go above resistance at 31.80. If price breaks above resistance, your bearish thesis is invalidated. Placing SL at logical invalidation points (like above resistance for shorts) is a key principle — it means the market has to prove you wrong before you're stopped out.",
  },
  {
    id: "t6",
    instrument: "AUDUSD",
    direction: "buy",
    entryPrice: 0.6520,
    currentPrice: 0.6520,
    context: "AUD/USD 15m chart shows a bullish trend. Price pulled back to the 50 EMA and formed a bullish engulfing. However, your account already has 3 open trades (your maximum).",
    question: "Should you take this trade?",
    questionType: "decision",
    correctValue: 1,
    tolerance: 0,
    options: ["Yes, this is a good setup", "No, skip it — too many open trades"],
    explanation: "Skip! Even though the setup looks good, you've reached your max open positions (3). Taking more trades increases risk exposure. Discipline means passing on good setups when you're already at capacity. Wait for an existing trade to close first.",
  },
];

const LEVELS = [
  { name: "Rookie Trader", minScore: 0, color: "text-zinc-400" },
  { name: "Market Student", minScore: 50, color: "text-blue-400" },
  { name: "Chart Reader", minScore: 150, color: "text-green-400" },
  { name: "Signal Spotter", minScore: 300, color: "text-yellow-400" },
  { name: "Risk Manager", minScore: 500, color: "text-orange-400" },
  { name: "Trend Master", minScore: 800, color: "text-purple-400" },
  { name: "Market Pro", minScore: 1200, color: "text-red-400" },
  { name: "Trading Legend", minScore: 2000, color: "text-amber-400" },
];

function getLevel(score: number) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (score >= LEVELS[i].minScore) return LEVELS[i];
  }
  return LEVELS[0];
}

function getNextLevel(score: number) {
  for (const level of LEVELS) {
    if (score < level.minScore) return level;
  }
  return null;
}

function MiniCandleChart({ candles, showNext, nextDirection }: { candles: CandleData[]; showNext?: boolean; nextDirection?: string }) {
  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const min = Math.min(...allPrices) - 1;
  const max = Math.max(...allPrices) + 1;
  const range = max - min;
  const width = 280;
  const height = 160;
  const candleWidth = 28;
  const gap = (width - candleWidth * (candles.length + (showNext ? 1 : 0))) / (candles.length + (showNext ? 1 : 0) + 1);

  const priceToY = (price: number) => height - ((price - min) / range) * height;

  return (
    <div className="flex justify-center my-4">
      <svg width={width} height={height + 20} className="bg-muted/30 rounded-lg">
        {candles.map((candle, i) => {
          const x = gap + i * (candleWidth + gap);
          const isBullish = candle.close > candle.open;
          const bodyTop = priceToY(Math.max(candle.open, candle.close));
          const bodyBottom = priceToY(Math.min(candle.open, candle.close));
          const bodyHeight = Math.max(2, bodyBottom - bodyTop);

          return (
            <g key={i}>
              <line
                x1={x + candleWidth / 2} y1={priceToY(candle.high)}
                x2={x + candleWidth / 2} y2={priceToY(candle.low)}
                stroke={isBullish ? "#22c55e" : "#ef4444"} strokeWidth={1.5}
              />
              <rect
                x={x} y={bodyTop} width={candleWidth} height={bodyHeight}
                fill={isBullish ? "#22c55e" : "#ef4444"} rx={2}
                opacity={0.9}
              />
            </g>
          );
        })}
        {showNext && (
          <g>
            <rect
              x={gap + candles.length * (candleWidth + gap)}
              y={10} width={candleWidth} height={height}
              fill="currentColor" opacity={0.05} rx={4}
              stroke="currentColor" strokeWidth={1} strokeDasharray="4,4" strokeOpacity={0.3}
            />
            <text
              x={gap + candles.length * (candleWidth + gap) + candleWidth / 2}
              y={height / 2 + 4}
              textAnchor="middle" fontSize="22" fill="currentColor" opacity={0.3}
            >
              ?
            </text>
          </g>
        )}
        {showNext && nextDirection && (
          (() => {
            const lastCandle = candles[candles.length - 1];
            const x = gap + candles.length * (candleWidth + gap);
            const isBullish = nextDirection === "bullish";
            const open = lastCandle.close;
            const close = isBullish ? open + range * 0.15 : open - range * 0.15;
            const high = isBullish ? close + range * 0.05 : open + range * 0.05;
            const low = isBullish ? open - range * 0.05 : close - range * 0.05;
            const bodyTop = priceToY(Math.max(open, close));
            const bodyBottom = priceToY(Math.min(open, close));
            return (
              <g>
                <line
                  x1={x + candleWidth / 2} y1={priceToY(high)}
                  x2={x + candleWidth / 2} y2={priceToY(low)}
                  stroke={isBullish ? "#22c55e" : "#ef4444"} strokeWidth={1.5}
                />
                <rect
                  x={x} y={bodyTop} width={candleWidth}
                  height={Math.max(2, bodyBottom - bodyTop)}
                  fill={isBullish ? "#22c55e" : "#ef4444"} rx={2} opacity={0.9}
                />
              </g>
            );
          })()
        )}
      </svg>
    </div>
  );
}

export default function BullOrBearPage() {
  const [activeTab, setActiveTab] = useState("quiz");
  const [totalScore, setTotalScore] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  const { data: savedProgress } = useQuery<{ totalScore: number; bestStreak: number; quizAnswered: number; candleAnswered: number; tradeAnswered: number }>({
    queryKey: ["/api/quiz/progress"],
  });

  useEffect(() => {
    if (savedProgress) {
      setTotalScore(savedProgress.totalScore);
      setBestStreak(savedProgress.bestStreak);
    }
  }, [savedProgress]);

  const saveProgress = useMutation({
    mutationFn: async (data: { scoreToAdd: number; streak: number; mode: string }) => {
      return apiRequest("POST", "/api/quiz/progress", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quiz/progress"] });
    },
  });

  const handleScoreUpdate = useCallback((points: number, streak: number) => {
    setTotalScore(prev => prev + points);
    if (streak > bestStreak) setBestStreak(streak);
    saveProgress.mutate({ scoreToAdd: points, streak, mode: activeTab });
  }, [bestStreak, activeTab, saveProgress]);

  const level = getLevel(totalScore);
  const nextLevel = getNextLevel(totalScore);
  const progressToNext = nextLevel
    ? ((totalScore - level.minScore) / (nextLevel.minScore - level.minScore)) * 100
    : 100;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Brain className="h-6 w-6 text-primary" />
            Bull or Bear Academy
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Learn trading fundamentals while having fun</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="flex items-center gap-1.5">
              <Star className={`h-4 w-4 ${level.color}`} />
              <span className={`font-semibold text-sm ${level.color}`} data-testid="text-level">{level.name}</span>
            </div>
            <div className="text-xs text-muted-foreground" data-testid="text-total-score">{totalScore} pts</div>
          </div>
          <div className="flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-full">
            <Flame className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-medium" data-testid="text-best-streak">{bestStreak}</span>
          </div>
        </div>
      </div>

      {nextLevel && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{level.name}</span>
            <span>{nextLevel.name} ({nextLevel.minScore - totalScore} pts to go)</span>
          </div>
          <Progress value={progressToNext} className="h-2" />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="quiz" className="text-xs sm:text-sm" data-testid="tab-quiz">
            <Brain className="h-3.5 w-3.5 mr-1.5" />
            Quiz
          </TabsTrigger>
          <TabsTrigger value="candles" className="text-xs sm:text-sm" data-testid="tab-candles">
            <CandlestickChart className="h-3.5 w-3.5 mr-1.5" />
            Candles
          </TabsTrigger>
          <TabsTrigger value="simulator" className="text-xs sm:text-sm" data-testid="tab-simulator">
            <Target className="h-3.5 w-3.5 mr-1.5" />
            Trade Sim
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="text-xs sm:text-sm" data-testid="tab-leaderboard">
            <Trophy className="h-3.5 w-3.5 mr-1.5" />
            Rankings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="quiz">
          <QuizMode onScore={handleScoreUpdate} />
        </TabsContent>
        <TabsContent value="candles">
          <CandleGuesserMode onScore={handleScoreUpdate} />
        </TabsContent>
        <TabsContent value="simulator">
          <TradeSimulatorMode onScore={handleScoreUpdate} />
        </TabsContent>
        <TabsContent value="leaderboard">
          <LeaderboardMode />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QuizMode({ onScore }: { onScore: (points: number, streak: number) => void }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [streak, setStreak] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [roundScore, setRoundScore] = useState(0);
  const [questionsAnswered, setQuestionsAnswered] = useState(0);
  const [difficulty, setDifficulty] = useState<"all" | "beginner" | "intermediate" | "advanced">("all");

  const filteredQuestions = useMemo(() => {
    const filtered = difficulty === "all" ? QUIZ_QUESTIONS : QUIZ_QUESTIONS.filter(q => q.difficulty === difficulty);
    return [...filtered].sort(() => Math.random() - 0.5);
  }, [difficulty]);

  const question = filteredQuestions[currentIndex % filteredQuestions.length];
  const isCorrect = selectedAnswer === question.correctAnswer;

  const handleAnswer = (answerIndex: number) => {
    if (answered) return;
    setAnswered(true);
    setSelectedAnswer(answerIndex);
    setQuestionsAnswered(prev => prev + 1);

    if (answerIndex === question.correctAnswer) {
      const streakBonus = Math.floor(streak / 3) * 5;
      const difficultyBonus = question.difficulty === "advanced" ? 20 : question.difficulty === "intermediate" ? 15 : 10;
      const points = difficultyBonus + streakBonus;
      setStreak(prev => prev + 1);
      setRoundScore(prev => prev + points);
      onScore(points, streak + 1);
    } else {
      setStreak(0);
    }
  };

  const nextQuestion = () => {
    setCurrentIndex(prev => prev + 1);
    setAnswered(false);
    setSelectedAnswer(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Badge variant="outline" data-testid="text-quiz-score">Score: {roundScore}</Badge>
          <Badge variant={streak > 0 ? "default" : "secondary"} data-testid="text-quiz-streak">
            <Flame className="h-3 w-3 mr-1" />{streak} streak
          </Badge>
        </div>
        <div className="flex gap-1.5">
          {(["all", "beginner", "intermediate", "advanced"] as const).map(d => (
            <Button
              key={d}
              size="sm"
              variant={difficulty === d ? "default" : "outline"}
              onClick={() => { setDifficulty(d); setCurrentIndex(0); setAnswered(false); setSelectedAnswer(null); }}
              className="text-xs capitalize"
              data-testid={`button-difficulty-${d}`}
            >
              {d}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <Badge variant="secondary" className="text-xs">{question.category}</Badge>
            <Badge variant="outline" className="text-xs capitalize">{question.difficulty}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-lg font-medium leading-relaxed" data-testid="text-question">{question.question}</p>

          {question.isBullBear ? (
            <div className="grid grid-cols-2 gap-3">
              <Button
                size="lg"
                variant={!answered ? "outline" : selectedAnswer === 0 ? (isCorrect ? "default" : "destructive") : question.correctAnswer === 0 ? "default" : "outline"}
                onClick={() => handleAnswer(0)}
                disabled={answered}
                className={`h-16 text-lg ${!answered ? "hover:bg-green-500/10 hover:border-green-500" : ""} ${answered && question.correctAnswer === 0 ? "bg-green-500/20 border-green-500" : ""}`}
                data-testid="button-bull"
              >
                <TrendingUp className={`h-5 w-5 mr-2 ${answered && question.correctAnswer === 0 ? "text-green-500" : ""}`} />
                Bull (True)
              </Button>
              <Button
                size="lg"
                variant={!answered ? "outline" : selectedAnswer === 1 ? (isCorrect ? "default" : "destructive") : question.correctAnswer === 1 ? "default" : "outline"}
                onClick={() => handleAnswer(1)}
                disabled={answered}
                className={`h-16 text-lg ${!answered ? "hover:bg-red-500/10 hover:border-red-500" : ""} ${answered && question.correctAnswer === 1 ? "bg-red-500/20 border-red-500" : ""}`}
                data-testid="button-bear"
              >
                <TrendingDown className={`h-5 w-5 mr-2 ${answered && question.correctAnswer === 1 ? "text-red-500" : ""}`} />
                Bear (False)
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {question.options?.map((option, i) => (
                <Button
                  key={i}
                  variant={!answered ? "outline" : selectedAnswer === i ? (isCorrect ? "default" : "destructive") : question.correctAnswer === i ? "default" : "outline"}
                  onClick={() => handleAnswer(i)}
                  disabled={answered}
                  className={`w-full justify-start text-left h-auto py-3 px-4 ${answered && question.correctAnswer === i ? "bg-green-500/20 border-green-500" : ""}`}
                  data-testid={`button-option-${i}`}
                >
                  <span className="font-medium mr-2">{String.fromCharCode(65 + i)}.</span>
                  {option}
                  {answered && question.correctAnswer === i && <CheckCircle2 className="h-4 w-4 ml-auto text-green-500" />}
                  {answered && selectedAnswer === i && !isCorrect && <XCircle className="h-4 w-4 ml-auto text-red-500" />}
                </Button>
              ))}
            </div>
          )}

          {answered && (
            <div className={`p-4 rounded-lg border ${isCorrect ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm mb-1">{isCorrect ? "Correct!" : "Not quite!"}</p>
                  <p className="text-sm text-muted-foreground" data-testid="text-explanation">{question.explanation}</p>
                </div>
              </div>
            </div>
          )}

          {answered && (
            <Button onClick={nextQuestion} className="w-full" data-testid="button-next-question">
              Next Question <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CandleGuesserMode({ onScore }: { onScore: (points: number, streak: number) => void }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [roundScore, setRoundScore] = useState(0);

  const shuffled = useMemo(() => [...CANDLE_CHALLENGES].sort(() => Math.random() - 0.5), []);
  const challenge = shuffled[currentIndex % shuffled.length];
  const isCorrect = selectedAnswer === challenge.nextDirection;

  const handleAnswer = (direction: "bullish" | "bearish") => {
    if (answered) return;
    setAnswered(true);
    setSelectedAnswer(direction);

    if (direction === challenge.nextDirection) {
      const points = 15 + Math.floor(streak / 3) * 5;
      setStreak(prev => prev + 1);
      setRoundScore(prev => prev + points);
      onScore(points, streak + 1);
    } else {
      setStreak(0);
    }
  };

  const nextChallenge = () => {
    setCurrentIndex(prev => prev + 1);
    setAnswered(false);
    setSelectedAnswer(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="outline" data-testid="text-candle-score">Score: {roundScore}</Badge>
        <Badge variant={streak > 0 ? "default" : "secondary"} data-testid="text-candle-streak">
          <Flame className="h-3 w-3 mr-1" />{streak} streak
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CandlestickChart className="h-4 w-4" />
            What direction will the next candle go?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MiniCandleChart
            candles={challenge.candles}
            showNext={!answered}
            nextDirection={answered ? challenge.nextDirection : undefined}
          />

          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              variant={!answered ? "outline" : selectedAnswer === "bullish" ? (isCorrect ? "default" : "destructive") : challenge.nextDirection === "bullish" ? "default" : "outline"}
              onClick={() => handleAnswer("bullish")}
              disabled={answered}
              className={`h-14 ${!answered ? "hover:bg-green-500/10 hover:border-green-500" : ""} ${answered && challenge.nextDirection === "bullish" ? "bg-green-500/20 border-green-500" : ""}`}
              data-testid="button-bullish"
            >
              <TrendingUp className="h-5 w-5 mr-2 text-green-500" />
              Bullish
            </Button>
            <Button
              size="lg"
              variant={!answered ? "outline" : selectedAnswer === "bearish" ? (isCorrect ? "default" : "destructive") : challenge.nextDirection === "bearish" ? "default" : "outline"}
              onClick={() => handleAnswer("bearish")}
              disabled={answered}
              className={`h-14 ${!answered ? "hover:bg-red-500/10 hover:border-red-500" : ""} ${answered && challenge.nextDirection === "bearish" ? "bg-red-500/20 border-red-500" : ""}`}
              data-testid="button-bearish"
            >
              <TrendingDown className="h-5 w-5 mr-2 text-red-500" />
              Bearish
            </Button>
          </div>

          {answered && (
            <div className={`p-4 rounded-lg border ${isCorrect ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm mb-1">
                    {isCorrect ? "Correct!" : "Not quite!"} — {challenge.patternName}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="text-candle-explanation">{challenge.explanation}</p>
                </div>
              </div>
            </div>
          )}

          {answered && (
            <Button onClick={nextChallenge} className="w-full" data-testid="button-next-candle">
              Next Pattern <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TradeSimulatorMode({ onScore }: { onScore: (points: number, streak: number) => void }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [userValue, setUserValue] = useState<number>(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [roundScore, setRoundScore] = useState(0);

  const shuffled = useMemo(() => [...TRADE_SCENARIOS].sort(() => Math.random() - 0.5), []);
  const scenario = shuffled[currentIndex % shuffled.length];

  useEffect(() => {
    if (scenario.questionType === "sl") {
      setUserValue(scenario.direction === "buy" ? scenario.entryPrice - (scenario.entryPrice * 0.005) : scenario.entryPrice + (scenario.entryPrice * 0.005));
    } else if (scenario.questionType === "tp") {
      setUserValue(scenario.direction === "buy" ? scenario.entryPrice + (scenario.entryPrice * 0.005) : scenario.entryPrice - (scenario.entryPrice * 0.005));
    }
    setSelectedOption(null);
    setAnswered(false);
  }, [currentIndex, scenario]);

  const getDecimals = (inst: string) => inst.includes("XAU") ? 2 : inst.includes("XAG") ? 2 : 4;
  const decimals = getDecimals(scenario.instrument);

  const handleSubmit = () => {
    if (answered) return;
    setAnswered(true);

    let correct = false;
    if (scenario.questionType === "decision") {
      correct = selectedOption === scenario.correctValue;
    } else {
      const diff = Math.abs(userValue - scenario.correctValue);
      correct = diff <= scenario.tolerance;
    }

    if (correct) {
      const points = 20 + Math.floor(streak / 3) * 5;
      setStreak(prev => prev + 1);
      setRoundScore(prev => prev + points);
      onScore(points, streak + 1);
    } else {
      setStreak(0);
    }
  };

  const isCorrect = scenario.questionType === "decision"
    ? selectedOption === scenario.correctValue
    : Math.abs(userValue - scenario.correctValue) <= scenario.tolerance;

  const nextScenario = () => {
    setCurrentIndex(prev => prev + 1);
    setAnswered(false);
    setSelectedOption(null);
  };

  const sliderMin = scenario.questionType === "sl"
    ? (scenario.direction === "buy" ? scenario.entryPrice * 0.99 : scenario.entryPrice)
    : scenario.questionType === "tp"
    ? (scenario.direction === "buy" ? scenario.entryPrice : scenario.entryPrice * 0.99)
    : 0;

  const sliderMax = scenario.questionType === "sl"
    ? (scenario.direction === "buy" ? scenario.entryPrice : scenario.entryPrice * 1.01)
    : scenario.questionType === "tp"
    ? (scenario.direction === "buy" ? scenario.entryPrice * 1.01 : scenario.entryPrice)
    : 0;

  const step = scenario.instrument.includes("XA") ? 0.5 : 0.0001;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="outline" data-testid="text-sim-score">Score: {roundScore}</Badge>
        <Badge variant={streak > 0 ? "default" : "secondary"} data-testid="text-sim-streak">
          <Flame className="h-3 w-3 mr-1" />{streak} streak
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              Trade Scenario
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={scenario.direction === "buy" ? "default" : "destructive"}>
                {scenario.direction === "buy" ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                {scenario.direction.toUpperCase()}
              </Badge>
              <Badge variant="outline">{scenario.instrument}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 p-4 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Market Context</span>
            </div>
            <p className="text-sm text-muted-foreground" data-testid="text-context">{scenario.context}</p>
            <div className="mt-3 flex items-center gap-4 text-sm">
              <span>Entry: <strong>{scenario.entryPrice.toFixed(decimals)}</strong></span>
              {scenario.currentPrice !== scenario.entryPrice && (
                <span>Current: <strong>{scenario.currentPrice.toFixed(decimals)}</strong></span>
              )}
            </div>
          </div>

          <p className="font-medium" data-testid="text-sim-question">{scenario.question}</p>

          {scenario.questionType === "decision" && scenario.options ? (
            <div className="space-y-2">
              {scenario.options.map((option, i) => (
                <Button
                  key={i}
                  variant={!answered ? (selectedOption === i ? "default" : "outline") : i === scenario.correctValue ? "default" : selectedOption === i ? "destructive" : "outline"}
                  onClick={() => !answered && setSelectedOption(i)}
                  className={`w-full justify-start text-left h-auto py-3 px-4 ${answered && i === scenario.correctValue ? "bg-green-500/20 border-green-500" : ""}`}
                  data-testid={`button-decision-${i}`}
                >
                  {option}
                  {answered && i === scenario.correctValue && <CheckCircle2 className="h-4 w-4 ml-auto text-green-500" />}
                  {answered && selectedOption === i && i !== scenario.correctValue && <XCircle className="h-4 w-4 ml-auto text-red-500" />}
                </Button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {scenario.questionType === "sl" ? "Stop Loss" : "Take Profit"}: 
                </span>
                <span className="font-mono font-bold text-lg" data-testid="text-slider-value">
                  {userValue.toFixed(decimals)}
                </span>
              </div>
              <Slider
                value={[userValue]}
                onValueChange={([v]) => !answered && setUserValue(v)}
                min={sliderMin}
                max={sliderMax}
                step={step}
                disabled={answered}
                data-testid="slider-value"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{sliderMin.toFixed(decimals)}</span>
                <span>{sliderMax.toFixed(decimals)}</span>
              </div>
            </div>
          )}

          {!answered && (
            <Button
              onClick={handleSubmit}
              className="w-full"
              disabled={scenario.questionType === "decision" && selectedOption === null}
              data-testid="button-submit-answer"
            >
              Submit Answer
            </Button>
          )}

          {answered && (
            <div className={`p-4 rounded-lg border ${isCorrect ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm mb-1">
                    {isCorrect ? "Great trade management!" : "Not quite right."}
                    {scenario.questionType !== "decision" && (
                      <span className="ml-2 text-muted-foreground">
                        Optimal: {scenario.correctValue.toFixed(decimals)}
                        {!isCorrect && ` (yours: ${userValue.toFixed(decimals)})`}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="text-sim-explanation">{scenario.explanation}</p>
                </div>
              </div>
            </div>
          )}

          {answered && (
            <Button onClick={nextScenario} className="w-full" data-testid="button-next-scenario">
              Next Scenario <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface LeaderboardEntry {
  displayName: string;
  profileImage: string | null;
  totalScore: number;
  bestStreak: number;
  totalAnswered: number;
  quizAnswered: number;
  candleAnswered: number;
  tradeAnswered: number;
  isCurrentUser: boolean;
}

function LeaderboardMode() {
  const { data: leaderboard, isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/quiz/leaderboard"],
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Loading rankings...
        </CardContent>
      </Card>
    );
  }

  if (!leaderboard || leaderboard.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <Trophy className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-muted-foreground">No rankings yet. Be the first to play!</p>
          <p className="text-xs text-muted-foreground">Answer quiz questions, guess candle patterns, or complete trade simulations to appear on the leaderboard.</p>
        </CardContent>
      </Card>
    );
  }

  const getRankIcon = (rank: number) => {
    if (rank === 0) return <Crown className="h-5 w-5 text-amber-400" />;
    if (rank === 1) return <Medal className="h-5 w-5 text-gray-300" />;
    if (rank === 2) return <Medal className="h-5 w-5 text-amber-700" />;
    return <span className="text-sm font-medium text-muted-foreground w-5 text-center">{rank + 1}</span>;
  };

  return (
    <div className="space-y-3" data-testid="quiz-leaderboard">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            Academy Rankings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          {leaderboard.map((entry, index) => {
            const level = getLevel(entry.totalScore);
            return (
              <div
                key={index}
                className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  entry.isCurrentUser
                    ? "bg-primary/10 border border-primary/20"
                    : index < 3
                    ? "bg-muted/50"
                    : ""
                }`}
                data-testid={`row-rank-${index}`}
              >
                <div className="shrink-0 w-6 flex justify-center">
                  {getRankIcon(index)}
                </div>

                {entry.profileImage ? (
                  <img
                    src={entry.profileImage}
                    alt=""
                    className="h-8 w-8 rounded-full shrink-0 object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-xs font-medium">{entry.displayName.charAt(0).toUpperCase()}</span>
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate" data-testid={`text-player-name-${index}`}>
                      {entry.displayName}
                      {entry.isCurrentUser && <span className="text-xs text-primary ml-1">(You)</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Star className={`h-3 w-3 ${level.color}`} />
                    <span className={level.color}>{level.name}</span>
                    <span>·</span>
                    <span>{entry.totalAnswered} answered</span>
                    {entry.bestStreak > 0 && (
                      <>
                        <span>·</span>
                        <Flame className="h-3 w-3 text-orange-500" />
                        <span>{entry.bestStreak}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-bold text-sm" data-testid={`text-player-score-${index}`}>{entry.totalScore}</div>
                  <div className="text-[10px] text-muted-foreground">pts</div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
