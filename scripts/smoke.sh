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
#
# It writes: each run creates a probe account, opportunity and document, then
# soft-deletes them — so the rows and their MinIO objects remain by design (the
# audit trail is append-only and nothing is ever hard-deleted). Harmless on the
# demo deployment; on a live one, expect the residue.

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

echo "=== 13. Release 3: scope, tenders, Bid/No-Bid ==="
PKG=$(curl -s -X POST $API/opportunities/$OPP/scope/packages -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Material Supply","category":"SUPPLY","description":"Cable, cabinets, accessories"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
PARENT=$(curl -s -X POST $API/scope/packages/$PKG/items -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Cabinet Installation","quantity":120,"unit":"pcs"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
CHILD=$(curl -s -X POST $API/scope/packages/$PKG/items -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Concrete Base","parentId":"'$PARENT'","quantity":120,"unit":"pcs"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "the scope tree nests a child under its parent" \
  "$(curl -s $API/opportunities/$OPP/scope -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); p=d['packages'][0]['items'][0]; print(p['name']+'>'+p['children'][0]['name'])")" \
  "Cabinet Installation>Concrete Base"
check "an item cannot be re-parented under its own child" \
  "$(code -X PATCH $API/scope/items/$PARENT -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"parentId":"'$CHILD'"}')" "400"

curl -s -o /dev/null -X POST $API/opportunities/$OPP/assumptions -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"description":"Customer provides site access before mobilisation","category":"SITE_ACCESS","impactIfIncorrect":"Two-week delay"}'
CLAR=$(curl -s -X POST $API/opportunities/$OPP/clarifications -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"question":"Is the duct route already permitted?","impact":"BLOCKING"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "a blocking question makes the scope unfit to price" \
  "$(curl -s $API/opportunities/$OPP/scope -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['readiness']['ready'])")" "False"
curl -s -o /dev/null -X PATCH $API/clarifications/$CLAR -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"response":"Yes, permits issued in March","impact":"LOW"}'
check "answering it clears the block" \
  "$(curl -s $API/opportunities/$OPP/scope -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['readiness']['ready'])")" "True"
check "and the answer timestamps itself" \
  "$(curl -s $API/opportunities/$OPP/scope -H "Authorization: Bearer $CEO" | JQ "
c=json.load(sys.stdin)['clarifications'][0]; print(c['status']+'/'+str(c['respondedAt'] is not None))")" "ANSWERED/True"

BID=$(curl -s -X POST $API/opportunities/$OPP/bids -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"type":"PUBLIC_TENDER","tenderNumber":"TND-SMOKE-1","submissionDeadline":"2026-12-01T00:00:00Z","clarificationDeadline":"2026-11-01T00:00:00Z"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
[ -n "$BID" ] && ok "tender registered" || bad "tender registered" "no id"
check "a clarification deadline after the submission deadline is refused" \
  "$(code -X POST $API/opportunities/$OPP/bids -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"type":"RFQ","submissionDeadline":"2026-10-01T00:00:00Z","clarificationDeadline":"2026-11-01T00:00:00Z"}')" "400"
curl -s -o /dev/null -X POST $API/bids/$BID/requirements -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"description":"Tax clearance certificate","type":"LEGAL","mandatory":true}'
curl -s -o /dev/null -X POST $API/bids/$BID/requirements -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"description":"Company profile","type":"ADMINISTRATIVE","mandatory":false}'
check "the checklist counts mandatory items separately" \
  "$(curl -s $API/opportunities/$OPP/bids -H "Authorization: Bearer $CEO" | JQ "
c=json.load(sys.stdin)[0]['checklist']; print(str(c['total'])+'/'+str(c['mandatoryTotal'])+'/'+str(c['mandatoryOutstanding']))")" "2/1/1"
check "the deadline view finds it within the window" \
  "$(curl -s "$API/bids/deadlines?days=365" -H "Authorization: Bearer $CEO" | JQ "print(any(b['id']=='$BID' for b in json.load(sys.stdin)))")" "True"

check "eight scoring factors, weights totalling 100" \
  "$(curl -s $API/bid-weights -H "Authorization: Bearer $CEO" | JQ "d=json.load(sys.stdin);print(str(len(d['factors']))+'/'+str(d['total']))")" "8/100"
ASSESS=$(curl -s -X POST $API/opportunities/$OPP/bid-assessment -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"ratings":{"RELATIONSHIP_STRENGTH":5,"TECHNICAL_FIT":5,"DELIVERY_CAPACITY":4,"EXPECTED_PROFITABILITY":4,"PAYMENT_TERMS":3,"COMPETITION":3,"SCOPE_CLARITY":4,"STRATEGIC_VALUE":5}}')
AID=$(echo "$ASSESS" | JQ "print(json.load(sys.stdin)['id'])")
# 15·1 + 15·1 + 15·0.8 + 15·0.8 + 10·0.6 + 10·0.6 + 10·0.8 + 10·1 = 84
check "the weighted score lands where the maths says" \
  "$(echo "$ASSESS" | JQ "print(json.load(sys.stdin)['score'])")" "84"
