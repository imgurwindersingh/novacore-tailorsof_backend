import { Hono } from "hono";
import { createSessionToken } from "../lib/auth.js";
import { loginSchema } from "../lib/validators/auth.js";
import { login } from "../services/auth.service.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";

const auth = new Hono<{ Variables: AuthVariables }>();

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { token, user }
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

  const token = await createSessionToken(result.data);
  return c.json({ token, user: result.data });
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user (validates token).
 */
auth.get("/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ user });
});

export default auth;
