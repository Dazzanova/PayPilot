-- AlterTable: Add supabase_auth_id column to users table
-- This links internal application users to Supabase Auth identities

ALTER TABLE "users" ADD COLUMN "supabase_auth_id" TEXT;

-- Create unique constraint on supabase_auth_id
ALTER TABLE "users" ADD CONSTRAINT "users_supabase_auth_id_key" UNIQUE ("supabase_auth_id");

-- Create index on supabase_auth_id for fast lookups during authentication
CREATE INDEX "users_supabase_auth_id_idx" ON "users"("supabase_auth_id");