check "and suggests a decision without applying one" \
  "$(echo "$ASSESS" | JQ "d=json.load(sys.stdin);print(d['suggestedDecision']+'/'+str(d['decision']))")" "BID/None"
check "the score is written back for the stage gate" \
  "$(curl -s $API/opportunities/$OPP -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['bidNoBidScore'])")" "84"
check "an unknown scoring factor is rejected" \
  "$(code -X POST $API/opportunities/$OPP/bid-assessment -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"ratings":{"GUT_FEELING":5}}')" "400"
check "walking away from an 84-point bid needs a reason" \
  "$(code -X POST $API/bid-assessments/$AID/decision -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"decision":"NO_BID"}')" "400"
check "with a reason it is recorded" \
  "$(curl -s -X POST $API/bid-assessments/$AID/decision -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' \
     -d '{"decision":"NO_BID","rationale":"Customer payment history is unacceptable despite the score"}' \
     | JQ "print(json.load(sys.stdin)['decision'])")" "NO_BID"
check "the override is flagged as one in the audit trail" \
  "$(psql_ "select count(*)>0 from \"AuditLog\" where \"entityType\"='BidAssessment' and \"after\"->>'overrode'='true';")" "t"
check "the assessment keeps the weights it was scored under" \
  "$(psql_ "select (weights->>'TECHNICAL_FIT') from \"BidAssessment\" where id='$AID';")" "15"
check "re-weighting is closed to roles without commercial authority" \
  "$(code -X PATCH $API/bid-weights -H "Authorization: Bearer $AM" -H 'Content-Type: application/json' \
     -d '{"weights":{"TECHNICAL_FIT":100}}')" "403"
check "and weights that do not total 100 are refused" \
  "$(code -X PATCH $API/bid-weights -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"weights":{"TECHNICAL_FIT":100}}')" "400"
check "scope of another team stays invisible here too" \
  "$(code $API/opportunities/$OPP/scope -H "Authorization: Bearer $AM")" "404"

