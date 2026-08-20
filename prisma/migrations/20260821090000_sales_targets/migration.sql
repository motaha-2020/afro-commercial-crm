-- CreateEnum
CREATE TYPE "TargetMetric" AS ENUM ('WON_VALUE', 'WON_COUNT', 'PIPELINE_VALUE');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateTable
CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "orgUnitId" TEXT,
    "period" "TargetPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "metric" "TargetMetric" NOT NULL,
    "currency" TEXT,
    "value" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesTarget_userId_periodStart_idx" ON "SalesTarget"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "SalesTarget_orgUnitId_periodStart_idx" ON "SalesTarget"("orgUnitId", "periodStart");

-- CreateIndex
CREATE INDEX "SalesTarget_metric_periodStart_idx" ON "SalesTarget"("metric", "periodStart");

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
