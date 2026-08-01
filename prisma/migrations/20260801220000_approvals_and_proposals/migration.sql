-- Release 6 — Approvals and Proposals.
--
-- The spec's section 28 is explicit: "لا أنصح بوضع Workflow ثابت داخل الكود.
-- نحتاج Workflow قابلًا للتهيئة". Every threshold below is a row, not a
-- constant, because Afro Group's answer to "what are the real approval limits"
-- was that they differ by project, opportunity and country.

-- CreateEnum
CREATE TYPE "ApprovalPolicyKey" AS ENUM ('MIN_GROSS_MARGIN_PERCENT', 'MIN_SELLING_PRICE_MARGIN_PERCENT', 'APPROVAL_VALUE_LIMIT', 'MAX_PAYMENT_TERM_DAYS', 'MAX_DISCOUNT_PERCENT', 'BID_GO_THRESHOLD', 'BID_CONDITIONAL_THRESHOLD');

-- CreateEnum
CREATE TYPE "ApprovalProcess" AS ENUM ('OPPORTUNITY_PRICING', 'DISCOUNT', 'PROPOSAL_SUBMISSION', 'CONTRACT');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('SINGLE', 'ALL_OF', 'ANY_OF');

-- CreateEnum
CREATE TYPE "ApprovalConditionField" AS ENUM ('GROSS_MARGIN_PERCENT', 'OPPORTUNITY_VALUE', 'PAYMENT_TERM_DAYS', 'DISCOUNT_PERCENT', 'COUNTRY_IS_NEW', 'SINGLE_SOURCE_SUPPLIER', 'FOREIGN_CURRENCY', 'SCOPE_NOT_READY');

-- CreateEnum
CREATE TYPE "ApprovalOperator" AS ENUM ('LESS_THAN', 'LESS_OR_EQUAL', 'GREATER_THAN', 'GREATER_OR_EQUAL', 'EQUALS', 'IS_TRUE');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'RETURNED_FOR_REVISION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT', 'RETURN_FOR_REVISION', 'APPROVE_WITH_CONDITIONS');

-- CreateEnum
CREATE TYPE "DiscountRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('BUDGETARY', 'INITIAL', 'REVISED', 'BAFO', 'FINAL', 'TECHNICAL', 'COMMERCIAL', 'COMBINED');

-- CreateEnum
CREATE TYPE "ProposalVersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUBMITTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "key" "ApprovalPolicyKey" NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "currency" TEXT,
    "country" TEXT,
    "orgUnitId" TEXT,
    "opportunityId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessProcess" "ApprovalProcess" NOT NULL,
    "country" TEXT,
    "orgUnitId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "approverRole" TEXT NOT NULL,
    "approvalType" "ApprovalType" NOT NULL DEFAULT 'SINGLE',
    "slaHours" INTEGER,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "escalationRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "conditionField" "ApprovalConditionField" NOT NULL,
    "operator" "ApprovalOperator" NOT NULL,
    "threshold" DECIMAL(18,4),
    "thresholdPolicyKey" "ApprovalPolicyKey",
    "requiredRole" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "currentStepId" TEXT,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "triggeredBy" JSONB,
    "policySnapshot" JSONB,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAction" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stepId" TEXT,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "conditions" TEXT,
    "delegatedFromId" TEXT,
    "actionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "requestedPercent" DECIMAL(6,2) NOT NULL,
    "fromPrice" DECIMAL(18,2) NOT NULL,
    "toPrice" DECIMAL(18,2) NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "DiscountRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DiscountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "bidId" TEXT,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVersion" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "type" "ProposalType" NOT NULL DEFAULT 'INITIAL',
    "costingVersionId" TEXT,
    "approvalRequestId" TEXT,
    "sellingPrice" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "validUntil" TIMESTAMP(3),
    "status" "ProposalVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "submissionMethod" TEXT,
    "submittedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProposalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalPolicy_key_country_idx" ON "ApprovalPolicy"("key", "country");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_opportunityId_idx" ON "ApprovalPolicy"("opportunityId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_effectiveFrom_idx" ON "ApprovalPolicy"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_code_key" ON "WorkflowDefinition"("code");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_businessProcess_country_idx" ON "WorkflowDefinition"("businessProcess", "country");

-- CreateIndex
CREATE INDEX "WorkflowStep_workflowId_sequence_idx" ON "WorkflowStep"("workflowId", "sequence");

-- CreateIndex
CREATE INDEX "ApprovalRule_workflowId_idx" ON "ApprovalRule"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_code_key" ON "ApprovalRequest"("code");

-- CreateIndex
CREATE INDEX "ApprovalRequest_recordType_recordId_idx" ON "ApprovalRequest"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_opportunityId_idx" ON "ApprovalRequest"("opportunityId");

-- CreateIndex
CREATE INDEX "ApprovalAction_requestId_idx" ON "ApprovalAction"("requestId");

-- CreateIndex
CREATE INDEX "ApprovalAction_approverId_idx" ON "ApprovalAction"("approverId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRequest_code_key" ON "DiscountRequest"("code");

-- CreateIndex
CREATE INDEX "DiscountRequest_opportunityId_idx" ON "DiscountRequest"("opportunityId");

-- CreateIndex
CREATE INDEX "DiscountRequest_status_idx" ON "DiscountRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_code_key" ON "Proposal"("code");

-- CreateIndex
CREATE INDEX "Proposal_opportunityId_idx" ON "Proposal"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVersion_proposalId_versionNumber_key" ON "ProposalVersion"("proposalId", "versionNumber");

-- CreateIndex
CREATE INDEX "ProposalVersion_proposalId_idx" ON "ProposalVersion"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalVersion_status_idx" ON "ProposalVersion"("status");

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "WorkflowStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "WorkflowStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_delegatedFromId_fkey" FOREIGN KEY ("delegatedFromId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRequest" ADD CONSTRAINT "DiscountRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_costingVersionId_fkey" FOREIGN KEY ("costingVersionId") REFERENCES "CostingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
