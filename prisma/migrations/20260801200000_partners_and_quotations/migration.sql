-- Release 5 — Partners and Quotations.
-- One Business Partner table with types as rows, per the spec's section 21.

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('SUPPLIER', 'SUBCONTRACTOR', 'CONSULTANT', 'LOCAL_PARTNER', 'LOGISTICS_PROVIDER', 'EQUIPMENT_RENTAL');

-- CreateEnum
CREATE TYPE "PartnerApprovalStatus" AS ENUM ('PROSPECT', 'UNDER_QUALIFICATION', 'APPROVED', 'CONDITIONAL', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'ISSUED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationTechnicalStatus" AS ENUM ('NOT_REVIEWED', 'COMPLIANT', 'COMPLIANT_WITH_DEVIATIONS', 'NON_COMPLIANT');

-- CreateEnum
CREATE TYPE "QuotationCommercialStatus" AS ENUM ('NOT_REVIEWED', 'ACCEPTABLE', 'NEEDS_NEGOTIATION', 'UNACCEPTABLE');

-- CreateEnum
CREATE TYPE "QuotationCompliance" AS ENUM ('COMPLIANT', 'ALTERNATIVE', 'DEVIATION', 'NOT_QUOTED');

-- CreateTable
CREATE TABLE "BusinessPartner" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "website" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "approvalStatus" "PartnerApprovalStatus" NOT NULL DEFAULT 'PROSPECT',
    "technicalRating" INTEGER,
    "commercialRating" INTEGER,
    "financialRating" INTEGER,
    "hseRating" INTEGER,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklistReason" TEXT,
    "blacklistedAt" TIMESTAMP(3),
    "notes" TEXT,
    "ownerId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerTypeAssignment" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerTypeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqRecipient" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RfqRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerQuotation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "rfqId" TEXT,
    "quotationNumber" TEXT,
    "quotationDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentTerms" TEXT,
    "deliveryDays" INTEGER,
    "warranty" TEXT,
    "freightTerms" TEXT,
    "taxTreatment" TEXT,
    "totalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "landedAdjustment" DECIMAL(18,2),
    "technicalStatus" "QuotationTechnicalStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "commercialStatus" "QuotationCommercialStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "selectedAt" TIMESTAMP(3),
    "selectedById" TEXT,
    "selectionRationale" TEXT,
    "receivedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerQuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "boqItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "totalPrice" DECIMAL(18,2) NOT NULL,
    "leadTimeDays" INTEGER,
    "compliance" "QuotationCompliance" NOT NULL DEFAULT 'COMPLIANT',
    "exception" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerQuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationEvaluation" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "priceScore" INTEGER,
    "technicalScore" INTEGER,
    "deliveryScore" INTEGER,
    "paymentScore" INTEGER,
    "qualityScore" INTEGER,
    "riskScore" INTEGER,
    "weightedScore" DECIMAL(6,2),
    "weightsUsed" JSONB,
    "recommendation" TEXT,
    "evaluatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QuotationEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPartner_code_key" ON "BusinessPartner"("code");
CREATE INDEX "BusinessPartner_ownerId_idx" ON "BusinessPartner"("ownerId");
CREATE INDEX "BusinessPartner_orgUnitId_idx" ON "BusinessPartner"("orgUnitId");
CREATE INDEX "BusinessPartner_country_idx" ON "BusinessPartner"("country");
CREATE INDEX "BusinessPartner_approvalStatus_idx" ON "BusinessPartner"("approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerTypeAssignment_partnerId_type_key" ON "PartnerTypeAssignment"("partnerId", "type");
CREATE INDEX "PartnerTypeAssignment_partnerId_idx" ON "PartnerTypeAssignment"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_code_key" ON "Rfq"("code");
CREATE INDEX "Rfq_opportunityId_idx" ON "Rfq"("opportunityId");
CREATE INDEX "Rfq_status_idx" ON "Rfq"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RfqRecipient_rfqId_partnerId_key" ON "RfqRecipient"("rfqId", "partnerId");
CREATE INDEX "RfqRecipient_rfqId_idx" ON "RfqRecipient"("rfqId");
CREATE INDEX "RfqRecipient_partnerId_idx" ON "RfqRecipient"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerQuotation_code_key" ON "PartnerQuotation"("code");
CREATE INDEX "PartnerQuotation_partnerId_idx" ON "PartnerQuotation"("partnerId");
CREATE INDEX "PartnerQuotation_opportunityId_idx" ON "PartnerQuotation"("opportunityId");
CREATE INDEX "PartnerQuotation_rfqId_idx" ON "PartnerQuotation"("rfqId");
CREATE INDEX "PartnerQuotation_validUntil_idx" ON "PartnerQuotation"("validUntil");

-- CreateIndex
CREATE INDEX "PartnerQuotationItem_quotationId_idx" ON "PartnerQuotationItem"("quotationId");
CREATE INDEX "PartnerQuotationItem_boqItemId_idx" ON "PartnerQuotationItem"("boqItemId");

-- CreateIndex
CREATE INDEX "QuotationEvaluation_quotationId_idx" ON "QuotationEvaluation"("quotationId");

-- AddForeignKey
ALTER TABLE "BusinessPartner" ADD CONSTRAINT "BusinessPartner_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessPartner" ADD CONSTRAINT "BusinessPartner_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerTypeAssignment" ADD CONSTRAINT "PartnerTypeAssignment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqRecipient" ADD CONSTRAINT "RfqRecipient_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfqRecipient" ADD CONSTRAINT "RfqRecipient_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerQuotation" ADD CONSTRAINT "PartnerQuotation_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerQuotation" ADD CONSTRAINT "PartnerQuotation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerQuotation" ADD CONSTRAINT "PartnerQuotation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerQuotation" ADD CONSTRAINT "PartnerQuotation_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerQuotation" ADD CONSTRAINT "PartnerQuotation_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerQuotationItem" ADD CONSTRAINT "PartnerQuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "PartnerQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerQuotationItem" ADD CONSTRAINT "PartnerQuotationItem_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationEvaluation" ADD CONSTRAINT "QuotationEvaluation_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "PartnerQuotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuotationEvaluation" ADD CONSTRAINT "QuotationEvaluation_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
