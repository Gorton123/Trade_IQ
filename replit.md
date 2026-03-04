# TradeIQ - AI Trading Intelligence Platform

## Overview

TradeIQ is an AI Trading Intelligence web application for Forex and Gold (XAUUSD) traders. Its primary purpose is to automate market analysis and signal generation to identify high-probability trading opportunities. The platform supports multiple instruments and timeframes, providing actionable trading signals from real-time and historical market data. Key capabilities include multi-user authentication, integration with OANDA for trade execution, and an advanced strategy optimization lab. The project aims to offer sophisticated analytical tools, comprehensive risk management, and continuous learning to improve trading performance and provide traders with a data-driven market edge.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework:** React 18 with TypeScript
- **State Management:** TanStack React Query for server state
- **Styling:** Tailwind CSS with CSS variables for theming
- **UI Components:** shadcn/ui built on Radix UI primitives

### Backend
- **Runtime:** Node.js with Express 5
- **Language:** TypeScript
- **API Pattern:** RESTful JSON API

### Data Layer
- **ORM:** Drizzle ORM with PostgreSQL
- **Schema:** `shared/schema.ts` for consistency
- **Validation:** Zod schemas
- **Caching:** In-memory for market data, analysis, and signals

### Market Data Integration
- **Primary Source:** OANDA REST API for real-time and historical data.
- **Fallback Source:** Twelve Data API.
- **Data:** Real-time quotes, OHLCV candle data.
- **Safety:** Signals are generated only from real market data.

### Signal Generation Strategy
- **Approach:** Trend-following only.
- **Filters:** Per-instrument optimized parameters for confluence, trend strength, stop-loss (SL) multipliers, and risk-reward (RR) ratios.
- **Confidence:** Minimum 55% confidence for signal generation. OANDA auto-execute: 60%+ for approved pairs, 80%+ for universal signals.
- **Learning:** Strategies require historical win rates of 50%+ and are validated via walk-forward analysis.
- **Timeframes:** Scans 1m, 5m, 15m, 1h, 4h, 1D, 1W, and 1M for full top-down analysis. Timeframe multipliers: 1m=0.4, 5m=0.6, 15m=0.8, 1h=1.0, 4h=1.5, 1D=2.5, 1W=4.0, 1M=6.0.
- **JPY Pair Handling:** JPY pairs use 100x scaled base SL distance (0.2 vs 0.002) and entry buffer (0.05 vs 0.0005) since JPY pip = 0.01 not 0.0001.
- **Lot Sizing:** `calculateLotSize` correctly handles JPY/CHF quote currencies (divides pip value by currentPrice), and EURGBP (no USD-to-GBP conversion when account is GBP).

### Multi-User Authentication
- **Provider:** Replit Auth (OIDC)
- **Session Management:** Express sessions stored in PostgreSQL.
- **User Isolation:** Separate OANDA credentials per user.

### OANDA Broker Integration
- **API Version:** OANDA REST v20 (Demo and Live).
- **Authentication:** Bearer token (API key).
- **Features:** Account management, market order execution, auto lot sizing, SL/TP attachment, trade viewing/closing, and auto-execute mode.
- **Max Risk Gate:** Per-user `maxAutoExecuteRiskPercent` setting.
- **Trade Sync:** Synchronizes live OANDA trades with the platform's simulation dashboard.
- **Minimum SL Distance:** `enforceMinimumSlDistance()` in `server/routes.ts` ensures SL is at least 5 pips from entry before sending to OANDA. Widens SL/TP proportionally to maintain R:R ratio. Applied at all 3 OANDA order call sites (auto-execute, simulated trade execute, manual button). After widening, lot size is recalculated with the wider SL to keep risk at the configured %.
- **Order Cancellation Detection:** Both `OandaService.placeMarketOrder` and stateless `oandaPlaceMarketOrder` check for `orderCancelTransaction` in OANDA response and return `success: false` with reason.
- **Trailing Stop OANDA Sync:** Manual OANDA button links `oandaTradeId` to matching simulated trade, enabling the staircase trailing stop system to push SL changes to OANDA. `modifyOandaTrailingStop` returns success/failure and logs OANDA rejections.

### OANDA Trade Guardian
- **Engine:** Background safety system, runs every 60 seconds.
- **Smart Expiry Handling:** Expired trades in profit are closed immediately to lock gains. Expired trades at a loss are left to recover or hit SL. A 2x safety cap force-closes trades that exceed double the max duration.
- **Timeframe-Aware Durations:** 1m=3h, 5m=4h, 15m=6h, 1h=12h, 4h=24h, 1D=72h, 1W=168h, 1M=720h.
- **Daily Loss Limit:** Pauses new trade placement when unrealized losses exceed configurable % of balance.
- **Emergency Kill Switch:** Endpoint to close ALL open OANDA trades immediately.
- **Configuration:** Persisted per-user in `user_settings` table.

