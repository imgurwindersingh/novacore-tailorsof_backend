import { Hono } from "hono";
import { loginSchema } from "../lib/validators/auth.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";
import {
  login,
  refreshTokens,
  revokeAllRefreshTokens,
  revokeRefreshToken,
} from "../services/auth.service.js";

const auth = new Hono<{ Variables: AuthVariables }>();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
/**
 * Body: { email, password }
 * Returns: { accessToken, refreshToken, user }
 *
 * Store accessToken in memory (not localStorage) for XSS safety.
 * Store refreshToken in an httpOnly cookie or secure storage.
 */
auth.post("/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const result = await login(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    return c.json({ error: result.error }, 401);
  }

  const { user, accessToken, refreshToken } = result.data;
  return c.json({ accessToken, refreshToken, user });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
/**
 * Body: { refreshToken }
 * Returns: { accessToken, refreshToken, user }
 *
 * The old refresh token is immediately invalidated (rotation).
 * Call this when the access token is expired (client receives 401).
 * If this also returns 401, the session is fully expired — redirect to login.
 */
auth.post("/refresh", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).refreshToken !== "string"
  ) {
    return c.json({ error: "refreshToken is required" }, 400);
  }

  const rawToken = (body as Record<string, string>).refreshToken.trim();
  if (!rawToken) {
    return c.json({ error: "refreshToken is required" }, 400);
  }

  const result = await refreshTokens(rawToken);
  if (!result.ok) {
    // Distinguish expired vs invalid for the client to handle gracefully
    const status = result.error === "Refresh token expired" ? 401 : 401;
    return c.json({ error: result.error }, status);
  }

  const { user, accessToken, refreshToken } = result.data;
  return c.json({ accessToken, refreshToken, user });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
/**
 * Body: { refreshToken }  (optional — omit to only clear server session)
 * Revokes the supplied refresh token so it can never be used again.
 * The client should also discard the access token from memory.
 */
auth.post("/logout", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    // No body is fine — just succeed silently
    return c.json({ ok: true });
  }

  const raw =
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).refreshToken === "string"
      ? ((body as Record<string, string>).refreshToken.trim())
      : null;

  if (raw) {
    await revokeRefreshToken(raw);
  }

  return c.json({ ok: true });
});

// ── POST /api/auth/logout-all ─────────────────────────────────────────────────
/**
 * Requires a valid access token.
 * Revokes ALL refresh tokens for the authenticated user ("sign out everywhere").
 */
auth.post("/logout-all", requireAuth, async (c) => {
  const user = c.get("user");
  await revokeAllRefreshTokens(user.id);
  return c.json({ ok: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
/**
 * Returns the currently authenticated user (validates access token).
 */
auth.get("/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ user });
});

export default auth;
