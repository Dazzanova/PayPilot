-- Employee directory constraints.
-- The unique email index fails loudly if legacy rows contain duplicates;
-- resolve duplicates in data, do not weaken the constraint.

CREATE UNIQUE INDEX "employees_organization_id_email_key"
  ON "employees" ("organization_id", "email");

CREATE INDEX "employees_organization_id_status_idx"
  ON "employees" ("organization_id", "status");
