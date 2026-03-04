import { users, type User, type UpsertUser } from "@shared/models/auth";
import { userSettingsTable } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser & { passwordHash?: string }): Promise<User>;
  ensureUserSettings(userId: string, displayName?: string): Promise<void>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser & { passwordHash?: string }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData as any)
      .onConflictDoUpdate({
        target: users.id,
        set: { ...userData, updatedAt: new Date() } as any,
      })
      .returning();
    return user;
  }

  async ensureUserSettings(userId: string, displayName?: string): Promise<void> {
    try {
      const [existing] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
      if (existing) return;
      await db.insert(userSettingsTable).values({
        id: randomUUID(), userId,
        displayName: displayName || undefined,
        simulationEnabled: true,
      });
      console.log(`[Auth] Created user_settings for ${userId.slice(0, 8)}...`);
    } catch (err: any) {
      if (err.code === "23505") return;
      console.error(`[Auth] Error creating user_settings:`, err.message);
    }
  }
}

export const authStorage = new AuthStorage();
