import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";

type R2Bucket = {
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
};

type UploadBindings = { DESIGN_REFERENCES?: R2Bucket; R2_PUBLIC_URL?: string };
const MAX_BYTES = 5 * 1024 * 1024;
const WINDOW_MS = 60_000;
const MAX_UPLOADS_PER_WINDOW = 20;
const attempts = new Map<string, { count: number; startedAt: number }>();

function allowUpload(userId: string): boolean {
  const now = Date.now();
  const current = attempts.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    attempts.set(userId, { count: 1, startedAt: now });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_UPLOADS_PER_WINDOW;
}

function detectImage(bytes: Uint8Array): { extension: string; mime: string } | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => bytes[i] === byte)) return { extension: "png", mime: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: "jpg", mime: "image/jpeg" };
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return { extension: "webp", mime: "image/webp" };
  return null;
}

function safeShopPath(shopId: string): string {
  // shopId is issued by the server in the JWT; retain only a path-safe representation.
  return shopId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const uploads = new Hono<{ Bindings: UploadBindings; Variables: AuthVariables }>();
uploads.use("*", requireAuth);

uploads.post("/design-reference", async (c) => {
  const user = c.get("user");
  if (user.role !== "ADMIN" && user.role !== "STAFF") return c.json({ error: "Forbidden" }, 403);
  if (!allowUpload(user.id)) return c.json({ error: "Too many upload requests" }, 429);

  const bucket = c.env.DESIGN_REFERENCES;
  const publicBase = c.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!bucket || !publicBase) return c.json({ error: "Design image storage is not configured" }, 503);

  let form: FormData;
  try { form = await c.req.formData(); } catch { return c.json({ error: "Expected multipart/form-data" }, 400); }
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: 'A file field named "file" is required' }, 400);
  if (file.size === 0 || file.size > MAX_BYTES) return c.json({ error: "Image must be no larger than 5 MB" }, 400);

  const body = await file.arrayBuffer();
  const image = detectImage(new Uint8Array(body));
  if (!image) return c.json({ error: "Only JPEG, PNG, and WebP images are allowed" }, 400);

  const key = `shops/${safeShopPath(user.shopId)}/design-references/${crypto.randomUUID()}.${image.extension}`;
  await bucket.put(key, body, { httpMetadata: { contentType: image.mime } });
  return c.json({ imageUrl: `${publicBase}/${key}` }, 201);
});

export default uploads;
