-- Reference lists: the dropdown values an administrator controls.
--
-- Two changes, in order. First the columns holding reference values stop being
-- Postgres enums and become text: an enum cannot gain a value at runtime, so
-- while these stayed enums no screen could ever add an industry. Existing rows
-- carry their current value across unchanged — the cast is on the type, not the
-- data. Second, the two tables that hold the lists themselves.
--
-- Values that code branches on (stage, status, forecast, health, role, credit
-- standing) are deliberately NOT converted: they stay enums so the database
-- keeps rejecting a value no code path handles.

-- ---------------------------------------------------------------------------
-- 1. Enum columns -> text
-- ---------------------------------------------------------------------------
ALTER TABLE "Account" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Account" ALTER COLUMN "industry" TYPE TEXT USING "industry"::TEXT;
ALTER TABLE "Lead" ALTER COLUMN "source" TYPE TEXT USING "source"::TEXT;
ALTER TABLE "Lead" ALTER COLUMN "industry" TYPE TEXT USING "industry"::TEXT;
ALTER TABLE "Opportunity" ALTER COLUMN "source" TYPE TEXT USING "source"::TEXT;
ALTER TABLE "Opportunity" ALTER COLUMN "industry" TYPE TEXT USING "industry"::TEXT;
ALTER TABLE "Activity" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "PartnerTypeAssignment" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;

DROP TYPE "AccountType";
DROP TYPE "Industry";
DROP TYPE "LeadSource";
DROP TYPE "ActivityType";
DROP TYPE "PartnerType";

-- ---------------------------------------------------------------------------
-- 2. The lists
-- ---------------------------------------------------------------------------
CREATE TABLE "RefList" (
    "key" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelFr" TEXT NOT NULL,
    "allowsNewItems" BOOLEAN NOT NULL DEFAULT true,
    "lockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefList_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "RefListItem" (
    "id" TEXT NOT NULL,
    "listKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelFr" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefListItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefListItem_listKey_code_key" ON "RefListItem"("listKey", "code");
CREATE INDEX "RefListItem_listKey_isActive_sortOrder_idx" ON "RefListItem"("listKey", "isActive", "sortOrder");

ALTER TABLE "RefListItem" ADD CONSTRAINT "RefListItem_listKey_fkey"
    FOREIGN KEY ("listKey") REFERENCES "RefList"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
