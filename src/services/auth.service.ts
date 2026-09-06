import {
  createSessionToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyPassword,
} from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { err, ok, type Role, type ServiceResult, type SessionUser } from "../lib/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoginResult {
  user: SessionUser;
  accessToken: string;
  refreshToken: string; // raw value — send to client, never stored
}

export interface RefreshResult {
  user: SessionUser;
  accessToken: string;
  refreshToken: string; // rotated — new raw value; old token is deleted
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves a SessionUser from the database by ID.
 * Returns null for the env-based fallback admin (id = "admin-1") since it has
 * no DB row — callers handle that case explicitly.
 */
async function getUserById(id: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role as Role };
}

/**
 * Persists a hashed refresh token for the given user.
 */
async function storeRefreshToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });
}

// ── Login ─────────────────────────────────────────────────────────────────────

/**
 * Validates credentials and — on success — returns an access token (2-day JWT)
 * and a refresh token (7-day opaque value).  The refresh token hash is stored
 * in the DB so it can be validated and rotated on subsequent calls.
 */
export async function login(
  email: string,
  password: string
): Promise<ServiceResult<LoginResult>> {
  let sessionUser: SessionUser | null = null;
  let isDbUser = false;

  // Path 1 — database user
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const valid = await verifyPassword(password, user.passwordHash);
      if (valid) {
        sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role as Role };
        isDbUser = true;
      }
    }
  } catch (error) {
    console.error("Database query during login failed:", error);
  }

  // Path 2 — env-based fallback admin (no DB row required)
  if (!sessionUser) {
    const adminEmail = process.env.ADMIN_EMAIL ?? "admin@tailorsoft.dev";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";
    if (email.toLowerCase() === adminEmail.toLowerCase() && password === adminPassword) {
      sessionUser = {
        id: "admin-1",
        email: adminEmail,
        name: process.env.ADMIN_NAME ?? "Unique Tailors",
        role: "ADMIN" as Role,
      };
      isDbUser = false;
    }
  }

  if (!sessionUser) {
    return err("Invalid email or password");
  }

  // Issue tokens
  const accessToken = await createSessionToken(sessionUser);
  const { raw, hash: tokenHash, expiresAt } = generateRefreshToken();

  // Persist refresh token only for real DB users
  // (the fallback admin has no DB row to FK against)
  if (isDbUser) {
    await storeRefreshToken(sessionUser.id, tokenHash, expiresAt);
  }

  return ok({ user: sessionUser, accessToken, refreshToken: raw });
}

// ── Refresh ───────────────────────────────────────────────────────────────────

/**
 * Validates an incoming refresh token, rotates it (delete old, insert new),
 * and returns a fresh access token + new refresh token.
 *
 * Rotation means every refresh call invalidates the previous refresh token,
 * limiting the window for token-theft attacks.
 */
export async function refreshTokens(
  rawRefreshToken: string
): Promise<ServiceResult<RefreshResult>> {
  const incomingHash = hashRefreshToken(rawRefreshToken);

  let stored: { id: string; userId: string; expiresAt: Date } | null = null;
  try {
    stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: incomingHash },
      select: { id: true, userId: true, expiresAt: true },
    });
  } catch (error) {
    console.error("DB error looking up refresh token:", error);
    return err("Internal error");
  }

  if (!stored) {
    return err("Invalid refresh token");
  }

  if (stored.expiresAt < new Date()) {
    // Clean up the expired row
    await prisma.refreshToken.delete({ where: { id: stored.id } }).catch(() => null);
    return err("Refresh token expired");
  }

  // Resolve the user — they may have been deleted since the token was issued
  const user = await getUserById(stored.userId);
  if (!user) {
    await prisma.refreshToken.delete({ where: { id: stored.id } }).catch(() => null);
    return err("User not found");
  }

  // Rotate: delete old token, issue new pair atomically
  const { raw, hash: newHash, expiresAt: newExpiry } = generateRefreshToken();

  await prisma.$transaction([
    prisma.refreshToken.delete({ where: { id: stored.id } }),
    prisma.refreshToken.create({ data: { userId: user.id, tokenHash: newHash, expiresAt: newExpiry } }),
  ]);

  const accessToken = await createSessionToken(user);

  return ok({ user, accessToken, refreshToken: raw });
}

// ── Logout ────────────────────────────────────────────────────────────────────

/**
 * Revokes a single refresh token.  Call on explicit logout.
 * Silently succeeds even if the token is already gone.
 */
export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  await prisma.refreshToken
    .delete({ where: { tokenHash } })
    .catch(() => null); // ignore not-found
}

/**
 * Revokes ALL refresh tokens for a user (e.g. "sign out everywhere").
 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}
