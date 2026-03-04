//+------------------------------------------------------------------+
//|                                                   TradeIQ_EA.mq5 |
//|                                        TradeIQ Trading Intelligence |
//|                                   https://trading-intelligence-hub.replit.app |
//+------------------------------------------------------------------+
#property copyright "TradeIQ"
#property link      "https://trading-intelligence-hub.replit.app"
#property version   "1.00"
#property strict

//--- Input parameters
input string   ServerURL = "https://trading-intelligence-hub.replit.app"; // TradeIQ Server URL
input double   RiskPercent = 1.0;        // Risk per trade (%)
input int      MinConfidence = 70;       // Minimum signal confidence (%)
input int      PollIntervalSeconds = 30; // Signal poll interval (seconds)
input int      MaxSlippage = 30;         // Maximum slippage (points)
input int      MaxSpread = 50;           // Maximum spread (points)
input bool     AllowBuy = true;          // Allow BUY trades
input bool     AllowSell = true;         // Allow SELL trades
input string   TradeComment = "TradeIQ"; // Trade comment

//--- Global variables
datetime lastPollTime = 0;
int lastTicket = 0;
string lastSignalId = "";

//+------------------------------------------------------------------+
//| Expert initialization function                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("TradeIQ EA v1.0 initialized");
   Print("Server: ", ServerURL);
   Print("Risk: ", RiskPercent, "% | Min Confidence: ", MinConfidence, "%");
   
   // Send initial heartbeat
   SendHeartbeat();
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                   |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("TradeIQ EA stopped. Reason: ", reason);
}

//+------------------------------------------------------------------+
//| Expert tick function                                               |
//+------------------------------------------------------------------+
void OnTick()
{
   // Only poll for signals at specified interval
   if(TimeCurrent() - lastPollTime < PollIntervalSeconds)
      return;
   
   lastPollTime = TimeCurrent();
   
   // Check for new signals
   CheckForSignals();
   
   // Send heartbeat every 5 poll cycles
   static int heartbeatCounter = 0;
   heartbeatCounter++;
   if(heartbeatCounter >= 5)
   {
      SendHeartbeat();
      heartbeatCounter = 0;
   }
}

//+------------------------------------------------------------------+
//| Check for trading signals from TradeIQ                            |
//+------------------------------------------------------------------+
void CheckForSignals()
{
   string url = ServerURL + "/api/mt5/signals?minConfidence=" + IntegerToString(MinConfidence);
   string result = "";
   
   if(!WebRequest(url, result))
   {
      Print("Failed to fetch signals from TradeIQ");
      return;
   }
   
   // Parse JSON response
   if(StringFind(result, "\"autoTradeEnabled\":false") >= 0)
   {
      Print("Auto-trading is disabled in TradeIQ settings");
      return;
   }
   
   // Look for signals array
   int signalsStart = StringFind(result, "\"signals\":[");
   if(signalsStart < 0)
      return;
   
   // Parse each signal
   string signalsSection = StringSubstr(result, signalsStart);
   
   // Find first signal
   int firstSignal = StringFind(signalsSection, "{\"id\":");
   if(firstSignal < 0)
   {
      Print("No active signals");
      return;
   }
   
   // Extract signal data
   string signalId = ExtractJsonString(signalsSection, "id");
   string instrument = ExtractJsonString(signalsSection, "instrument");
   string direction = ExtractJsonString(signalsSection, "direction");
   int confidence = (int)ExtractJsonNumber(signalsSection, "confidence");
   double entryPrice = ExtractJsonNumber(signalsSection, "entryPrice");
   double stopLoss = ExtractJsonNumber(signalsSection, "stopLoss");
   double takeProfit1 = ExtractJsonNumber(signalsSection, "takeProfit1");
   bool canTrade = StringFind(signalsSection, "\"canTrade\":true") >= 0;
   
   // Skip if already processed this signal
   if(signalId == lastSignalId)
      return;
   
   // Check if we can trade
   if(!canTrade)
   {
      Print("Signal ", signalId, " - Cannot trade (position limit or already open)");
      return;
   }
   
   // Validate direction
   if(direction == "buy" && !AllowBuy)
   {
      Print("BUY signals disabled");
      return;
   }
   if(direction == "sell" && !AllowSell)
   {
      Print("SELL signals disabled");
      return;
   }
   
   // Map instrument to MT5 symbol
   string symbol = MapInstrumentToSymbol(instrument);
   if(symbol == "")
   {
      Print("Unknown instrument: ", instrument);
      return;
   }
   
   // Check spread
   double spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   if(spread > MaxSpread)
   {
      Print("Spread too high: ", spread, " points (max ", MaxSpread, ")");
      return;
   }
   
   Print("=== NEW SIGNAL ===");
   Print("Signal ID: ", signalId);
   Print("Instrument: ", instrument, " (", symbol, ")");
   Print("Direction: ", direction);
   Print("Confidence: ", confidence, "%");
   Print("Entry: ", entryPrice, " | SL: ", stopLoss, " | TP: ", takeProfit1);
   
   // Calculate lot size based on risk
   double lotSize = CalculateLotSize(symbol, stopLoss, entryPrice, direction);
   if(lotSize <= 0)
   {
      Print("Invalid lot size calculated");
      return;
   }
   
   Print("Calculated Lot Size: ", lotSize);
   
   // Execute trade
   bool success = ExecuteTrade(symbol, direction, lotSize, stopLoss, takeProfit1, signalId);
   
   if(success)
   {
      lastSignalId = signalId;
      ReportTradeToServer(signalId, instrument, direction, entryPrice, stopLoss, takeProfit1, lotSize, "opened");
   }
}

