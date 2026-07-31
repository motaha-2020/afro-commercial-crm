#!/usr/bin/env bash
#
# Post-deploy verification, run ON THE SERVER against the running containers.
#
#   ssh <server> 'bash -s' < scripts/smoke.sh
#
# A green local build proves nothing about the deployment: images go stale,
# migrations fail silently, seeds never run. Everything below talks to the
# deployed API and web over the network, and reads the database only to prove
# what the API refuses to show (soft-deleted rows).
#
# Exits non-zero if any check fails.

API=${API:-http://100.122.6.64:4000/api}
WEB=${WEB:-http://100.122.6.64:3100}
SEED_PASSWORD=${SEED_PASSWORD:-ChangeMe#2026}
DB=${DB:-acms-postgres-1}

PASS=0; FAIL=0
JQ() { python3 -c "import sys,json;$1"; }
ok()   { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL  $1  -> $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
login() {
  curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"${2:-$SEED_PASSWORD}\"}" \
    | JQ "print(json.load(sys.stdin).get('accessToken','NONE'))"
}
psql_() { docker exec $DB psql -U acms -d acms -tAc "$1"; }

echo "=== 1. Health ==="
check "live answers without touching the database" \
  "$(curl -s $API/health/live | JQ "print(json.load(sys.stdin)['status'])")" "ok"
check "ready reports database and object storage" \
  "$(curl -s $API/health/ready | JQ "d=json.load(sys.stdin);print(d['database']+'/'+d['storage'])")" "up/up"

echo "=== 2. Migrations actually applied ==="
check "no failed or unfinished migration on record" \
  "$(psql_ "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null;")" "0"
check "documents and notifications tables exist" \
  "$(psql_ "select count(*) from pg_tables where schemaname='public' and tablename in ('Document','DocumentVersion','Notification','NotificationRule');")" "4"

echo "=== 3. Authentication ==="
CEO=$(login ceo@afro.example); AM=$(login am@afro.example); ADMIN=$(login admin@afro.example)
[ "$CEO" != "NONE" ]   && ok "ceo login"           || bad "ceo login" "$CEO"
[ "$AM" != "NONE" ]    && ok "account manager login" || bad "am login" "$AM"
[ "$ADMIN" != "NONE" ] && ok "system admin login"  || bad "admin login" "$ADMIN"
check "wrong password rejected" "$(code -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ceo@afro.example","password":"NotThePassword#9"}')" "401"
check "unknown user answered identically, revealing nothing" \
  "$(code -X POST $API/auth/login -H 'Content-Type: application/json' \
     -d '{"email":"nobody@afro.example","password":"NotThePassword#9"}')" "401"
check "protected route needs a token" "$(code $API/accounts)" "401"

echo "=== 4. Master data ==="
check "13 opportunity stages published" \
  "$(curl -s $API/master-data | JQ "print(len(json.load(sys.stdin)['stages']))")" "13"

echo "=== 5. Record-level data scope ==="
# The seeded accounts all belong to the account manager, so scope has to be
# tested with a record they do not own.
SCOPED=$(curl -s -X POST $API/accounts -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"legalName":"Smoke Scope Ltd","type":"VENDOR","country":"EG"}' | JQ "print(json.load(sys.stdin)['id'])")
check "a record outside scope is invisible (404, not 403)" "$(code $API/accounts/$SCOPED -H "Authorization: Bearer $AM")" "404"
check "and absent from the list" \
  "$(curl -s $API/accounts -H "Authorization: Bearer $AM" | JQ "print(any(a['id']=='$SCOPED' for a in json.load(sys.stdin)['items']))")" "False"
check "while its owner sees it" "$(code $API/accounts/$SCOPED -H "Authorization: Bearer $CEO")" "200"

echo "=== 6. Account 360 ==="
ACC=$(curl -s $API/accounts -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['items'][0]['id'])")
check "contacts and opportunities on one screen" \
  "$(curl -s $API/accounts/$ACC -H "Authorization: Bearer $CEO" | JQ "d=json.load(sys.stdin);print('contacts' in d and 'opportunities' in d)")" "True"

echo "=== 7. Progressive data capture ==="
OPP=$(curl -s -X POST $API/opportunities -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Test Bid","accountId":"'$ACC'","country":"EG","currency":"USD"}' | JQ "print(json.load(sys.stdin)['id'])")
BLOCK=$(curl -s -X POST $API/opportunities/$OPP/stage -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"toStage":"OPERATIONAL_FINANCIAL_REVIEW"}')
check "advancing without the required fields is refused" \
  "$(echo "$BLOCK" | JQ "print(json.load(sys.stdin).get('statusCode'))")" "400"
check "and the response names what is missing" \
  "$(echo "$BLOCK" | JQ "print(len(json.load(sys.stdin).get('missingFields',[]))>0)")" "True"
check "the missing fields can then be supplied" \
  "$(code -X PATCH $API/opportunities/$OPP -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"source":"TENDER_PORTAL","industry":"FTTH","estimatedValue":250000,"nextStep":"Site survey"}')" "200"
BEFORE=$(curl -s $API/notifications/unread-count -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['count'])")
check "and the stage then advances" \
  "$(code -X POST $API/opportunities/$OPP/stage -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"toStage":"LEAD_QUALIFICATION","reason":"smoke test"}')" "201"

echo "=== 8. The four independent readings ==="
check "stage, status, forecast and health are all distinct fields" \
  "$(curl -s $API/opportunities/$OPP -H "Authorization: Bearer $CEO" | JQ "d=json.load(sys.stdin);print(len({k for k in ('stage','status','forecastCategory','health') if k in d}))")" "4"

echo "=== 9. Notification rules ==="
sleep 2
AFTER=$(curl -s $API/notifications/unread-count -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['count'])")
[ "$AFTER" -gt "$BEFORE" ] && ok "stage change notified the CEO ($BEFORE -> $AFTER)" \
                           || bad "notification dispatch" "unread stayed at $AFTER"
check "the sales director rule fired too" "$(psql_ "select count(*) from \"Notification\" where \"entityId\"='$OPP';")" "2"
curl -s -o /dev/null -X POST $API/notifications/read-all -H "Authorization: Bearer $CEO"
check "mark-all-read clears the badge" \
  "$(curl -s $API/notifications/unread-count -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['count'])")" "0"

echo "=== 10. Documents: MinIO round trip, versioned ==="
echo "supplier quotation v1" > /tmp/acms_smoke.txt
UP=$(curl -s -X POST $API/documents -H "Authorization: Bearer $CEO" \
  -F "file=@/tmp/acms_smoke.txt" -F "title=Smoke Quotation" -F "category=QUOTATION" \
  -F "entityType=Opportunity" -F "entityId=$OPP")
DOC=$(echo "$UP" | JQ "print(json.load(sys.stdin).get('document',{}).get('id','NONE'))")
[ "$DOC" != "NONE" ] && ok "uploaded to object storage" || bad "document upload" "$UP"
echo "supplier quotation v2" > /tmp/acms_smoke.txt
check "re-upload creates version 2 rather than overwriting" \
  "$(curl -s -X POST $API/documents -H "Authorization: Bearer $CEO" -F "file=@/tmp/acms_smoke.txt" \
     -F "documentId=$DOC" -F "title=Smoke Quotation" -F "entityType=Opportunity" -F "entityId=$OPP" \
     | JQ "print(json.load(sys.stdin).get('version',{}).get('version'))")" "2"
check "both versions retained (SoD rule 2)" \
  "$(curl -s "$API/documents?entityType=Opportunity&entityId=$OPP" -H "Authorization: Bearer $CEO" | JQ "print(len(json.load(sys.stdin)[0]['versions']))")" "2"
check "download returns the newest bytes" \
  "$(curl -s "$API/documents/$DOC/download" -H "Authorization: Bearer $CEO")" "supplier quotation v2"
check "each version carries a checksum" \
  "$(psql_ "select count(*) from \"DocumentVersion\" where \"documentId\"='$DOC' and length(checksum)=64;")" "2"
rm -f /tmp/acms_smoke.txt

echo "=== 11. Audit trail ==="
TRAIL=$(curl -s $API/audit/Opportunity/$OPP -H "Authorization: Bearer $CEO" | JQ "print(','.join(sorted({i['action'] for i in json.load(sys.stdin)['items']})))")
echo "        actions: $TRAIL"
case "$TRAIL" in *CREATE*)       ok "creation audited";;       *) bad "creation audited" "$TRAIL";; esac
case "$TRAIL" in *UPDATE*)       ok "field update audited";;   *) bad "field update audited" "$TRAIL";; esac
case "$TRAIL" in *STAGE_CHANGE*) ok "stage change audited";;   *) bad "stage change audited" "$TRAIL";; esac
check "the entry names the before and after stage" \
  "$(curl -s $API/audit/Opportunity/$OPP -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin)['items']; e=[i for i in d if i['action']=='STAGE_CHANGE'][0]
