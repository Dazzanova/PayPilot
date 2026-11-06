-- Replace any Supabase-specific identity storage with a provider-neutral OIDC
-- mapping. On a fresh native PostgreSQL baseline there is no legacy column;
-- on a database upgraded from the Supabase era, existing subjects are retained
-- under a legacy issuer and are not trusted for Keycloak authentication.
-- They must be re-provisioned deliberately.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "identity_issuer" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "identity_subject" TEXT;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'supabase_auth_id'
  ) THEN
    EXECUTE $sql$
      UPDATE "users"
      SET "identity_issuer" = 'supabase',
          "identity_subject" = "supabase_auth_id"
      WHERE "supabase_auth_id" IS NOT NULL
    $sql$;

    ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_supabase_auth_id_key";
    DROP INDEX IF EXISTS "users_supabase_auth_id_idx";
    ALTER TABLE "users" DROP COLUMN "supabase_auth_id";
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS "users_identity_issuer_identity_subject_key"
  ON "users"("identity_issuer", "identity_subject");

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_identity_pair_check'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_identity_pair_check"
      CHECK (("identity_issuer" IS NULL) = ("identity_subject" IS NULL));
  END IF;
END
$migration$;
