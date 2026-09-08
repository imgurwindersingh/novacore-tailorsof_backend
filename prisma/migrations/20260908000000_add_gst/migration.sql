-- GST snapshot on orders: applied at creation so historical invoices stay stable
ALTER TABLE "Order" ADD COLUMN "gstRatePercent" INTEGER;
ALTER TABLE "Order" ADD COLUMN "gstPaise" INTEGER NOT NULL DEFAULT 0;