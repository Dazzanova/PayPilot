#!/usr/bin/env bash
set -euo pipefail

: "${PAYPILOT_DB_NAME:?PAYPILOT_DB_NAME is required}"
: "${PAYPILOT_MIGRATOR_USER:?PAYPILOT_MIGRATOR_USER is required}"
: "${PAYPILOT_MIGRATOR_PASSWORD:?PAYPILOT_MIGRATOR_PASSWORD is required}"
: "${PAYPILOT_APP_USER:?PAYPILOT_APP_USER is required}"
: "${PAYPILOT_APP_PASSWORD:?PAYPILOT_APP_PASSWORD is required}"
: "${KEYCLOAK_DB_NAME:?KEYCLOAK_DB_NAME is required}"
: "${KEYCLOAK_DB_USER:?KEYCLOAK_DB_USER is required}"
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=migrator_user="$PAYPILOT_MIGRATOR_USER" \
  --set=migrator_password="$PAYPILOT_MIGRATOR_PASSWORD" \
  --set=app_user="$PAYPILOT_APP_USER" \
  --set=app_password="$PAYPILOT_APP_PASSWORD" \
  --set=app_db="$PAYPILOT_DB_NAME" \
  --set=keycloak_user="$KEYCLOAK_DB_USER" \
  --set=keycloak_password="$KEYCLOAK_DB_PASSWORD" \
  --set=keycloak_db="$KEYCLOAK_DB_NAME" <<'EOSQL'
CREATE ROLE :"migrator_user" LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE :"keycloak_user" LOGIN PASSWORD :'keycloak_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE DATABASE :"app_db" OWNER :"migrator_user";
CREATE DATABASE :"keycloak_db" OWNER :"keycloak_user";

REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"app_db" TO :"migrator_user", :"app_user";
REVOKE ALL ON DATABASE :"keycloak_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"keycloak_db" TO :"keycloak_user";
EOSQL

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$PAYPILOT_DB_NAME" \
  --set=migrator_user="$PAYPILOT_MIGRATOR_USER" \
  --set=app_user="$PAYPILOT_APP_USER" <<'EOSQL'
ALTER SCHEMA public OWNER TO :"migrator_user";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO :"migrator_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
EOSQL
