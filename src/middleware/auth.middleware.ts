import type { Context, Next } from "hono";
import { verifySessionToken } from "../lib/auth.js";
import type { SessionUser } from "../lib/types.js";

// Extend Hono's context variables type
export type AuthVariables = {
  user: SessionUser;
};

/**
 * Middleware that requires a valid Bearer JWT in the Authorization header.
 * Sets c.var.user on success, returns 401 otherwise.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const user = await verifySessionToken(token);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", user);
  await next();
}
