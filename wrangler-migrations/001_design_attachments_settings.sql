-- Add design attachment columns to OrderItem
ALTER TABLE "OrderItem" ADD COLUMN "designImageUrl" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "designReferenceUrl" TEXT;

-- Config key-value table (admin WhatsApp Business number etc.)
CREATE TABLE IF NOT EXISTS "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);