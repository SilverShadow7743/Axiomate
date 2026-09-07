-- Invoicing (docs/plans/2026-09-07-invoicing-design.md): turning a billable milestone into a
-- record. New tables get RLS in their own creation migration, per the discipline every table
-- since 20260824000004 has followed. No DML.

CREATE TABLE "Invoice" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sowId" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE TABLE "InvoiceLineItem" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("tenantId","id")
);

CREATE INDEX "Invoice_tenantId_sowId_idx" ON "Invoice"("tenantId", "sowId");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_sowId_fkey"
  FOREIGN KEY ("tenantId", "sowId") REFERENCES "Sow"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_tenantId_invoiceId_fkey"
  FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "Invoice"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "InvoiceLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLineItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceLineItem"
  USING ("tenantId" = current_setting('app.tenant_id', true));