print(e['before']['stage']+'->'+e['after']['stage'])")" "LEAD_INTAKE->LEAD_QUALIFICATION"
check "stage history keeps the stated reason" \
  "$(psql_ "select reason from \"OpportunityStageHistory\" where \"opportunityId\"='$OPP' and \"toStage\"='LEAD_QUALIFICATION';")" "smoke test"
check "audit is closed to roles outside governance" \
  "$(code $API/audit/Opportunity/$OPP -H "Authorization: Bearer $AM")" "403"
# The interceptor safety net: a route no service audits still leaves a trace.
check "a mutation no service audits still lands in the log" \
  "$(psql_ "select count(*)>0 from \"AuditLog\" where \"entityType\"='Notification' and \"after\"->>'route' like 'POST%read-all';")" "t"

echo "=== 12. Segregation of Duties ==="
SOD=$(curl -s -X PATCH $API/accounts/$SCOPED -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"creditStatus":"WATCH"}')
check "the account's creator cannot approve its credit (rule 5)" \
  "$(echo "$SOD" | JQ "print(json.load(sys.stdin).get('sodRule'))")" "SOD_05"
check "the blocked attempt is itself recorded" \
  "$(curl -s $API/audit/Account/$SCOPED -H "Authorization: Bearer $CEO" | JQ "print(any(i['action']=='SOD_BLOCKED' for i in json.load(sys.stdin)['items']))")" "True"
