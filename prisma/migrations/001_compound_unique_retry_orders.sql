-- Migration: compound unique key + retry fields + Order model
-- Apply this in Supabase SQL Editor (Database > SQL Editor > New Query)

-- 1. Drop old global unique constraint on aliexpressProductId
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_aliexpressProductId_key";

-- 2. Add compound unique constraint (same product can exist in different channels)
ALTER TABLE "Product" ADD CONSTRAINT "Product_aliexpressProductId_channelId_key"
  UNIQUE ("aliexpressProductId", "channelId");

-- 3. Add retry tracking fields
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lastError" TEXT;

-- 4. Create Order table for real commission tracking
CREATE TABLE IF NOT EXISTS "Order" (
  "id"             TEXT NOT NULL,
  "aliOrderId"     TEXT NOT NULL,
  "channelId"      TEXT,
  "productTitle"   TEXT,
  "orderStatus"    TEXT NOT NULL,
  "commissionFee"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "paidAmount"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "orderCreatedAt" TIMESTAMP(3) NOT NULL,
  "fetchedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_aliOrderId_key" UNIQUE ("aliOrderId")
);

CREATE INDEX IF NOT EXISTS "Order_orderCreatedAt_idx" ON "Order"("orderCreatedAt");
CREATE INDEX IF NOT EXISTS "Order_channelId_idx"      ON "Order"("channelId");

-- Add foreign key if channels exist
ALTER TABLE "Order" ADD CONSTRAINT "Order_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Done!
SELECT 'Migration applied successfully' AS result;
