-- The runtime role must not be able to read or modify Prisma's migration
-- history. The broad table grant in the RLS migration also covers
-- _prisma_migrations because it lives in the public schema, so revoke it
-- explicitly.
REVOKE ALL ON TABLE public._prisma_migrations FROM paypilot_app;
