import { compare, hash } from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, REFRESH_TOKEN_MAX_AGE_SECONDS } from "./constants.js";
import type { Role, SessionUser } from "./types.js";

// ── Secret key ────────────────────────────────────────────────────────────────

function secretKey(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET ??
    "6c3870bf3644aaae250dae1870e56335713e150f9303b39c18d8bb4f95f34db3";
  return new TextEncoder().encode(secret);
}

// ── Password helpers ──────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

// ── Access token (JWT, 2-day expiry) ─────────────────────────────────────────

/**
 * Creates a short-lived JWT access token.
 * Expires in ACCESS_TOKEN_MAX_AGE_SECONDS (2 days).
 */
export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_MAX_AGE_SECONDS)
    .sign(secretKey());
}

/**
 * Verifies a JWT access token and returns the embedded SessionUser, or null if
 * the token is missing, expired, or tampered with.
 */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      !payload.sub ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

// ── Refresh token (opaque random bytes, 7-day expiry) ─────────────────────────

/**
 * Generates a cryptographically random, URL-safe refresh token string.
 * Returns both the raw token (sent to the client once) and its SHA-256 hash
 * (stored in the database — the raw value is never persisted).
 */
export function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(40).toString("hex"); // 80 hex chars, 320 bits of entropy
  const tokenHash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_SECONDS * 1000);
  return { raw, hash: tokenHash, expiresAt };
}

/**
 * Returns the SHA-256 hex hash of a raw refresh token.
 * Used when looking up an incoming token against the database.
 */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
