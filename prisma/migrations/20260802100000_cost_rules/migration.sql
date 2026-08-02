-- G&A and overheads as rules, not one percentage.
--
-- Section 18: "لا أنصح بوضع نسبة G&A واحدة على كل شيء". One rate on everything
-- makes a bid in a cheap country subsidise one in an expensive country while
-- both look correctly priced.
--
-- approvalStatus exists because section 19's principle governs here too: the
-- system does not decide accounting treatment on its own, it applies rules
-- Finance has approved.

-- CreateEnum
CREATE TYPE "CostRuleCategory" AS ENUM ('G_AND_A', 'OVERHEAD', 'FINANCING', 'RISK_PROVISION', 'INSURANCE');

-- CreateEnum
CREATE TYPE "CostRuleMethod" AS ENUM ('PERCENT_OF_DIRECT_COST', 'PERCENT_OF_REVENUE', 'FIXED_AMOUNT', 'MONTHLY_RATE');

-- CreateEnum
CREATE TYPE "CostRuleApprovalStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CostRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CostRuleCategory" NOT NULL,
    "method" "CostRuleMethod" NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "currency" TEXT,
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

    CONSTRAINT "CostRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostRule_code_key" ON "CostRule"("code");

-- CreateIndex
CREATE INDEX "CostRule_category_country_idx" ON "CostRule"("category", "country");

-- CreateIndex
CREATE INDEX "CostRule_approvalStatus_idx" ON "CostRule"("approvalStatus");

-- CreateIndex
CREATE INDEX "CostRule_effectiveFrom_idx" ON "CostRule"("effectiveFrom");

-- AddForeignKey
ALTER TABLE "CostRule" ADD CONSTRAINT "CostRule_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRule" ADD CONSTRAINT "CostRule_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRule" ADD CONSTRAINT "CostRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