echo "=== 14. Release 4: costing, pricing and the locking rule ==="
FIN=$(login finance@afro.example)
# The seeded estimator is scoped to a business unit and cannot see this
# opportunity at all, so the CEO who owns it plays the author here.
SCN=$(curl -s -X POST $API/opportunities/$OPP/costing -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Self execution","type":"SELF_EXECUTION","currency":"EGP"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
VER=$(curl -s -X POST $API/costing/scenarios/$SCN/versions -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{}' | JQ "print(json.load(sys.stdin)['id'])")
CPKG=$(curl -s -X POST $API/costing/versions/$VER/packages -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Civil works","type":"CIVIL_WORKS"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "an empty version cannot be submitted for approval" \
  "$(code -X POST $API/costing/versions/$VER/submit -H "Authorization: Bearer $CEO")" "400"

# Cost 100 on the line; a 20% target margin must price it at 125 — the spec's
# own worked example, and the thing markup would get wrong (it would say 120).
ITEM=$(curl -s -X POST $API/costing/packages/$CPKG/items -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"description":"Trenching","quantity":1,"unit":"km"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/costing/items/$ITEM/breakdown -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"quantity":1,"unitCost":100,"source":"SUBCONTRACTOR_QUOTE","description":"Civil crew"}'
curl -s -o /dev/null -X PATCH $API/costing/items/$ITEM -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"targetMarginPercent":20}'
check "a 20% target margin prices cost 100 at 125, not 120" \
  "$(curl -s $API/costing/versions/$VER -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print(str(float(d['totals']['totalCost']))+'/'+str(float(d['totals']['totalPrice'])))")" "100.0/125.0"
check "and reports margin and markup side by side" \
  "$(curl -s $API/costing/versions/$VER -H "Authorization: Bearer $CEO" | JQ "
t=json.load(sys.stdin)['totals']; print(str(t['marginPercent'])+'/'+str(t['markupPercent']))")" "20/25"
check "waste and productivity reach the line total" \
  "$(curl -s -X POST $API/costing/items/$ITEM/breakdown -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' \
     -d '{"quantity":600,"unitCost":800,"productivityRate":150,"source":"MANUAL_ESTIMATE"}' \
     | JQ "print(float(json.load(sys.stdin)['totalCost']))")" "3200.0"
check "confidence is weighted by money, not by line count" \
  "$(curl -s $API/costing/versions/$VER -H "Authorization: Bearer $CEO" | JQ "
c=json.load(sys.stdin)['confidence']; print(c['estimatedShare']>90)")" "True"

curl -s -o /dev/null -X POST $API/costing/versions/$VER/submit -H "Authorization: Bearer $CEO"
check "whoever built the costing cannot approve it (SoD rule 1)" \
  "$(curl -s -X POST $API/costing/versions/$VER/approve -H "Authorization: Bearer $CEO" \
     | JQ "print(json.load(sys.stdin).get('sodRule'))")" "SOD_01"
# The spec is explicit that a system administrator is technical, not a
# commercial decision maker — and GROUP scope does not soften that. The account
# manager is the wrong test here: they cannot see this opportunity at all, so
# scoping answers 404 long before authority is ever consulted.
check "nor can a system administrator, who is technical not commercial" \
  "$(code -X POST $API/costing/versions/$VER/approve -H "Authorization: Bearer $ADMIN")" "403"
check "finance approves it" \
  "$(curl -s -X POST $API/costing/versions/$VER/approve -H "Authorization: Bearer $FIN" \
     | JQ "print(json.load(sys.stdin)['status'])")" "APPROVED"
check "and it is locked" \
  "$(psql_ "select (\"lockedAt\" is not null) from \"CostingVersion\" where id='$VER';")" "t"
check "an approved version refuses every edit" \
  "$(code -X POST $API/costing/versions/$VER/packages -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"name":"Sneaky extra"}')" "409"
check "even a breakdown line deep inside it" \
  "$(code -X POST $API/costing/items/$ITEM/breakdown -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"quantity":1,"unitCost":1}')" "409"

V2=$(curl -s -X POST $API/costing/scenarios/$SCN/versions -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"revisionReason":"Client cut the scope","cloneFromVersionId":"'$VER'"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "the sanctioned way forward is a new version, and it carries the work over" \
  "$(curl -s $API/costing/versions/$V2 -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print(str(len(d['packages']))+'/'+str(len(d['packages'][0]['items'])))")" "1/1"
check "the clone is editable" \
  "$(code -X POST $API/costing/versions/$V2/packages -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"name":"Second package"}')" "201"

check "the cost element library is seeded" \
  "$(curl -s $API/cost-elements -H "Authorization: Bearer $CEO" | JQ "print(len(json.load(sys.stdin))>=19)")" "True"
check "an account manager cannot rewrite standard rates" \
  "$(code -X POST $API/resources -H "Authorization: Bearer $AM" -H 'Content-Type: application/json' \
     -d '{"code":"RES-PM","type":"LABOR","nameAr":"x","nameEn":"x","unit":"month","standardCost":1,"effectiveFrom":"2026-06-01T00:00:00Z"}')" "403"
curl -s -o /dev/null -X POST $API/resources -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d '{"code":"RES-PM","type":"LABOR","nameAr":"مدير مشروع","nameEn":"Project manager","unit":"month","standardCost":41000,"currency":"EGP","effectiveFrom":"2026-07-01T00:00:00Z"}'
check "a new rate supersedes the old one without erasing it" \
  "$(curl -s $API/resources/RES-PM/history -H "Authorization: Bearer $CEO" | JQ "print(len(json.load(sys.stdin)))")" "2"
check "and today's lookup returns the new price" \
  "$(curl -s "$API/resources?code=RES-PM" -H "Authorization: Bearer $CEO" | JQ "print(float(json.load(sys.stdin)[0]['standardCost']))")" "41000.0"
check "while the old price is still answerable as of its own date" \
  "$(curl -s "$API/resources?code=RES-PM&asOf=2026-03-01" -H "Authorization: Bearer $CEO" | JQ "print(float(json.load(sys.stdin)[0]['standardCost']))")" "38000.0"
check "all eight SoD rules are now published with rule 1 enforced" \
  "$(curl -s $API/governance/sod-rules -H "Authorization: Bearer $CEO" | JQ "
r=[x for x in json.load(sys.stdin)['rules'] if x['code']=='SOD_01'][0]; print(r['enforced'])")" "True"

echo "=== 15. Soft delete only ==="
curl -s -o /dev/null -X DELETE $API/opportunities/$OPP -H "Authorization: Bearer $CEO"
curl -s -o /dev/null -X DELETE $API/accounts/$SCOPED -H "Authorization: Bearer $CEO"
check "deleted record disappears from the API" "$(code $API/opportunities/$OPP -H "Authorization: Bearer $CEO")" "404"
check "but the row survives in the database" \
  "$(psql_ "select (\"deletedAt\" is not null) from \"Opportunity\" where id='$OPP';")" "t"

echo "=== 16. Web UI in three locales ==="
curl -s -c /tmp/acms_smoke.jar -o /dev/null -X POST $WEB/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"ceo@afro.example\",\"password\":\"$SEED_PASSWORD\"}"
for L in ar en fr; do
  for P in dashboard accounts opportunities; do
    check "$L/$P renders" "$(code -b /tmp/acms_smoke.jar $WEB/$L/$P)" "200"
  done
done
check "Arabic shell is RTL" "$(curl -s -b /tmp/acms_smoke.jar $WEB/ar/dashboard | grep -c 'dir="rtl"')" "1"
check "notification bell present" "$(curl -s -b /tmp/acms_smoke.jar $WEB/en/dashboard | grep -c 'bell-wrap')" "1"
check "signed-out visitor is redirected" "$(code $WEB/en/dashboard)" "307"
check "and lands on the login page" \
  "$(curl -sL $WEB/en/dashboard | grep -c 'type="password"')" "1"
rm -f /tmp/acms_smoke.jar

echo
echo "==================== $PASS passed, $FAIL failed ===================="
[ "$FAIL" -eq 0 ]
