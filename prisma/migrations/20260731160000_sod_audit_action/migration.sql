-- AlterEnum
-- Blocked Segregation of Duties attempts are recorded in the audit trail, so
-- the action needs a name of its own rather than being filed under UPDATE.
ALTER TYPE "AuditAction" ADD VALUE 'SOD_BLOCKED';
