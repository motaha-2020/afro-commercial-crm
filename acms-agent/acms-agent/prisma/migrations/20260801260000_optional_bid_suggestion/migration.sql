-- The Bid/No-Bid bands moved into the approval-policy settings, so a scored
-- assessment can legitimately have no suggestion: the score is real, but where
-- Afro draws the line is theirs to set and may not be set yet.
ALTER TABLE "BidAssessment" ALTER COLUMN "suggestedDecision" DROP NOT NULL;
