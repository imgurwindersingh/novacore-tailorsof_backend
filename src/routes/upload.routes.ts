import { Hono } from "hono";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";

const UPLOAD_DIR = join(process.cwd(), "uploads");
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const uploadRoutes = new Hono();

/**
 * POST /api/upload/image
 * Accepts multipart form data with a single "file" field.
 * No auth required (public page upload).
 */
uploadRoutes.post("/image", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    if (file.size > MAX_SIZE_BYTES) {
      return c.json({ error: "Image too large. Please upload an image up to 3-5 MB." }, 400);
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return c.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF." }, 400);
    }

    const ext = extname(file.name) || ".jpg";
    const filename = `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`;

    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(join(UPLOAD_DIR, filename), buffer);

    return c.json({ url: `/api/upload/${filename}`, filename });
  } catch (err) {
    console.error("[upload] Error:", err);
    return c.json({ error: "Upload failed" }, 500);
  }
});

/**
 * GET /api/uploads/:filename
 * Serve uploaded files. No auth required.
 */
uploadRoutes.get("/:filename", async (c) => {
  const filename = c.req.param("filename");

  // Basic path traversal protection
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const filePath = join(UPLOAD_DIR, filename);
  if (!existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const data = await readFile(filePath);
  const ext = extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };

  return new Response(data, {
    headers: {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

export default uploadRoutes;
