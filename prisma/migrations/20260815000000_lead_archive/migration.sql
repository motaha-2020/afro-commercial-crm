-- Archiving a lead is not a commercial verdict, so it is not a status.
-- Nullable and additive: every existing lead is unarchived, which is what they
-- all were a moment ago.
ALTER TABLE "Lead" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- The working list filters on it every time it loads.
CREATE INDEX "Lead_archivedAt_idx" ON "Lead"("archivedAt");