//+------------------------------------------------------------------+
//| Execute a trade                                                    |
//+------------------------------------------------------------------+
bool ExecuteTrade(string symbol, string direction, double lotSize, double sl, double tp, string signalId)
{
   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   
   request.action = TRADE_ACTION_DEAL;
   request.symbol = symbol;
   request.volume = lotSize;
   request.deviation = MaxSlippage;
   request.magic = 123456;
   request.comment = TradeComment + "_" + signalId;
   
   if(direction == "buy")
   {
      request.type = ORDER_TYPE_BUY;
      request.price = SymbolInfoDouble(symbol, SYMBOL_ASK);
      request.sl = sl;
      request.tp = tp;
   }
   else if(direction == "sell")
   {
      request.type = ORDER_TYPE_SELL;
      request.price = SymbolInfoDouble(symbol, SYMBOL_BID);
      request.sl = sl;
      request.tp = tp;
   }
   else
   {
      Print("Invalid direction: ", direction);
      return false;
   }
   
   if(!OrderSend(request, result))
   {
      Print("OrderSend failed: ", GetLastError(), " - ", result.comment);
      return false;
   }
   
   if(result.retcode != TRADE_RETCODE_DONE && result.retcode != TRADE_RETCODE_PLACED)
   {
      Print("Trade failed. Retcode: ", result.retcode);
      return false;
   }
   
   lastTicket = (int)result.deal;
   Print("Trade executed! Deal: ", result.deal, " | Order: ", result.order);
   
   return true;
}

//+------------------------------------------------------------------+
//| Calculate lot size based on risk percentage                        |
//+------------------------------------------------------------------+
double CalculateLotSize(string symbol, double sl, double entry, string direction)
{
   double accountBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount = accountBalance * (RiskPercent / 100.0);
   
   // Calculate pip value
   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   
   // Calculate stop loss distance in points
   double slDistance = MathAbs(entry - sl);
   double slPoints = slDistance / tickSize;
   
   if(slPoints <= 0 || tickValue <= 0)
   {
      Print("Invalid SL distance or tick value");
      return minLot;
   }
   
   // Calculate lot size
   double lotSize = riskAmount / (slPoints * tickValue);
   
   // Round to lot step
   lotSize = MathFloor(lotSize / lotStep) * lotStep;
   
   // Clamp to min/max
   lotSize = MathMax(minLot, MathMin(maxLot, lotSize));
   
   return NormalizeDouble(lotSize, 2);
}

//+------------------------------------------------------------------+
//| Map TradeIQ instrument to MT5 symbol                              |
//+------------------------------------------------------------------+
string MapInstrumentToSymbol(string instrument)
{
   // Common broker symbol mappings
   if(instrument == "XAUUSD")
   {
      // Try common gold symbols
      if(SymbolInfoInteger("XAUUSD", SYMBOL_EXIST)) return "XAUUSD";
      if(SymbolInfoInteger("GOLD", SYMBOL_EXIST)) return "GOLD";
      if(SymbolInfoInteger("XAUUSDm", SYMBOL_EXIST)) return "XAUUSDm";
      if(SymbolInfoInteger("XAUUSD.a", SYMBOL_EXIST)) return "XAUUSD.a";
   }
   
   // Standard forex pairs
   if(SymbolInfoInteger(instrument, SYMBOL_EXIST))
      return instrument;
   
   // Try with suffix
   string suffixes[] = {"m", ".a", ".e", "_SB"};
   for(int i = 0; i < ArraySize(suffixes); i++)
   {
      string testSymbol = instrument + suffixes[i];
      if(SymbolInfoInteger(testSymbol, SYMBOL_EXIST))
         return testSymbol;
   }
   
   return "";
}

