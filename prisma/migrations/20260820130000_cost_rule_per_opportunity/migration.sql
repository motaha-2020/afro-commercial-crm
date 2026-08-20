-- A cost rule may now be written for a single opportunity, which is the
-- narrowest scope there is and outranks org unit and country.
ALTER TABLE "CostRule" ADD COLUMN "opportunityId" TEXT;

-- CreateIndex
CREATE INDEX "CostRule_opportunityId_idx" ON "CostRule"("opportunityId");

-- AddForeignKey
ALTER TABLE "CostRule" ADD CONSTRAINT "CostRule_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