### Automatic Strategy Optimizer
- **Engine:** `server/auto-optimizer.ts` for fully automatic parameter optimization.
- **Process:** Tests hundreds of parameter combinations per instrument and timeframe.
- **Signal Discovery:** Backtester identifies trend-direction signals, validating with walk-forward analysis.
- **Realistic Trade Simulation:** Backtester uses candle-by-candle trade management.
- **Validation:** Walk-forward validation (70% training / 30% validation) with minimum win rate and profit factor thresholds.
- **Scheduling:** Full optimization every 4 hours, with performance decay checks every 5 minutes.
- **Live Trade Management:** Applies dynamic management to live/simulated trades (e.g., Break-Even, Profit Locking Staircase, ATR Trailing, Smart Stagnation Exits).
- **Aggressive Profit Protection:** Break-even moves at 25% (1m/5m), 20% (15m/1h), 18% (4h) of target. 4-step profit staircase: 15% early lock at 40% target, 40% lock at 60%, 70% lock at 100%, then ATR trailing (1.0x for scalps, 1.2x for intraday, 1.5x for swing). All SL changes sync to OANDA via `modifyOandaTrailingStop`.

### Reality Check System
- **Engine:** `server/auto-optimizer.ts` — automatic performance management using real trade data.
- **Data Sources:** `signal_history` outcomes and `simulated_trades` P&L.
- **Rolling Window:** 14-day lookback.
- **Kill Rule:** Blocks underperforming instrument/timeframe combinations.
- **Kill Protection:** Combos with strong all-time trade performance (10+ trades, 60%+ WR or 500+ pips) are protected from kill — converted to rescue instead.
- **Rescue Rule:** Reactivates improved combinations.
- **Performance Guard:** Scanner checks Reality Check stats before generating signals.

### AI Strategy Intelligence
- **Engine:** `server/strategy-intelligence.ts` — AI-powered signal quality filter.
- **Update Frequency:** Every 15 minutes (regime classification + performance sync).
- **Market Regime Classification:** Classifies each instrument+timeframe as trending, ranging, or volatile.
- **Ranging Market Blocking:** ALL short-timeframe signals (1m, 5m, 15m) blocked in ranging markets — trend-following doesn't work sideways.
- **Recency-Weighted Win Rates:** Last 7 days of trades count 2x more than older data in 14-day window.
- **Dynamic Confidence Thresholds:** Combos with <45% weighted WR require 70%+ signal confidence; <35% WR blocks entirely.
- **Session-Based Blocking:** Instruments with <35% WR in current session (Asian/London/NY, min 5 trades) are blocked.
- **Exhaustion Cooldown:** After >2x ATR move, suppresses same-direction signals for 30 minutes.
- **Trending Boost:** Strong trending regimes with 60%+ WR get +5% confidence boost.

### JPY Pip Handling
- **PIP_VALUES Map:** USDJPY=0.01, EURJPY=0.01, GBPJPY=0.01 (vs 0.0001 for standard pairs, 0.1 for XAUUSD).
- **All Locations Fixed:** checkTradeOutcome, trailing stop, stagnation check, synthetic analysis, whale zone data — all use `PIP_VALUES[instrument] || 0.0001`.
- **Balance Correction:** `correctJpyPipInflation()` runs on startup, detects 100x inflated JPY trades, divides pips/money by 100, recalculates user balances. Idempotent — skips already-corrected trades.
- **Safety Caps:** Max SL distance per timeframe (1m=15, 5m=30, 15m=50, 1h=100, 4h=200, 1D=500, 1W=1000, 1M=2000 pips). Metals get higher caps.

### Trade Limits
- **Per-Instrument:** Max 1 open trade per instrument per user.
- **Total Open Trades:** Respects user's `maxOpenPositions` setting (1-10, default 3). No hardcoded override.
- **OANDA Instrument Filters:** Users can select specific instruments and timeframes for OANDA auto-execute independently of paper trading filters. Allows trading specific assets like Silver (XAGUSD) exclusively on live accounts.
- **Win Rate Gate:** Auto-blocks pairs with <40% win rate over last 14 days (minimum 10 trades).