//+------------------------------------------------------------------+
//| Send heartbeat to TradeIQ server                                  |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   string url = ServerURL + "/api/mt5/heartbeat";
   string postData = "{\"accountBalance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
                     ",\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
                     ",\"openPositions\":" + IntegerToString(PositionsTotal()) +
                     ",\"eaVersion\":\"1.0\"}";
   
   string result = "";
   if(WebRequestPost(url, postData, result))
   {
      Print("Heartbeat sent - Balance: ", AccountInfoDouble(ACCOUNT_BALANCE));
   }
}

//+------------------------------------------------------------------+
//| Report trade execution to TradeIQ server                          |
//+------------------------------------------------------------------+
void ReportTradeToServer(string signalId, string instrument, string direction, 
                         double entry, double sl, double tp, double lotSize, string status)
{
   string url = ServerURL + "/api/mt5/report";
   string postData = "{\"signalId\":\"" + signalId + "\"" +
                     ",\"instrument\":\"" + instrument + "\"" +
                     ",\"direction\":\"" + direction + "\"" +
                     ",\"entryPrice\":" + DoubleToString(entry, 5) +
                     ",\"stopLoss\":" + DoubleToString(sl, 5) +
                     ",\"takeProfit\":" + DoubleToString(tp, 5) +
                     ",\"lotSize\":" + DoubleToString(lotSize, 2) +
                     ",\"ticket\":" + IntegerToString(lastTicket) +
                     ",\"status\":\"" + status + "\"}";
   
   string result = "";
   if(WebRequestPost(url, postData, result))
   {
      Print("Trade reported to TradeIQ: ", status);
   }
}

//+------------------------------------------------------------------+
//| HTTP GET Request                                                   |
//+------------------------------------------------------------------+
bool WebRequest(string url, string &result)
{
   char postData[];
   char resultData[];
   string headers = "";
   string resultHeaders = "";
   
   int timeout = 5000;
   
   int res = WebRequest("GET", url, headers, timeout, postData, resultData, resultHeaders);
   
   if(res == -1)
   {
      int error = GetLastError();
      Print("WebRequest error: ", error);
      if(error == 4060)
         Print("Add ", ServerURL, " to allowed URLs in MT5 settings");
      return false;
   }
   
   result = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   return true;
}

//+------------------------------------------------------------------+
//| HTTP POST Request                                                  |
//+------------------------------------------------------------------+
bool WebRequestPost(string url, string postDataStr, string &result)
{
   char postData[];
   char resultData[];
   string headers = "Content-Type: application/json\r\n";
   string resultHeaders = "";
   
   StringToCharArray(postDataStr, postData, 0, StringLen(postDataStr), CP_UTF8);
   ArrayResize(postData, StringLen(postDataStr));
   
   int timeout = 5000;
   
   int res = WebRequest("POST", url, headers, timeout, postData, resultData, resultHeaders);
   
   if(res == -1)
   {
      Print("WebRequest POST error: ", GetLastError());
      return false;
   }
   
   result = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   return true;
}

//+------------------------------------------------------------------+
//| Extract string value from JSON                                     |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string searchKey = "\"" + key + "\":\"";
   int start = StringFind(json, searchKey);
   if(start < 0) return "";
   
   start += StringLen(searchKey);
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";
   
   return StringSubstr(json, start, end - start);
}

//+------------------------------------------------------------------+
//| Extract numeric value from JSON                                    |
//+------------------------------------------------------------------+
double ExtractJsonNumber(string json, string key)
{
   string searchKey = "\"" + key + "\":";
   int start = StringFind(json, searchKey);
   if(start < 0) return 0;
   
   start += StringLen(searchKey);
   
   // Find end of number (comma, bracket, or end)
   string numStr = "";
   for(int i = start; i < StringLen(json); i++)
   {
      ushort ch = StringGetCharacter(json, i);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-')
         numStr += ShortToString(ch);
      else
         break;
   }
   
   return StringToDouble(numStr);
}
//+------------------------------------------------------------------+
