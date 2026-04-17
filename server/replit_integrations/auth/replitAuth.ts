/**
 * TradeIQ Auth — JWT + bcrypt (Render-compatible, replaces Replit OIDC)
 * Drop-in replacement: same exports, same middleware signatures.
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import { authStorage } from "./storage";
import { randomUUID } from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "tradeiq-secret-change-in-production";
const SALT_ROUNDS = 10;

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET || JWT_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: string, email: string): string {
  return jwt.sign(
    { sub: userId, email, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyToken(token: string): { sub: string; email: string; exp: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  // Global soft-auth: decode JWT and populate req.user for all routes
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const token: string | undefined = req.cookies?.tradeiq_token || req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        (req as any).user = {
          claims: { sub: payload.sub, email: payload.email, exp: payload.exp },
          access_token: token,
          expires_at: payload.exp,
        };
      }
    }
    next();
  });


  // Global soft-auth: decode JWT and populate req.user for all routes
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const token: string | undefined = req.cookies?.tradeiq_token || req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        (req as any).user = {
          claims: { sub: payload.sub, email: payload.email, exp: payload.exp },
          access_token: token,
          expires_at: payload.exp,
        };
      }
    }
    next();
  });

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password required" });
      if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });

      const existing = await authStorage.getUserByEmail(email.toLowerCase());
      if (existing) return res.status(409).json({ message: "Email already registered" });

      const passwordHash = await hashPassword(password);
      const userId = randomUUID();
      const user = await authStorage.upsertUser({
        id: userId, email: email.toLowerCase(),
        firstName: firstName || null, lastName: lastName || null,
        profileImageUrl: null, passwordHash,
      });
      await authStorage.ensureUserSettings(userId, `${firstName || ""} ${lastName || ""}`.trim());
      const token = signToken(userId, email.toLowerCase());
      res.cookie("tradeiq_token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: "lax" });
      return res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }, token });
    } catch (error: any) {
      console.error("[Auth] Register error:", error);
      return res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password required" });
      const user = await authStorage.getUserByEmail(email.toLowerCase());
      if (!user || !user.passwordHash) return res.status(401).json({ message: "Invalid email or password" });
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) return res.status(401).json({ message: "Invalid email or password" });
      const token = signToken(user.id, user.email!);
      res.cookie("tradeiq_token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: "lax" });
      return res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }, token });
    } catch (error: any) {
      console.error("[Auth] Login error:", error);
      return res.status(500).json({ message: "Login failed" });
    }
  });

  app.get("/api/logout", (_req: Request, res: Response) => { res.clearCookie("tradeiq_token"); res.redirect("/"); });
  app.post("/api/auth/logout", (_req: Request, res: Response) => { res.clearCookie("tradeiq_token"); res.json({ success: true }); });
  app.get("/api/login", (_req: Request, res: Response) => { res.redirect("/?login=true"); });
  app.get("/api/callback", (_req: Request, res: Response) => { res.redirect("/"); });
}

export const isAuthenticated: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token: string | undefined = req.cookies?.tradeiq_token || req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Unauthorized" });
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ message: "Unauthorized" });
    (req as any).user = {
      claims: { sub: payload.sub, email: payload.email, exp: payload.exp },
      access_token: token,
      expires_at: payload.exp,
    };
    return next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
};
