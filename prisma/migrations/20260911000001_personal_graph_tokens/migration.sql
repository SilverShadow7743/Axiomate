-- Durable personal Graph tokens (docs/plans/2026-09-11-durable-personal-graph-tokens-design.md):
-- one sealed REFRESH token per person per tenant, so an app restart no longer costs everyone a
-- reconnect. Ciphertext only — AES-256-GCM under a key derived from the session secret, which
-- lives in App Service configuration and never in this database. RLS in the creation
-- migration, per the discipline every table since 20260824000004 has followed. Additive, no DML:
-- rows appear as people sign in.

CREATE TABLE "PersonalGraphToken" (
    "tenantId" TEXT NOT NULL,
    "oid" TEXT NOT NULL,
    "refreshCiphertext" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalGraphToken_pkey" PRIMARY KEY ("tenantId","oid")
);

ALTER TABLE "PersonalGraphToken" ADD CONSTRAINT "PersonalGraphToken_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PersonalGraphToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PersonalGraphToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PersonalGraphToken"
  USING ("tenantId" = current_setting('app.tenant_id', true));