### Telegram Signal Integration
- **Engine:** `server/telegram-bot.ts` — private-chat forwarding mode.
- **Mode:** User forwards messages from VIP signal groups to the bot's private chat (no group access needed).
- **Parser:** Extracts instrument, direction, entry price/zone, SL, TP from signal text. Ignores jargon/commentary.
- **VIP Format Support:** Handles "Buy/Sell zone now" signals with bare number range entries (e.g., "5155-5150"), "Invalid / SL" stop-loss pattern, and "Targets" heading followed by number list. If instrument not in message text, extracted from forwarded group title (e.g., "VIP XAUUSD SIGNALS" → XAUUSD).
- **Commentary Rejection:** Filters out "+35", "Profit!", "Boom", "In profit", "Close profit", "Target 1", "Potential buy zone" (without "now"), and "Wait for the call" messages.
- **Instrument Aliases:** Maps GOLD→XAUUSD, SILVER→XAGUSD, plus all standard forex pairs.
- **Entry Zones:** Supports range entries like "5380-5390" (uses midpoint).
- **Auto TP Calculation:** When no targets provided, calculates TP using 2:1 R:R from entry midpoint.
- **OANDA Execution:** Auto-places trades with configured risk %, lot sizing, and all safety checks.
- **Account Selection:** User chooses "Paper (Safe)" or "Live (Real Money)" per-user. Paper creates simulated trades; Live places on OANDA.
- **Dedicated Risk %:** Separate `telegramRiskPercent` (default 0.5%) independent of main trading risk. Slider 0.1%-3%.
- **Settings:** `telegramEnabled`, `telegramChatId`, `telegramAutoExecute`, `telegramRiskPercent`, `telegramAccountType` in `user_settings` table.
- **Bot Commands:** `/start` shows Chat ID and setup instructions.
- **Feedback:** Bot replies with parsed signal details and execution status.

### Micro-Scalper (Instant Profit Trapper)
- **Engine:** Independent high-frequency scalping system (`server/micro-scalper.ts`).
- **Architecture:** Multi-user manager pattern with isolated instances.
- **Data Source:** Per-user OANDA Streaming Prices API connections.
- **Entry Logic:** Momentum burst detection with quality filters.
- **Profit Trapping:** Break-even stops and trailing stops.
- **Safety Controls:** Max trades per hour, daily loss limits.
- **OANDA Integration:** Can auto-execute trades on OANDA.

### Commission & Monetization System
- **Model:** 25% commission on profitable trades for live OANDA accounts.
- **Deposits:** Stripe Checkout for initial deposits and manual top-ups.
- **Auto Top-Up:** Saved card charged automatically when balance drops below £20.
- **Trading Gate:** Blocks auto-execute for paused users.

### Signals Hub
- **Active Signals:** Real-time display of scanner-generated signals with `signalScore` (confidence, historical win rate, R:R ratio).
- **Top Pick:** Highest-scored signal with context.
- **Per-Signal Win Rate:** Color-coded win rate badge.
- **Filters:** Client-side filtering by Type, Direction, Timeframe.
- **Trade Placement:** Direct trade placement from any active signal.
- **Daily Signal Log:** Shows historical signals with outcome tracking and P&L.
- **Pair Performance Scoreboard:** Per-instrument signal performance table.

### Core Trading Features
- Market Overview Dashboard, Detailed Analysis View, Trade Signal Generation, Support/Resistance Detection, Position Size Calculator.

### Cross-User Leaderboard
- Ranks traders by return % across simulated trades.
- **Privacy:** Users can opt out.

### Onboarding & UX
- **Onboarding Wizard:** Guided setup for new users.
- **Trading Reports:** Equity curve charts, daily P&L.
- **Contextual Tooltips:** Explanations for trading metrics.

### Advanced Features
- Trading session indicators, multi-timeframe analysis, trade journal, price alerts, economic calendar, signal performance tracking, customizable settings, smart money analysis, trade simulation engine, learning feedback system, comprehensive risk management, news blackout detection.

### Professional Trading Tools
- TradingView embedded charts, historical data analysis, chart pattern recognition, Elliott Wave analysis, Fibonacci retracement, AI backtesting engine, divergence detection, Smart Money Concepts (SMC), and MT5 signal export.

### Mobile Optimization
- Responsive layout with full mobile functionality.

## External Dependencies

### Database
- **PostgreSQL**

### Market Data APIs
- **OANDA**
- **Twelve Data**
- **Alpha Vantage**

### UI/Component Libraries
- **Radix UI**
- **Lucide React**
- **Embla Carousel**
- **Recharts**

### Development Tools
- **Drizzle Kit**
- **esbuild**