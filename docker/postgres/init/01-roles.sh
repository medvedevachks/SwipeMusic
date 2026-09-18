#!/bin/sh
set -eu

ident_ok() {
  echo "$1" | grep -Eq '^[a-zA-Z_][a-zA-Z0-9_]*$'
}

ident_ok "$POSTGRES_APP_USER"
ident_ok "$POSTGRES_DB"
ident_ok "$POSTGRES_USER"
TEST_DB="${POSTGRES_TEST_DB:-swipe_music_test}"
ident_ok "$TEST_DB"

APP_PASSWORD_ESC=$(printf "%s" "$POSTGRES_APP_PASSWORD" | sed "s/'/''/g")

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_APP_USER}') THEN
    CREATE ROLE ${POSTGRES_APP_USER} LOGIN PASSWORD '${APP_PASSWORD_ESC}';
  END IF;
END
\$\$;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_APP_USER};
EOF

if ! psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'" | grep -q 1; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -c "CREATE DATABASE ${TEST_DB} OWNER ${POSTGRES_USER}"
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -c "GRANT CONNECT ON DATABASE ${TEST_DB} TO ${POSTGRES_APP_USER}"
