-- Lead gains an organisation unit so the six-level data scope applies to it the
-- same way it does to accounts and opportunities. Without it a BUSINESS_UNIT or
-- LEGAL_ENTITY scope filter has no column to match on and would silently widen
-- to everything. NOT NULL with no default on purpose: the table has never had an
-- API, so it is empty, and a migration that fails loudly beats one that invents
-- an owning unit for a real row.
ALTER TABLE "Lead" ADD COLUMN "orgUnitId" TEXT NOT NULL;

ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_orgUnitId_fkey"
  FOREIGN KEY ("orgUnitId") REFERENCES "OrganizationUnit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Lead_orgUnitId_idx" ON "Lead"("orgUnitId");

-- Removing a contact's role is a soft delete like everything else. Paired with
-- the existing unique (contactId, roleCode), re-adding a removed role restores
-- the original row instead of creating a duplicate.
ALTER TABLE "ContactRole" ADD COLUMN "deletedAt" TIMESTAMP(3);
