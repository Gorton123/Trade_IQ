import cookieParser from "cookie-parser";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { createRequire } from "module";
import path from "path";

const app = express();
app.use(cookieParser());
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

let appReady = false;

async function loadModule(name: string) {
  if (process.env.NODE_ENV === "production") {
    const req = createRequire(import.meta.url ?? __filename);
    return req(path.join(__dirname, `${name}.cjs`));
  }
  return import(`./${name}`);
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: appReady ? "ok" : "starting",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/", (_req, res, next) => {
  if (!appReady) {
    res.status(200).set({ "Content-Type": "text/html" }).send(
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>TradeIQ</title></head><body style='background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui'><div style='text-align:center'><h2>TradeIQ is starting up...</h2><p>Please wait a moment</p></div></body></html>"
    );
  } else {
    next();
  }
});

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        console.error('[Stripe] Webhook body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      const { WebhookHandlers } = await loadModule("webhookHandlers");
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('[Stripe] Webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

const port = parseInt(process.env.PORT || "5000", 10);
httpServer.listen(
  {
    port,
    host: "0.0.0.0",
    reusePort: true,
  },
  () => {
    log(`serving on port ${port} (accepting healthchecks)`);
    setTimeout(initializeApp, 0);
  },
);

async function initializeApp() {
  try {
    // Stripe: standard webhook handling via /api/stripe/webhook (no Replit sync needed)
    console.log('[Stripe] Using standard webhook mode (Render deployment)');

    const { registerRoutes } = await loadModule("routes");
    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("Internal Server Error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message });
    });

    if (process.env.NODE_ENV === "production") {
      const { serveStatic } = await loadModule("static");
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    appReady = true;
    log("App fully initialized and ready");
  } catch (error) {
    console.error("Fatal initialization error:", error);
  }
}
