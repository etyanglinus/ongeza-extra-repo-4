#!/usr/bin/env bash
# Backup restore drill: dump the live database, restore it into a scratch database, and prove the
# restored copy is usable (ledger hash chain and balances verify). Run quarterly and after any
# change to backups; record the timings as the measured RPO/RTO in the operations log.
#
#   SOURCE_URL=postgres://user:pass@host:5432/ongeza \
#   SCRATCH_URL=postgres://user:pass@host:5432/ongeza_restore_drill \
#   APP_DIR=/srv/ongeza-admin ./scripts/restore-drill.sh
set -euo pipefail
: "${SOURCE_URL:?set SOURCE_URL}" "${SCRATCH_URL:?set SCRATCH_URL}" "${APP_DIR:?set APP_DIR}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
start=$(date +%s)
echo "1/4 Dumping source (custom format, consistent snapshot)..."
pg_dump --format=custom --no-owner --no-privileges --file="$work/drill.dump" "$SOURCE_URL"
dumped=$(date +%s)
echo "2/4 Restoring into scratch database..."
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$SCRATCH_URL" "$work/drill.dump"
restored=$(date +%s)
echo "3/4 Verifying the restored ledger..."
proto_rest="${SCRATCH_URL#postgres://}"; creds="${proto_rest%%@*}"; hostdb="${proto_rest#*@}"
export DB_CONNECTION=pgsql DB_USERNAME="${creds%%:*}" DB_PASSWORD="${creds#*:}" DB_HOST="${hostdb%%:*}"
portdb="${hostdb#*:}"; export DB_PORT="${portdb%%/*}" DB_DATABASE="${portdb#*/}"
(cd "$APP_DIR" && php artisan omnibus:verify-ledger)
echo "4/4 Comparing row counts..."
for table in omnibus_journals omnibus_cash_postings omnibus_unit_postings omnibus_orders omnibus_loans users; do
  a=$(psql "$SOURCE_URL" -tAc "select count(*) from $table"); b=$(psql "$SCRATCH_URL" -tAc "select count(*) from $table")
  printf '  %-24s source=%-8s restored=%-8s %s\n' "$table" "$a" "$b" "$([ "$a" = "$b" ] && echo OK || echo MISMATCH)"
  [ "$a" = "$b" ]
done
echo "Drill passed: dump $((dumped-start))s, restore $((restored-dumped))s, total $(( $(date +%s)-start ))s, size $(du -h "$work/drill.dump" | cut -f1)."
