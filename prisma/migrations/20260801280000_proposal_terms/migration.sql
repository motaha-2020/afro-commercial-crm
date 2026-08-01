-- Structured commercial terms on a proposal version.
--
-- Release 7's contract review compares a contract with the proposal it is
-- supposed to embody, but a proposal carried only a price — so payment terms,
-- duration, warranty, penalties and liability were each compared against
-- nothing, and the deviation engine could only ever report on price.

ALTER TABLE "ProposalVersion" ADD COLUMN "paymentTerms" TEXT;
ALTER TABLE "ProposalVersion" ADD COLUMN "durationDays" INTEGER;
ALTER TABLE "ProposalVersion" ADD COLUMN "warrantyMonths" INTEGER;
ALTER TABLE "ProposalVersion" ADD COLUMN "ldPercent" DECIMAL(6,2);
ALTER TABLE "ProposalVersion" ADD COLUMN "liabilityCap" DECIMAL(18,2);
