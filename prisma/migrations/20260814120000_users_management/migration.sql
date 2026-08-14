-- Users management: temporary-password lifecycle for admin-created accounts.
-- Two columns on "User": a force-change flag and the timestamp of the last
-- self-service change. Both are additive and safe on a populated table.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
