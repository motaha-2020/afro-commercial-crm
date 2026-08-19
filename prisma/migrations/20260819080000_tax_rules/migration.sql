-- Tax rules, approved by Finance exactly as cost rules are.
--
-- Kept in their own table rather than folded into CostRule's TAXES category,
-- because a tax is not an overhead in the respect that matters to the
-- arithmetic: an overhead is money the company spends and must earn back,
-- while VAT is money passing through it. One total for both would make a
-- healthy margin look thin, and a thin one look survivable.
--
-- The rate applies to a named base -- selling price, direct cost,
-- subcontractor payments, imported materials -- because withholding is
-- deducted from what a subcontractor is paid while duty lands on imports
-- alone, and a tax layer with a single base can express neither honestly.

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('VAT', 'WITHHOLDING', 'CUSTOMS_DUTY', 'STAMP_DUTY', 'SOCIAL_INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxBase" AS ENUM ('SELLING_PRICE', 'DIRECT_COST', 'SUBCONTRACTOR_PAYMENTS', 'IMPORTED_MATERIALS');

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "base" "TaxBase" NOT NULL,
    "ratePercent" DECIMAL(9,4) NOT NULL,
    "isRecoverable" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT,
    "orgUnitId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "approvalStatus" "CostRuleApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxRule_code_key" ON "TaxRule"("code");

-- CreateIndex
CREATE INDEX "TaxRule_taxType_country_idx" ON "TaxRule"("taxType", "country");

-- CreateIndex
CREATE INDEX "TaxRule_approvalStatus_idx" ON "TaxRule"("approvalStatus");

-- CreateIndex
CREATE INDEX "TaxRule_effectiveFrom_idx" ON "TaxRule"("effectiveFrom");

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