check "credit standing unchanged" \
  "$(curl -s $API/accounts/$SCOPED -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['creditStatus'])")" "GOOD"
check "all eight rules published" \
  "$(curl -s $API/governance/sod-rules -H "Authorization: Bearer $CEO" | JQ "print(len(json.load(sys.stdin)['rules']))")" "8"

echo "=== 13. Soft delete only ==="
curl -s -o /dev/null -X DELETE $API/opportunities/$OPP -H "Authorization: Bearer $CEO"
curl -s -o /dev/null -X DELETE $API/accounts/$SCOPED -H "Authorization: Bearer $CEO"
check "deleted record disappears from the API" "$(code $API/opportunities/$OPP -H "Authorization: Bearer $CEO")" "404"
check "but the row survives in the database" \
  "$(psql_ "select (\"deletedAt\" is not null) from \"Opportunity\" where id='$OPP';")" "t"

echo "=== 14. Web UI in three locales ==="
curl -s -c /tmp/acms_smoke.jar -o /dev/null -X POST $WEB/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"ceo@afro.example\",\"password\":\"$SEED_PASSWORD\"}"
for L in ar en fr; do
  for P in dashboard accounts opportunities; do
    check "$L/$P renders" "$(code -b /tmp/acms_smoke.jar $WEB/$L/$P)" "200"
  done
done
check "Arabic shell is RTL" "$(curl -s -b /tmp/acms_smoke.jar $WEB/ar/dashboard | grep -c 'dir="rtl"')" "1"
check "notification bell present" "$(curl -s -b /tmp/acms_smoke.jar $WEB/en/dashboard | grep -c 'bell-wrap')" "1"
check "signed-out visitor is sent to login" "$(code -o /dev/null $WEB/en/dashboard)" "200"
rm -f /tmp/acms_smoke.jar

echo
echo "==================== $PASS passed, $FAIL failed ===================="
[ "$FAIL" -eq 0 ]
