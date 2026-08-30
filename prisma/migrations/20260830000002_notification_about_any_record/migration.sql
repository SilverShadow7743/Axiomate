-- Notification.aboutId now names any record — an issue, a commitment (leave), or a
-- timesheet — so the issue foreign key comes off. E2's approval traffic is about records
-- that are not issues, and this constraint refused the first leave-requested row it met.
-- No DML: existing rows all reference issues and remain valid as plain references.
-- Deletion hygiene is unaffected: nothing hard-deletes issues outside the proof harness,
-- which already removes notifications explicitly before their issues.
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_tenantId_aboutId_fkey";
