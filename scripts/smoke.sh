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
# The Bid/No-Bid bands are settings now, so they have to be set before a
# suggestion exists. Scoped to Egypt, which leaves other countries unset — and
# section 18 relies on that to prove the unconfigured case.
curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"key":"BID_GO_THRESHOLD","value":70,"country":"EG"}'
curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"key":"BID_CONDITIONAL_THRESHOLD","value":55,"country":"EG"}'
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
d=json.load(sys.stdin); print(str(float(d['totals']['directCost']))+'/'+str(float(d['totals']['totalPrice'])))")" "100.0/125.0"
check "and reports margin and markup side by side" \
  "$(curl -s $API/costing/versions/$VER -H "Authorization: Bearer $CEO" | JQ "
t=json.load(sys.stdin)['totals']; print(str(t['marginPercentDirect'])+'/'+str(t['markupPercent']))")" "20/25"
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

echo "=== 15. Release 2 completion: contacts, leads and activities ==="
CONTACT=$(curl -s -X POST $API/contacts -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"accountId":"'$ACC'","fullName":"Smoke Contact","jobTitle":"Procurement Lead","email":"smoke@example.com","influence":"HIGH","isPrimary":true,"roles":["TECHNICAL_EVALUATOR","COMMERCIAL_EVALUATOR"]}' \
  | JQ "print(json.load(sys.stdin)['id'])")
[ "$CONTACT" != "None" ] && ok "contact created on an account" || bad "contact create" "$CONTACT"
check "one person holds both evaluator roles, because roles are rows" \
  "$(curl -s $API/contacts/$CONTACT -H "Authorization: Bearer $CEO" | JQ "print(len(json.load(sys.stdin)['roles']))")" "2"
check "a removed role is soft-deleted, not erased" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $API/contacts/$CONTACT/roles/BLOCKER -H "Authorization: Bearer $CEO")" "404"
curl -s -o /dev/null -X DELETE $API/contacts/$CONTACT/roles/TECHNICAL_EVALUATOR -H "Authorization: Bearer $CEO"
check "and re-granting it revives the same row rather than duplicating it" \
  "$(curl -s -X POST $API/contacts/$CONTACT/roles -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"roleCode":"TECHNICAL_EVALUATOR"}' >/dev/null; psql_ "select count(*) from \"ContactRole\" where \"contactId\"='$CONTACT' and \"roleCode\"='TECHNICAL_EVALUATOR';")" "1"

CONTACT2=$(curl -s -X POST $API/contacts -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"accountId":"'$ACC'","fullName":"Second Smoke Contact","isPrimary":true}' | JQ "print(json.load(sys.stdin)['id'])")
check "promoting a new primary demotes the incumbent — only one can be primary" \
  "$(psql_ "select count(*) from \"Contact\" where \"accountId\"='$ACC' and \"isPrimary\"=true and \"deletedAt\" is null;")" "1"

LEAD=$(curl -s -X POST $API/leads -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Enquiry","source":"REFERRAL","country":"EG","estimatedValue":90000}' \
  | JQ "print(json.load(sys.stdin)['id'])")
[ "$LEAD" != "None" ] && ok "lead created without naming a company yet" || bad "lead create" "$LEAD"
check "a NEW lead cannot be converted — only a qualified one enters the pipeline" \
  "$(code -X POST $API/leads/$LEAD/convert -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"accountId":"'$ACC'"}')" "400"
check "disqualifying without a reason is refused" \
  "$(code -X PATCH $API/leads/$LEAD/status -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"status":"DISQUALIFIED"}')" "400"
curl -s -o /dev/null -X PATCH $API/leads/$LEAD/status -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"status":"QUALIFIED"}'
curl -s -o /dev/null -X POST $API/activities -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"leadId":"'$LEAD'","type":"CALL","subject":"Intro call with the enquirer"}'
CONV=$(curl -s -X POST $API/leads/$LEAD/convert -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"accountId":"'$ACC'"}')
NEWOPP=$(echo "$CONV" | JQ "print(json.load(sys.stdin)['opportunity']['id'])")
[ "$NEWOPP" != "None" ] && ok "a qualified lead converts into an opportunity" || bad "lead convert" "$CONV"
check "the converted lead survives and points at what it became" \
  "$(curl -s $API/leads/$LEAD -H "Authorization: Bearer $CEO" | JQ "d=json.load(sys.stdin);print(d['status']+'/'+str(d['convertedOpportunityId']==\"$NEWOPP\"))")" "CONVERTED/True"
check "it enters at qualification, not intake — that work is already done" \
  "$(curl -s $API/opportunities/$NEWOPP -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['stage'])")" "LEAD_QUALIFICATION"
check "the lead's call history followed it into the opportunity" \
  "$(curl -s "$API/activities?opportunityId=$NEWOPP" -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['total'])")" "1"
check "a converted lead is closed to further edits" \
  "$(code -X PATCH $API/leads/$LEAD -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"nextStep":"too late"}')" "400"
check "and cannot be converted twice" \
  "$(code -X POST $API/leads/$LEAD/convert -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"accountId":"'$ACC'"}')" "400"

check "an activity with no parent is refused — it would never be found again" \
  "$(code -X POST $API/activities -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"type":"NOTE","subject":"orphan"}')" "400"
TASK=$(curl -s -X POST $API/activities -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"accountId":"'$ACC'","type":"TASK","subject":"Send the pricing summary","dueAt":"2026-12-01T00:00:00.000Z"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "a logged call is complete on arrival, a task stays open" \
  "$(psql_ "select (\"completedAt\" is null) from \"Activity\" where id='$TASK';")" "t"
check "the open-items filter finds it" \
  "$(curl -s "$API/activities?accountId=$ACC&openOnly=true" -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['total'])")" "1"
curl -s -o /dev/null -X PATCH $API/activities/$TASK/complete -H "Authorization: Bearer $CEO"
check "completing it twice is refused, so the timestamp cannot be rewritten" \
  "$(code -X PATCH $API/activities/$TASK/complete -H "Authorization: Bearer $CEO")" "400"
check "an activity on an opportunity also lands on that opportunity's account" \
  "$(psql_ "select count(*) from \"Activity\" where \"opportunityId\"='$NEWOPP' and \"accountId\"='$ACC';")" "1"
check "another team's contact is invisible (404, not 403)" \
  "$(code $API/contacts/$CONTACT -H "Authorization: Bearer $AM")" "404"
check "master data publishes the lead transition table for the UI" \
  "$(curl -s $API/master-data | JQ "print(len(json.load(sys.stdin)['leadStatusTransitions']['QUALIFIED']))")" "2"

echo "=== 16. Release 5: partners, quotations and the comparison ==="
PARTNER_A=$(curl -s -X POST $API/partners -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"legalName":"Smoke Cable Co","country":"EG","types":["SUPPLIER","SUBCONTRACTOR"]}' \
  | JQ "print(json.load(sys.stdin)['id'])")
[ "$PARTNER_A" != "None" ] && ok "partner created" || bad "partner create" "$PARTNER_A"
check "one company holds both roles, because types are rows" \
  "$(curl -s $API/partners/$PARTNER_A -H "Authorization: Bearer $CEO" | JQ "print(len(json.load(sys.stdin)['types']))")" "2"
check "a new partner is a prospect — nobody creates an approved one" \
  "$(curl -s $API/partners/$PARTNER_A -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['approvalStatus'])")" "PROSPECT"

curl -s -o /dev/null -X PATCH $API/partners/$PARTNER_A/ratings -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"technicalRating":5}'
check "the overall rating carries how many of the four were actually scored" \
  "$(curl -s $API/partners/$PARTNER_A -H "Authorization: Bearer $CEO" | JQ "d=json.load(sys.stdin);print(str(d['overallRating'])+'/'+str(d['ratedDimensions']))")" "5/1"
check "and no overall rating can be written directly" \
  "$(curl -s -X PATCH $API/partners/$PARTNER_A/ratings -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"overallRating":5}' | JQ "print(json.load(sys.stdin).get('statusCode',200))")" "400"
check "an account manager cannot approve a partner" \
  "$(code -X PATCH $API/partners/$PARTNER_A/approval -H "Authorization: Bearer $AM" -H 'Content-Type: application/json' \
     -d '{"approvalStatus":"APPROVED"}')" "404"
curl -s -o /dev/null -X PATCH $API/partners/$PARTNER_A/approval -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"approvalStatus":"APPROVED"}'
check "procurement authority approves it" \
  "$(curl -s $API/partners/$PARTNER_A -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['approvalStatus'])")" "APPROVED"

PARTNER_B=$(curl -s -X POST $API/partners -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"legalName":"Smoke Rival Ltd","country":"EG","types":["SUPPLIER"]}' | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X PATCH $API/partners/$PARTNER_B/approval -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"approvalStatus":"APPROVED"}'
check "blacklisting without a reason is refused" \
  "$(code -X PATCH $API/partners/$PARTNER_B/blacklist -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"isBlacklisted":true}')" "400"

RFQ=$(curl -s -X POST $API/opportunities/$NEWOPP/rfqs -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke RFQ — cable supply","partnerIds":["'$PARTNER_A'","'$PARTNER_B'"]}' \
  | JQ "print(json.load(sys.stdin)['id'])")
[ "$RFQ" != "None" ] && ok "RFQ raised against the opportunity" || bad "rfq create" "$RFQ"

RFQ_EMPTY=$(curl -s -X POST $API/opportunities/$NEWOPP/rfqs -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke RFQ with nobody on it"}' | JQ "print(json.load(sys.stdin)['id'])")
check "an RFQ addressed to nobody cannot be issued" \
  "$(code -X PATCH $API/rfqs/$RFQ_EMPTY -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"status":"ISSUED"}')" "400"
check "the one with recipients can" \
  "$(code -X PATCH $API/rfqs/$RFQ -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"status":"ISSUED"}')" "200"

# Two offers: A is dearer but scores better; B is cheapest. The spec's rule is
# that cheapest must not win by default.
QUO_A=$(curl -s -X POST $API/opportunities/$NEWOPP/quotations -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"partnerId":"'$PARTNER_A'","rfqId":"'$RFQ'","validUntil":"2027-01-01T00:00:00.000Z","deliveryDays":30,
       "items":[{"description":"Fibre cable 24F","quantity":1000,"unitPrice":12}]}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "the header total is rolled up from the lines, not typed in" \
  "$(curl -s $API/quotations/$QUO_A -H "Authorization: Bearer $CEO" | JQ "print(float(json.load(sys.stdin)['totalValue']))")" "12000.0"
QUO_B=$(curl -s -X POST $API/opportunities/$NEWOPP/quotations -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"partnerId":"'$PARTNER_B'","rfqId":"'$RFQ'","validUntil":"2027-01-01T00:00:00.000Z","deliveryDays":90,
       "items":[{"description":"Fibre cable 24F","quantity":1000,"unitPrice":9}]}' \
  | JQ "print(json.load(sys.stdin)['id'])")

curl -s -o /dev/null -X POST $API/quotations/$QUO_A/evaluation -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d '{"priceScore":3,"technicalScore":5,"deliveryScore":5,"paymentScore":4,"qualityScore":5,"riskScore":4,"recommendation":"Best overall"}'
curl -s -o /dev/null -X POST $API/quotations/$QUO_B/evaluation -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d '{"priceScore":5,"technicalScore":1,"deliveryScore":1,"paymentScore":2,"qualityScore":1,"riskScore":1}'

CMP=$(curl -s $API/opportunities/$NEWOPP/quotation-comparison -H "Authorization: Bearer $CEO")
check "the cheapest offer is identified" \
  "$(echo "$CMP" | JQ "print(json.load(sys.stdin)['views']['lowestPriceId']=='$QUO_B')")" "True"
check "but the recommendation follows overall value, not price" \
  "$(echo "$CMP" | JQ "print(json.load(sys.stdin)['views']['recommendedId']=='$QUO_A')")" "True"
check "and the comparison selects nothing by itself" \
  "$(echo "$CMP" | JQ "print(sum(1 for q in json.load(sys.stdin)['quotations'] if q['isSelected']))")" "0"
check "the weighted score is the spec's weights applied to the six ratings" \
  "$(echo "$CMP" | JQ "
d=json.load(sys.stdin); q=[x for x in d['quotations'] if x['id']=='$QUO_B'][0]
print(round(float(q['evaluation']['weightedScore']),1))")" "46.0"

# A partner scored on price alone. The other five dimensions must count as zero
# rather than being dropped from the denominator, or a barely-reviewed offer
# would outrank a fully examined one.
PARTNER_C=$(curl -s -X POST $API/partners -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"legalName":"Smoke Half-Reviewed Ltd","country":"EG","types":["SUPPLIER"]}' | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X PATCH $API/partners/$PARTNER_C/approval -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"approvalStatus":"APPROVED"}'
QUO_C=$(curl -s -X POST $API/opportunities/$NEWOPP/quotations -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"partnerId":"'$PARTNER_C'","validUntil":"2027-01-01T00:00:00.000Z",
       "items":[{"description":"Fibre cable 24F","quantity":1000,"unitPrice":20}]}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/quotations/$QUO_C/evaluation -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d '{"priceScore":5}'
check "a dimension nobody scored counts as zero, not as excused" \
  "$(curl -s $API/opportunities/$NEWOPP/quotation-comparison -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); q=[x for x in d['quotations'] if x['id']=='$QUO_C'][0]
print(round(float(q['evaluation']['weightedScore']),1))")" "30.0"
check "so a barely-reviewed offer does not outrank a fully examined one" \
  "$(curl -s $API/opportunities/$NEWOPP/quotation-comparison -H "Authorization: Bearer $CEO" | JQ "
print(json.load(sys.stdin)['views']['recommendedId']=='$QUO_A')")" "True"

check "whoever wrote the recommendation cannot select it (SOD_03)" \
  "$(code -X POST $API/quotations/$QUO_A/select -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' -d '{}')" "403"
check "and the blocked attempt is itself recorded" \
  "$(psql_ "select count(*) from \"AuditLog\" where \"entityId\"='$QUO_A' and action='SOD_BLOCKED';")" "1"
check "choosing against the recommendation without a reason is refused" \
  "$(code -X POST $API/quotations/$QUO_B/select -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' -d '{}')" "400"
check "with a written reason it goes through" \
  "$(code -X POST $API/quotations/$QUO_B/select -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"rationale":"Only bidder able to mobilise in March"}')" "201"
check "and only one offer is ever the selected one" \
  "$(psql_ "select count(*) from \"PartnerQuotation\" where \"opportunityId\"='$NEWOPP' and \"isSelected\"=true;")" "1"
check "a selected quotation is locked against edits" \
  "$(code -X PATCH $API/quotations/$QUO_B -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"paymentTerms":"changed"}')" "400"

curl -s -o /dev/null -X PATCH $API/partners/$PARTNER_A/blacklist -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"isBlacklisted":true,"reason":"Smoke test blacklisting"}'
check "blacklisting withdraws approval in the same act" \
  "$(curl -s $API/partners/$PARTNER_A -H "Authorization: Bearer $CEO" | JQ "print(json.load(sys.stdin)['approvalStatus'])")" "SUSPENDED"
check "a blacklisted partner's offer drops out of every comparison view, with a reason" \
  "$(curl -s $API/opportunities/$NEWOPP/quotation-comparison -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print([i['reason'] for i in d['views']['ineligible'] if i['id']=='$QUO_A'][0])")" "PARTNER_BLACKLISTED"
check "and it cannot be selected at all" \
  "$(code -X POST $API/quotations/$QUO_A/select -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' -d '{}')" "400"
check "a blacklisted partner cannot be re-approved without lifting it" \
  "$(code -X PATCH $API/partners/$PARTNER_A/approval -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"approvalStatus":"APPROVED"}')" "400"
check "SoD rule 3 is now published as enforced" \
  "$(curl -s $API/governance/sod-rules -H "Authorization: Bearer $CEO" | JQ "
r=[x for x in json.load(sys.stdin)['rules'] if x['code']=='SOD_03'][0]; print(r['enforced'])")" "True"

echo "=== 17. The selected quotation reaching the costing ==="
# The half of Release 5 that makes it worth having: a chosen price stops being
# something only procurement knows and becomes the number the bid is built on.
CSCN=$(curl -s -X POST $API/opportunities/$NEWOPP/costing -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Supply and install","type":"MIXED_MODEL","currency":"USD"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
CVER=$(curl -s -X POST $API/costing/scenarios/$CSCN/versions -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{}' | JQ "print(json.load(sys.stdin)['id'])")
CPK2=$(curl -s -X POST $API/costing/versions/$CVER/packages -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Cable supply","type":"MATERIALS"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
BOQ=$(curl -s -X POST $API/costing/packages/$CPK2/items -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"description":"Fibre cable 24F","quantity":1000,"unit":"m"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
# What we guessed before any supplier answered, plus our own crew — two lines
# that must be treated differently when a quote arrives.
curl -s -o /dev/null -X POST $API/costing/items/$BOQ/breakdown -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"quantity":1000,"unitCost":12,"source":"MANUAL_ESTIMATE","description":"Cable, estimated"}'
curl -s -o /dev/null -X POST $API/costing/items/$BOQ/breakdown -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"quantity":10,"unitCost":300,"source":"INTERNAL_RATE","description":"Our supervision"}'
curl -s -o /dev/null -X PATCH $API/costing/items/$BOQ -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"targetMarginPercent":25}'
check "the item starts priced on a guess" \
  "$(psql_ "select \"internalCost\" from \"BoqItem\" where id='$BOQ';")" "15000.00"

PARTNER_D=$(curl -s -X POST $API/partners -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"legalName":"Smoke Cable Supply Co","country":"EG","types":["SUPPLIER"]}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X PATCH $API/partners/$PARTNER_D/approval -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"approvalStatus":"APPROVED"}'
QUO_D=$(curl -s -X POST $API/opportunities/$NEWOPP/quotations -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"partnerId":"'$PARTNER_D'","validUntil":"2027-01-01T00:00:00.000Z","currency":"USD",
       "items":[{"description":"Fibre cable 24F","quantity":1000,"unitPrice":9,"boqItemId":"'$BOQ'"},
                {"description":"Freight to site","quantity":1,"unitPrice":400}]}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/quotations/$QUO_D/evaluation -H "Authorization: Bearer $FIN" \
  -H 'Content-Type: application/json' \
  -d '{"priceScore":5,"technicalScore":5,"deliveryScore":5,"paymentScore":5,"qualityScore":5,"riskScore":5,"recommendation":"Cheapest and best"}'

SEL=$(curl -s -X POST $API/quotations/$QUO_D/select -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{}')
check "one quoted line reaches the costing" \
  "$(echo "$SEL" | JQ "print(json.load(sys.stdin)['costing']['applied'])")" "1"
check "the guess it replaced is superseded, not left to be added twice" \
  "$(echo "$SEL" | JQ "print(json.load(sys.stdin)['costing']['superseded'])")" "1"
check "our own crew cost survives — the supplier never quoted for it" \
  "$(echo "$SEL" | JQ "print(json.load(sys.stdin)['costing']['retained'])")" "1"
check "the unmapped freight line is reported, not silently dropped" \
  "$(echo "$SEL" | JQ "
s=json.load(sys.stdin)['costing']['skipped']; print([x['reason'] for x in s if x['count']==1][0])")" "NOT_MAPPED_TO_BOQ"
check "the item is now costed at the quote plus our own work, not the sum of both guesses" \
  "$(psql_ "select \"internalCost\" from \"BoqItem\" where id='$BOQ';")" "12000.00"
check "and the new line records where the number came from" \
  "$(psql_ "select source from \"CostBreakdown\" where \"boqItemId\"='$BOQ' and \"deletedAt\" is null and source='VENDOR_QUOTE';")" "VENDOR_QUOTE"
check "naming the quotation on it, so the price is traceable a year later" \
  "$(psql_ "select \"sourceReference\" like '%Smoke Cable Supply Co%' from \"CostBreakdown\" where \"boqItemId\"='$BOQ' and source='VENDOR_QUOTE';")" "t"
check "the superseded estimate is soft-deleted, never erased" \
  "$(psql_ "select count(*) from \"CostBreakdown\" where \"boqItemId\"='$BOQ' and source='MANUAL_ESTIMATE' and \"deletedAt\" is not null;")" "1"
check "and its supersession is on the audit trail" \
  "$(psql_ "select count(*) from \"AuditLog\" where \"entityType\"='CostBreakdown' and after->>'reason'='SELECTED_QUOTATION' and \"entityId\" in (select id from \"CostBreakdown\" where \"boqItemId\"='$BOQ');")" "1"
check "cost confidence stops being a guess and says so" \
  "$(curl -s $API/costing/versions/$CVER -H "Authorization: Bearer $CEO" | JQ "
c=json.load(sys.stdin)['confidence']; print(c['quotedShare']>=70)")" "True"
check "the selling price is untouched — a cheaper supplier is not a decision to sell for less" \
  "$(psql_ "select \"sellingTotal\" from \"BoqItem\" where id='$BOQ';")" "20000.00"
check "so the margin widens instead of the price falling" \
  "$(psql_ "select \"grossMargin\" from \"BoqItem\" where id='$BOQ';")" "40.00"

# An approved costing is never edited — not even by procurement's decision.
curl -s -o /dev/null -X POST $API/costing/versions/$CVER/submit -H "Authorization: Bearer $CEO"
curl -s -o /dev/null -X POST $API/costing/versions/$CVER/approve -H "Authorization: Bearer $FIN"
QUO_E=$(curl -s -X POST $API/opportunities/$NEWOPP/quotations -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"partnerId":"'$PARTNER_D'","validUntil":"2027-01-01T00:00:00.000Z","currency":"USD",
       "items":[{"description":"Fibre cable 24F","quantity":1000,"unitPrice":7,"boqItemId":"'$BOQ'"}]}' \
  | JQ "print(json.load(sys.stdin)['id'])")
SEL2=$(curl -s -X POST $API/quotations/$QUO_E/select -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"rationale":"Cheaper reoffer from the same supplier"}')
check "a locked costing refuses the write and names the reason" \
  "$(echo "$SEL2" | JQ "
s=json.load(sys.stdin)['costing']; print(str(s['applied'])+'/'+s['skipped'][0]['reason'])")" "0/COSTING_LOCKED"
check "but the procurement decision itself still stands" \
  "$(psql_ "select \"isSelected\" from \"PartnerQuotation\" where id='$QUO_E';")" "t"
check "and the approved numbers are exactly as they were approved" \
  "$(psql_ "select \"internalCost\" from \"BoqItem\" where id='$BOQ';")" "12000.00"

echo "=== 18. Release 6: approvals as configurable settings ==="
# Afro Group's decision: no fixed approval limits. They are rows a manager
# edits per project, opportunity and country. Everything below proves the
# numbers really are data, and that moving one is itself a governed act.

check "the workflow ships as structure, not as numbers" \
  "$(psql_ "select count(*) from \"WorkflowDefinition\" where code='WF-PRICING-DEFAULT';")" "1"
check "with the spec's rules stored as rows" \
  "$(psql_ "select count(*) from \"ApprovalRule\" r join \"WorkflowDefinition\" w on w.id=r.\"workflowId\" where w.code='WF-PRICING-DEFAULT';")" "5"

SETTINGS=$(curl -s "$API/approval-policies" -H "Authorization: Bearer $CEO")
check "and the settings screen lists every limit, including the unset ones" \
  "$(echo "$SETTINGS" | JQ "print(len(json.load(sys.stdin)['keys']))")" "7"
check "an account manager may read the limits but not change them" \
  "$(curl -s "$API/approval-policies" -H "Authorization: Bearer $AM" | JQ "print(json.load(sys.stdin)['canEdit'])")" "False"
check "and the CEO may" \
  "$(echo "$SETTINGS" | JQ "print(json.load(sys.stdin)['canEdit'])")" "True"

# SOD_08: whoever approves deals against a limit does not move that limit.
SD=$(login sales.director@afro.example)
SOD8_BEFORE=$(psql_ "select count(*) from \"AuditLog\" where action='SOD_BLOCKED' and after->>'rule'='SOD_08';")
check "a sales director cannot raise the margin floor they approve deals against" \
  "$(code -X POST $API/approval-policies -H "Authorization: Bearer $SD" -H 'Content-Type: application/json' \
     -d '{"key":"MIN_GROSS_MARGIN_PERCENT","value":1}')" "403"
check "and the blocked attempt is recorded as SOD_08" \
  "$(psql_ "select count(*)-$SOD8_BEFORE from \"AuditLog\" where action='SOD_BLOCKED' and after->>'rule'='SOD_08';")" "1"
check "a percentage outside 0..100 is refused as a typo, not stored as policy" \
  "$(code -X POST $API/approval-policies -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"key":"MIN_GROSS_MARGIN_PERCENT","value":1200}')" "400"

curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"key":"MIN_GROSS_MARGIN_PERCENT","value":12,"note":"Group floor, smoke test"}'
check "finance or the CEO can set it" \
  "$(curl -s "$API/approval-policies" -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print([k['value'] for k in d['keys'] if k['key']=='MIN_GROSS_MARGIN_PERCENT'][0])")" "12"

# The scoping Afro asked for: same limit, different answer per country.
EGROWS_BEFORE=$(psql_ "select count(*) from \"ApprovalPolicy\" where key='MIN_GROSS_MARGIN_PERCENT' and country='EG';")
EGAUDIT_BEFORE=$(psql_ "select count(*) from \"AuditLog\" where \"entityType\"='ApprovalPolicy' and before->>'value'='18' and after->>'value'='8';")
curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"key":"MIN_GROSS_MARGIN_PERCENT","value":18,"country":"EG","note":"Egypt runs tighter"}'
check "a country override wins over the group default" \
  "$(curl -s "$API/approval-policies?country=EG" -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print([k['value'] for k in d['keys'] if k['key']=='MIN_GROSS_MARGIN_PERCENT'][0])")" "18"
check "while another country still sees the group default" \
  "$(curl -s "$API/approval-policies?country=KE" -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print([k['value'] for k in d['keys'] if k['key']=='MIN_GROSS_MARGIN_PERCENT'][0])")" "12"
check "and the narrower scope says so on the screen" \
  "$(curl -s "$API/approval-policies?country=EG" -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print([k['scope']['level'] for k in d['keys'] if k['key']=='MIN_GROSS_MARGIN_PERCENT'][0])")" "COUNTRY"

# Changing a limit must not rewrite history.
curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"key":"MIN_GROSS_MARGIN_PERCENT","value":8,"country":"EG","note":"Lowered for a hard year"}'
check "a change is a new row; the old value is closed, not erased" \
  "$(psql_ "select count(*)-$EGROWS_BEFORE from \"ApprovalPolicy\" where key='MIN_GROSS_MARGIN_PERCENT' and country='EG';")" "2"
check "exactly one of them is currently in force" \
  "$(psql_ "select count(*) from \"ApprovalPolicy\" where key='MIN_GROSS_MARGIN_PERCENT' and country='EG' and \"effectiveTo\" is null;")" "1"
check "and the change is on the audit trail with both numbers" \
  "$(psql_ "select count(*)-$EGAUDIT_BEFORE from \"AuditLog\" where \"entityType\"='ApprovalPolicy' and before->>'value'='18' and after->>'value'='8';")" "1"

# Raising an approval on a real deal.
APPR_OPP=$(curl -s -X POST $API/opportunities -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Approval Deal","accountId":"'$ACC'","country":"EG","currency":"USD"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
ASCN=$(curl -s -X POST $API/opportunities/$APPR_OPP/costing -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Thin margin","type":"SELF_EXECUTION","currency":"USD"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/costing/scenarios/$ASCN/select -H "Authorization: Bearer $CEO"
AVER=$(curl -s -X POST $API/costing/scenarios/$ASCN/versions -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{}' | JQ "print(json.load(sys.stdin)['id'])")
APKG=$(curl -s -X POST $API/costing/versions/$AVER/packages -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Works","type":"CIVIL_WORKS"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
AITM=$(curl -s -X POST $API/costing/packages/$APKG/items -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"description":"Works","quantity":1,"unit":"lot"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/costing/items/$AITM/breakdown -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"quantity":1,"unitCost":100000,"source":"MANUAL_ESTIMATE"}'
# 5% margin, well under Egypt's 8% floor.
curl -s -o /dev/null -X PATCH $API/costing/items/$AITM -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"targetMarginPercent":5}'

PREVIEW=$(curl -s $API/opportunities/$APPR_OPP/approval-preview -H "Authorization: Bearer $CEO")
check "the deal can be checked before anyone is disturbed" \
  "$(echo "$PREVIEW" | JQ "print(json.load(sys.stdin)['needsApproval'])")" "True"
check "and it names the rule that fired and the limit it read" \
  "$(echo "$PREVIEW" | JQ "
d=json.load(sys.stdin); f=[x for x in d['fired'] if x['conditionField']=='GROSS_MARGIN_PERCENT'][0]
print(str(f['threshold'])+'/'+f['requiredRole'])")" "8/CEO"

REQ=$(curl -s -X POST $API/opportunities/$APPR_OPP/approvals -H "Authorization: Bearer $FIN" \
  -H 'Content-Type: application/json' -d '{}')
REQ_ID=$(echo "$REQ" | JQ "print(json.load(sys.stdin)['id'])")
[ "$REQ_ID" != "None" ] && ok "approval raised" || bad "raise approval" "$REQ"
check "the limits in force are snapshotted onto the request" \
  "$(psql_ "select \"policySnapshot\"->>'MIN_GROSS_MARGIN_PERCENT' from \"ApprovalRequest\" where id='$REQ_ID';")" "8"

# Now move the limit. The pending request must keep the number it was raised on.
curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"key":"MIN_GROSS_MARGIN_PERCENT","value":3,"country":"EG","note":"Changed after the fact"}'
check "changing the policy afterwards does not rewrite what the approver was asked" \
  "$(psql_ "select \"policySnapshot\"->>'MIN_GROSS_MARGIN_PERCENT' from \"ApprovalRequest\" where id='$REQ_ID';")" "8"

check "the requester cannot approve their own request (SOD_07)" \
  "$(code -X POST $API/approvals/$REQ_ID/decide -H "Authorization: Bearer $FIN" \
     -H 'Content-Type: application/json' -d '{"decision":"APPROVE"}')" "403"
check "a rejection without a reason is refused" \
  "$(code -X POST $API/approvals/$REQ_ID/decide -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"decision":"REJECT"}')" "400"
check "approving with conditions requires the conditions written down" \
  "$(code -X POST $API/approvals/$REQ_ID/decide -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"decision":"APPROVE_WITH_CONDITIONS"}')" "400"
check "it routes to the approver the rule named, not down the whole chain" \
  "$(curl -s $API/approvals/my-queue -H "Authorization: Bearer $CEO" | JQ "
print(any(r['id']=='$REQ_ID' for r in json.load(sys.stdin)))")" "True"
check "a decision with its conditions is accepted" \
  "$(code -X POST $API/approvals/$REQ_ID/decide -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' \
     -d '{"decision":"APPROVE_WITH_CONDITIONS","conditions":"Advance payment of 30% before mobilisation"}')" "201"
check "and the condition is kept, not just the verdict" \
  "$(psql_ "select count(*) from \"ApprovalAction\" where \"requestId\"='$REQ_ID' and conditions is not null;")" "1"
check "the request is closed" \
  "$(psql_ "select status from \"ApprovalRequest\" where id='$REQ_ID';")" "APPROVED_WITH_CONDITIONS"
check "and deciding it twice is refused" \
  "$(code -X POST $API/approvals/$REQ_ID/decide -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"decision":"APPROVE"}')" "400"

# Discounts — SOD_04 and the delegated ceiling.
curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"key":"MAX_DISCOUNT_PERCENT","value":10}'
check "a discount inside the delegated authority needs nobody" \
  "$(curl -s -X POST $API/opportunities/$APPR_OPP/discounts -H "Authorization: Bearer $FIN" \
     -H 'Content-Type: application/json' \
     -d '{"requestedPercent":5,"fromPrice":100000,"toPrice":95000,"justification":"Repeat customer"}' \
     | JQ "print(json.load(sys.stdin)['status'])")" "APPROVED"
BIGDSC=$(curl -s -X POST $API/opportunities/$APPR_OPP/discounts -H "Authorization: Bearer $FIN" \
  -H 'Content-Type: application/json' \
  -d '{"requestedPercent":25,"fromPrice":100000,"toPrice":75000,"justification":"Competitive pressure"}')
BIGDSC_ID=$(echo "$BIGDSC" | JQ "print(json.load(sys.stdin)['id'])")
check "one above it waits for a decision" \
  "$(echo "$BIGDSC" | JQ "print(json.load(sys.stdin)['status'])")" "PENDING"
check "and the person who asked cannot grant it (SOD_04)" \
  "$(code -X POST $API/discounts/$BIGDSC_ID/decide -H "Authorization: Bearer $FIN" \
     -H 'Content-Type: application/json' -d '{"approve":true}')" "403"
check "recorded as SOD_04, not silently dropped" \
  "$(psql_ "select count(*) from \"AuditLog\" where action='SOD_BLOCKED' and after->>'rule'='SOD_04' and \"entityId\"='$BIGDSC_ID';")" "1"
check "somebody else can" \
  "$(code -X POST $API/discounts/$BIGDSC_ID/decide -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"approve":true,"note":"Strategic account"}')" "201"

# Proposals — the spec's hard rule.
PRP=$(curl -s -X POST $API/opportunities/$APPR_OPP/proposals -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"title":"Smoke commercial offer"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "a commercial proposal with no costing behind it is refused" \
  "$(code -X POST $API/proposals/$PRP/versions -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"type":"COMMERCIAL","sellingPrice":500000}')" "400"
check "and one citing a costing that is still a draft is refused too" \
  "$(code -X POST $API/proposals/$PRP/versions -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"type":"COMMERCIAL","costingVersionId":"'$AVER'","sellingPrice":105263.16}')" "400"
check "a purely technical proposal needs none of that" \
  "$(code -X POST $API/proposals/$PRP/versions -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"type":"TECHNICAL"}')" "201"

curl -s -o /dev/null -X POST $API/costing/versions/$AVER/submit -H "Authorization: Bearer $CEO"
curl -s -o /dev/null -X POST $API/costing/versions/$AVER/approve -H "Authorization: Bearer $FIN"
APPROVED_PRICE=$(psql_ "select \"totalPrice\" from \"CostingVersion\" where id='$AVER';")
check "once the costing is approved the commercial version is allowed" \
  "$(code -X POST $API/proposals/$PRP/versions -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"type":"COMMERCIAL","costingVersionId":"'$AVER'","sellingPrice":'$APPROVED_PRICE'}')" "201"
check "but a price contradicting the costing it cites is still refused" \
  "$(code -X POST $API/proposals/$PRP/versions -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"type":"COMMERCIAL","costingVersionId":"'$AVER'","sellingPrice":1}')" "400"

PV=$(psql_ "select id from \"ProposalVersion\" where \"proposalId\"='$PRP' and type='COMMERCIAL' limit 1;")
check "sending it is recorded" \
  "$(code -X POST $API/proposal-versions/$PV/submit -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"submittedTo":"Customer procurement","submissionMethod":"EMAIL"}')" "201"
check "and what the customer holds is never replaced, only revised" \
  "$(code -X POST $API/proposal-versions/$PV/submit -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{}')" "400"

check "both remaining SoD rules are now published as enforced" \
  "$(curl -s $API/governance/sod-rules -H "Authorization: Bearer $CEO" | JQ "
rs=json.load(sys.stdin)['rules']
print(str([x for x in rs if x['code']=='SOD_04'][0]['enforced'])+'/'+str([x for x in rs if x['code']=='SOD_08'][0]['enforced']))")" "True/True"

echo "=== 19. Release 7: award, contracts and handover ==="
# "لا يجب اعتبار Verbal Award مساويًا لعقد موقع" — the rule the release exists
# for. A win is a strength, not a flag, and a phone call cannot hand a project
# to operations.

R7_OPP=$(curl -s -X POST $API/opportunities -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Award Deal","accountId":"'$ACC'","country":"EG","currency":"USD"}' \
  | JQ "print(json.load(sys.stdin)['id'])")

curl -s -o /dev/null -X POST $API/opportunities/$R7_OPP/awards -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"type":"VERBAL_AWARD","awardedAt":"2026-07-01T00:00:00.000Z","awardedValue":1000000}'
check "a verbal award is recorded but is not binding" \
  "$(curl -s $API/opportunities/$R7_OPP/awards -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print(str(d['strongest'])+'/'+str(d['isBinding']))")" "VERBAL_AWARD/False"

GATE=$(curl -s $API/opportunities/$R7_OPP/handover-readiness -H "Authorization: Bearer $CEO")
check "so the project cannot be handed over on it" \
  "$(echo "$GATE" | JQ "
d=json.load(sys.stdin); print(str(d['readiness']['ready'])+'/'+str('BINDING_AWARD' in d['readiness']['missing']))")" "False/True"
check "and the gate names what is missing rather than counting it" \
  "$(echo "$GATE" | JQ "print(len(json.load(sys.stdin)['readiness']['missing'])>=5)")" "True"

curl -s -o /dev/null -X POST $API/opportunities/$R7_OPP/awards -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"type":"PURCHASE_ORDER","awardedAt":"2026-07-15T00:00:00.000Z","awardedValue":1000000,"customerReference":"PO-99811","erpCostCode":"OPP-SMOKE-001","erpCostCenter":"CC-FTTH-2026"}'
check "a purchase order is binding" \
  "$(curl -s $API/opportunities/$R7_OPP/awards -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print(str(d['strongest'])+'/'+str(d['isBinding']))")" "PURCHASE_ORDER/True"

# A later verbal award must not un-order the work.
curl -s -o /dev/null -X POST $API/opportunities/$R7_OPP/awards -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"type":"VERBAL_AWARD","awardedAt":"2026-07-20T00:00:00.000Z"}'
check "and a later phone call does not weaken it" \
  "$(curl -s $API/opportunities/$R7_OPP/awards -H "Authorization: Bearer $CEO" | JQ "
print(json.load(sys.stdin)['strongest'])")" "PURCHASE_ORDER"
check "the ERP cost code is kept against the award" \
  "$(psql_ "select \"erpCostCode\" from \"Award\" where \"opportunityId\"='$R7_OPP' and \"erpCostCode\" is not null;")" "OPP-SMOKE-001"

# A scope, so the gate's SCOPE_FIXED condition has something to judge. Without
# it the handover is correctly refused — which is the behaviour, not a fixture.
R7_SPKG=$(curl -s -X POST $API/opportunities/$R7_OPP/scope/packages -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Civil works","category":"CIVIL_WORKS"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/scope/packages/$R7_SPKG/items -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Trenching","quantity":1,"unit":"km"}'

# A costing and an approved proposal to compare the contract against.
R7_SCN=$(curl -s -X POST $API/opportunities/$R7_OPP/costing -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Baseline","type":"SELF_EXECUTION","currency":"USD"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
R7_VER=$(curl -s -X POST $API/costing/scenarios/$R7_SCN/versions -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{}' | JQ "print(json.load(sys.stdin)['id'])")
R7_PKG=$(curl -s -X POST $API/costing/versions/$R7_VER/packages -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Works","type":"CIVIL_WORKS"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
R7_ITM=$(curl -s -X POST $API/costing/packages/$R7_PKG/items -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"description":"Works","quantity":1,"unit":"lot"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/costing/items/$R7_ITM/breakdown -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"quantity":1,"unitCost":800000,"source":"MANUAL_ESTIMATE"}'
curl -s -o /dev/null -X PATCH $API/costing/items/$R7_ITM -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"targetMarginPercent":20}'
curl -s -o /dev/null -X POST $API/costing/versions/$R7_VER/submit -H "Authorization: Bearer $CEO"
curl -s -o /dev/null -X POST $API/costing/versions/$R7_VER/approve -H "Authorization: Bearer $FIN"
R7_PRICE=$(psql_ "select \"totalPrice\" from \"CostingVersion\" where id='$R7_VER';")

R7_PRP=$(curl -s -X POST $API/opportunities/$R7_OPP/proposals -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"title":"Smoke offer"}' | JQ "print(json.load(sys.stdin)['id'])")
# The proposal states its terms, so the contract comparison has both sides.
# Without them everything except price was compared against nothing.
R7_PV=$(curl -s -X POST $API/proposals/$R7_PRP/versions -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"type":"COMMERCIAL","costingVersionId":"'$R7_VER'","sellingPrice":'$R7_PRICE',
       "paymentTerms":"30 days net","warrantyMonths":12,"durationDays":180}' \
  | JQ "print(json.load(sys.stdin)['id'])")

# The contract, deliberately worse than the offer in three ways.
R7_CNT=$(curl -s -X POST $API/opportunities/$R7_OPP/contracts -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"proposalVersionId":"'$R7_PV'","contractNumber":"CNT-SMOKE-1","contractValue":900000,
       "paymentTerms":"30 days net",
       "ldPercent":10,"warrantyMonths":24,"startDate":"2026-09-01T00:00:00.000Z","endDate":"2027-01-01T00:00:00.000Z"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "a contract with no proposal behind it cannot be reviewed" \
  "$(R7_BARE=$(curl -s -X POST $API/opportunities/$R7_OPP/contracts -H "Authorization: Bearer $CEO" \
       -H 'Content-Type: application/json' -d '{"contractNumber":"CNT-SMOKE-BARE"}' \
       | JQ "print(json.load(sys.stdin)['id'])"); \
     code -X POST $API/contracts/$R7_BARE/review -H "Authorization: Bearer $CEO")" "400"

REV=$(curl -s -X POST $API/contracts/$R7_CNT/review -H "Authorization: Bearer $CEO")
check "the review finds the price cut" \
  "$(echo "$REV" | JQ "
d=json.load(sys.stdin); print(any(x['field']=='PRICE' for x in d['deviations']))")" "True"
check "and grades a 10% cut as critical" \
  "$(echo "$REV" | JQ "
d=json.load(sys.stdin); print([x['riskLevel'] for x in d['deviations'] if x['field']=='PRICE'][0])")" "CRITICAL"
check "and a warranty stretched from 12 to 24 months is a deviation too" \
  "$(echo "$REV" | JQ "
d=json.load(sys.stdin); print([x['impact'] for x in d['deviations'] if x['field']=='WARRANTY'][0])")" "WORSE"
check "while a term the contract carried over unchanged raises nothing" \
  "$(echo "$REV" | JQ "
d=json.load(sys.stdin); print(any(x['field']=='PAYMENT_TERMS' for x in d['deviations']))")" "False"
check "a penalty that was never offered is critical too" \
  "$(echo "$REV" | JQ "
d=json.load(sys.stdin); print([x['riskLevel'] for x in d['deviations'] if x['field']=='PENALTIES'][0])")" "CRITICAL"
check "the contract is marked reviewed" \
  "$(psql_ "select (\"reviewedAt\" is not null) from \"Contract\" where id='$R7_CNT';")" "t"

R7_DEV=$(psql_ "select id from \"ContractDeviation\" where \"contractId\"='$R7_CNT' and field='PRICE' and \"deletedAt\" is null limit 1;")
check "whoever ran the review cannot then approve what it found (SOD_06)" \
  "$(code -X POST $API/deviations/$R7_DEV/decide -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"status":"ACCEPTED","note":"fine"}')" "403"
check "and the blocked attempt is recorded as SOD_06" \
  "$(psql_ "select count(*) from \"AuditLog\" where action='SOD_BLOCKED' and after->>'rule'='SOD_06' and \"entityId\"='$R7_DEV';")" "1"
check "accepting a critical deviation without a written reason is refused" \
  "$(code -X POST $API/deviations/$R7_DEV/decide -H "Authorization: Bearer $FIN" \
     -H 'Content-Type: application/json' -d '{"status":"ACCEPTED"}')" "400"
check "with a reason, somebody else may accept it" \
  "$(code -X POST $API/deviations/$R7_DEV/decide -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
     -d '{"status":"ACCEPTED","note":"Customer would not move; risk priced into contingency"}')" "201"

check "re-reviewing does not reopen a decision already taken" \
  "$(curl -s -o /dev/null -X POST $API/contracts/$R7_CNT/review -H "Authorization: Bearer $CEO"; \
     psql_ "select status from \"ContractDeviation\" where id='$R7_DEV';")" "ACCEPTED"

# The handover and its gate.
R7_HND=$(curl -s -X POST $API/opportunities/$R7_OPP/handovers -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"contractId":"'$R7_CNT'","costBaselineVersionId":"'$R7_VER'"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "the pack starts as a checklist of what is owed, not an empty page" \
  "$(psql_ "select count(*) from \"HandoverItem\" where \"handoverId\"='$R7_HND';")" "12"
check "with a row per required party, so an unanswered seat is visible" \
  "$(psql_ "select count(*) from \"HandoverSignoff\" where \"handoverId\"='$R7_HND';")" "6"
check "and legal is not required by default — the spec says عند الحاجة" \
  "$(psql_ "select count(*) from \"HandoverSignoff\" where \"handoverId\"='$R7_HND' and party='LEGAL';")" "0"

check "nobody may accept while the gate is unmet" \
  "$(code -X POST $API/handovers/$R7_HND/signoff -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"party":"SALES","accept":true}')" "400"
check "and the refusal names the conditions rather than just saying no" \
  "$(curl -s -X POST $API/handovers/$R7_HND/signoff -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"party":"SALES","accept":true}' \
     | JQ "print(len(json.load(sys.stdin)['missing'])>0)")" "True"

curl -s -o /dev/null -X PATCH $API/handovers/$R7_HND -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"projectManagerId":"'$(psql_ "select id from \"User\" where email='am@afro.example';")'","plannedStartDate":"2026-09-01T00:00:00.000Z"}'
# The introduced penalty is still open and critical, and the gate is right to
# block on it. Resolving it is part of the story, not a workaround.
# deletedAt is null matters: the re-review above superseded the first
# PENALTIES row, and without the filter this picks the dead one.
R7_PEN=$(psql_ "select id from \"ContractDeviation\" where \"contractId\"='$R7_CNT' and field='PENALTIES' and status='OPEN' and \"deletedAt\" is null limit 1;")
check "the gate still refuses while a critical deviation is open" \
  "$(curl -s $API/handovers/$R7_HND -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print('DEVIATIONS_RESOLVED' in d['readiness']['missing'])")" "True"
check "and the penalty is resolved the same way" \
  "$(code -X POST $API/deviations/$R7_PEN/decide -H "Authorization: Bearer $FIN" \
     -H 'Content-Type: application/json' \
     -d '{"status":"ACCEPTED","note":"LD capped at 10% and priced into the contingency"}')" "201"

check "with everything in place the gate opens" \
  "$(curl -s $API/handovers/$R7_HND -H "Authorization: Bearer $CEO" | JQ "
print(json.load(sys.stdin)['readiness']['ready'])")" "True"

check "marking a pack item not applicable costs a reason" \
  "$(R7_ITEM=$(psql_ "select id from \"HandoverItem\" where \"handoverId\"='$R7_HND' and category='SUBCONTRACTORS' limit 1;"); \
     code -X PATCH $API/handover-items/$R7_ITEM -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"notApplicable":true}')" "400"

check "a refusal without a reason is refused" \
  "$(code -X POST $API/handovers/$R7_HND/signoff -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"party":"OPERATIONS","accept":false}')" "400"
check "the project manager refusing stops the handover" \
  "$(code -X POST $API/handovers/$R7_HND/signoff -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"party":"PROJECT_MANAGER","accept":false,"comment":"The schedule cannot be delivered with the priced crew"}')" "201"
check "even before the other five have answered" \
  "$(psql_ "select status from \"ProjectHandover\" where id='$R7_HND';")" "REJECTED"
check "and their refusal is kept in their own words" \
  "$(psql_ "select (comment like '%priced crew%') from \"HandoverSignoff\" where \"handoverId\"='$R7_HND' and party='PROJECT_MANAGER';")" "t"
check "the same party cannot answer twice" \
  "$(code -X POST $API/handovers/$R7_HND/signoff -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"party":"PROJECT_MANAGER","accept":true}')" "400"

# The Bid/No-Bid bands were the last constants pretending to be policy. They
# are settings now, and with none set the system scores the bid and declines
# to suggest rather than showing a number nobody at Afro chose.
BID_OPP=$(curl -s -X POST $API/opportunities -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Bid Bands","accountId":"'$ACC'","country":"TZ","currency":"USD"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "with no bands configured the assessment scores but suggests nothing" \
  "$(curl -s -X POST $API/opportunities/$BID_OPP/bid-assessment -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"ratings":{"RELATIONSHIP_STRENGTH":5,"TECHNICAL_FIT":5,"DELIVERY_CAPACITY":5,"EXPECTED_PROFITABILITY":5,"PAYMENT_TERMS":5,"COMPETITION":5,"SCOPE_CLARITY":5,"STRATEGIC_VALUE":5}}' \
     | JQ "d=json.load(sys.stdin); print(str(d['score'])+'/'+str(d['suggestedDecision'])+'/'+str(d['bandsConfigured']))")" "100/None/False"

curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"key":"BID_GO_THRESHOLD","value":70,"opportunityId":"'$BID_OPP'"}'
curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"key":"BID_CONDITIONAL_THRESHOLD","value":55,"opportunityId":"'$BID_OPP'"}'
check "once Afro sets them the suggestion appears, from the settings" \
  "$(curl -s -X POST $API/opportunities/$BID_OPP/bid-assessment -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"ratings":{"RELATIONSHIP_STRENGTH":5,"TECHNICAL_FIT":5,"DELIVERY_CAPACITY":5,"EXPECTED_PROFITABILITY":5,"PAYMENT_TERMS":5,"COMPETITION":5,"SCOPE_CLARITY":5,"STRATEGIC_VALUE":5}}' \
     | JQ "d=json.load(sys.stdin); print(str(d['suggestedDecision'])+'/'+str(d['bands']['bid']))")" "BID/70"
check "and a stricter band on this one opportunity changes the same score's verdict" \
  "$(curl -s -o /dev/null -X POST $API/approval-policies -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
       -d '{"key":"BID_GO_THRESHOLD","value":95,"opportunityId":"'$BID_OPP'"}'; \
     curl -s -X POST $API/opportunities/$BID_OPP/bid-assessment -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"ratings":{"RELATIONSHIP_STRENGTH":4,"TECHNICAL_FIT":4,"DELIVERY_CAPACITY":4,"EXPECTED_PROFITABILITY":4,"PAYMENT_TERMS":4,"COMPETITION":4,"SCOPE_CLARITY":4,"STRATEGIC_VALUE":4}}' \
     | JQ "print(json.load(sys.stdin)['suggestedDecision'])")" "BID_WITH_CONDITIONS"

# The Costing Builder's visual warnings. Computed on read, because a quotation
# lapses with the passage of time alone and a stored flag would still call the
# price firm.
# A scenario of its own: the version used earlier is approved and locked, and
# a locked version refuses new items — correctly.
WSCN=$(curl -s -X POST $API/opportunities/$NEWOPP/costing -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Warning checks","type":"SELF_EXECUTION","currency":"USD"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
WVER=$(curl -s -X POST $API/costing/scenarios/$WSCN/versions -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{}' | JQ "print(json.load(sys.stdin)['id'])")
WPKG=$(curl -s -X POST $API/costing/versions/$WVER/packages -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"name":"Warnings","type":"OTHER"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
WARN_ITEM=$(curl -s -X POST $API/costing/packages/$WPKG/items -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"description":"Unpriced works","quantity":0,"unit":"lot"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/costing/items/$WARN_ITEM/breakdown -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"quantity":1,"unitCost":5000,"source":"MANUAL_ESTIMATE"}'

WARNINGS=$(curl -s $API/costing/versions/$WVER -H "Authorization: Bearer $CEO")
check "an item that costs money and is priced at nothing blocks" \
  "$(echo "$WARNINGS" | JQ "
d=json.load(sys.stdin); print(any(w['code']=='NO_SELLING_PRICE' and w['severity']=='BLOCKING' for w in d['warnings']['warnings']))")" "True"
check "a quantity of zero is raised too" \
  "$(echo "$WARNINGS" | JQ "
d=json.load(sys.stdin); print(any(w['code']=='ZERO_OR_MISSING_QUANTITY' for w in d['warnings']['warnings']))")" "True"
check "cost resting mostly on a guess is reported, without blocking" \
  "$(echo "$WARNINGS" | JQ "
d=json.load(sys.stdin); w=[x for x in d['warnings']['warnings'] if x['code']=='WEAK_COST_SOURCE']
print(w[0]['severity'] if w else 'MISSING')")" "INFO"
check "warnings are indexed by the item they belong to" \
  "$(echo "$WARNINGS" | JQ "
d=json.load(sys.stdin); print('$WARN_ITEM' in d['warnings']['byItem'])")" "True"
check "and the screen is told which checks it is NOT making" \
  "$(echo "$WARNINGS" | JQ "
d=json.load(sys.stdin); print(sorted(n['code'] for n in d['notChecked']))")" "['BELOW_HISTORICAL_AVERAGE', 'STALE_EXCHANGE_RATE']"

check "all eight segregation-of-duties rules are now enforced" \
  "$(curl -s $API/governance/sod-rules -H "Authorization: Bearer $CEO" | JQ "
rs=json.load(sys.stdin)['rules']; print(sum(1 for r in rs if r['enforced']))")" "8"

echo "=== 20. Release 12: one definition per metric ==="
# The spec's section 36: "يجب أن يكون التعريف موحدًا، حتى لا يحسب كل مدير
# المؤشر بطريقة مختلفة". Every number below comes from one place.

DASH=$(curl -s $API/metrics/dashboard -H "Authorization: Bearer $CEO")
check "the dashboard carries the definition beside each number" \
  "$(echo "$DASH" | JQ "
d=json.load(sys.stdin); print(all(m.get('definition',{}).get('formula') for m in d['metrics']))")" "True"
check "and answers the KPI gate: which decision, whose definition" \
  "$(echo "$DASH" | JQ "
d=json.load(sys.stdin); print(all(m['definition']['decision'] and m['definition']['owner'] for m in d['metrics']))")" "True"
check "win rate is won over won plus lost, exactly as the spec writes it" \
  "$(curl -s $API/metrics/WIN_RATE -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print(d['definition']['formula'].startswith('Won'))")" "True"
check "a metric with nothing behind it says so instead of showing zero" \
  "$(curl -s $API/metrics/SUPPLIER_DEPENDENCY -H "Authorization: Bearer $AM" | JQ "
d=json.load(sys.stdin); print(str(d['value'])+'/'+str(d.get('unavailableReason')))")" "None/NO_DATA"
check "every number reports how many records it rests on" \
  "$(echo "$DASH" | JQ "
d=json.load(sys.stdin); print(all('basis' in m for m in d['metrics']))")" "True"
check "the CEO's dashboard covers the level the spec describes" \
  "$(echo "$DASH" | JQ "
d=json.load(sys.stdin); codes={m['code'] for m in d['metrics']}
print('FORECAST_ACCURACY' in codes and 'OPEN_APPROVALS' in codes)")" "True"
check "and an account manager sees their own level, not the board's" \
  "$(curl -s $API/metrics/dashboard -H "Authorization: Bearer $AM" | JQ "
d=json.load(sys.stdin); codes={m['code'] for m in d['metrics']}
print('CUSTOMER_CONCENTRATION' in codes)")" "False"
check "metrics obey the same data scope as everything else" \
  "$(curl -s $API/metrics/dashboard -H "Authorization: Bearer $AM" | JQ "
a=json.load(sys.stdin)['scope']['opportunities']; print(a>=0)")" "True"
check "and the board is told which figures still await the ERP" \
  "$(echo "$DASH" | JQ "
d=json.load(sys.stdin); print('ACTUAL_MARGIN_VS_BID_MARGIN' in d['pendingErpIntegration'])")" "True"

echo "=== 21. G&A and overheads as approved rules ==="
# "لا أنصح بوضع نسبة G&A واحدة على كل شيء" — one rate on everything makes a bid
# in a cheap country subsidise one in an expensive country while both look
# correctly priced. So overheads are rules, scoped and Finance-approved.

BEFORE_TOTAL=$(curl -s $API/costing/versions/$WVER -H "Authorization: Bearer $CEO" | JQ "
print(json.load(sys.stdin)['totals']['indirectCost'])")
GNA=$(curl -s -X POST $API/cost-rules -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke G&A","category":"G_AND_A","method":"PERCENT_OF_DIRECT_COST","value":10,"note":"smoke"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
check "a new rule is always a draft, whoever created it" \
  "$(psql_ "select \"approvalStatus\" from \"CostRule\" where id='$GNA';")" "DRAFT"
check "a percentage over 100 is refused as a typo, not stored as policy" \
  "$(code -X POST $API/cost-rules -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
     -d '{"name":"Typo","category":"OVERHEAD","method":"PERCENT_OF_DIRECT_COST","value":1200}')" "400"
check "an account manager cannot approve a cost rule" \
  "$(code -X POST $API/cost-rules/$GNA/decision -H "Authorization: Bearer $AM" \
     -H 'Content-Type: application/json' -d '{"approve":true}')" "403"

# A draft rule must not reach a bid. Measured against a live costing.
# Measured as a delta: rules approved by earlier runs of this suite still
# apply, correctly.
AFTER_DRAFT=$(curl -s $API/costing/versions/$WVER -H "Authorization: Bearer $CEO" | JQ "
print(json.load(sys.stdin)['totals']['indirectCost'])")
check "a rule Finance has not approved changes no number" "$AFTER_DRAFT" "$BEFORE_TOTAL"

curl -s -o /dev/null -X POST $API/cost-rules/$GNA/decision -H "Authorization: Bearer $FIN" \
  -H 'Content-Type: application/json' -d '{"approve":true}'
# Asserted as an exact share rather than an increase: one rule per category
# applies, so approving a second 10% G&A replaces the first at the same value
# instead of stacking — which is the design, not a miss.
check "once finance approves it, the costing carries exactly that overhead" \
  "$(curl -s $API/costing/versions/$WVER -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); t=d['totals']
print(round(d['indirect']['byCategory']['G_AND_A'],2)==round(t['directCost']*0.10,2))")" "True"
check "direct and indirect are reported apart, not merged" \
  "$(curl -s $API/costing/versions/$WVER -H "Authorization: Bearer $CEO" | JQ "
t=json.load(sys.stdin)['totals']; print(round(t['directCost']+t['indirectCost'],2)==round(t['totalCost'],2))")" "True"
check "and the rule that produced it is named on the costing" \
  "$(curl -s $API/costing/versions/$WVER -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print(any(a['name']=='Smoke G&A' for a in d['indirect']['applied']))")" "True"

# Two rules in different categories, entered in both orders.
FIN_RULE=$(curl -s -X POST $API/cost-rules -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke financing","category":"FINANCING","method":"PERCENT_OF_DIRECT_COST","value":5}' \
  | JQ "print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -X POST $API/cost-rules/$FIN_RULE/decision -H "Authorization: Bearer $FIN" \
  -H 'Content-Type: application/json' -d '{"approve":true}'
check "categories accumulate, and each computes off the same base" \
  "$(curl -s $API/costing/versions/$WVER -H "Authorization: Bearer $CEO" | JQ "
d=json.load(sys.stdin); print(all(a['basis']==d['totals']['directCost'] for a in d['indirect']['applied']))")" "True"

check "rejecting a rule needs a reason" \
  "$(RJ=$(curl -s -X POST $API/cost-rules -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
       -d '{"name":"To reject","category":"INSURANCE","method":"FIXED_AMOUNT","value":100}' \
       | JQ "print(json.load(sys.stdin)['id'])"); \
     code -X POST $API/cost-rules/$RJ/decision -H "Authorization: Bearer $FIN" \
       -H 'Content-Type: application/json' -d '{"approve":false}')" "400"

echo "=== 22. Soft delete only ==="
curl -s -o /dev/null -X DELETE $API/opportunities/$OPP -H "Authorization: Bearer $CEO"
curl -s -o /dev/null -X DELETE $API/accounts/$SCOPED -H "Authorization: Bearer $CEO"
check "deleted record disappears from the API" "$(code $API/opportunities/$OPP -H "Authorization: Bearer $CEO")" "404"
check "but the row survives in the database" \
  "$(psql_ "select (\"deletedAt\" is not null) from \"Opportunity\" where id='$OPP';")" "t"

check "the contact goes too, but only softly" \
  "$(curl -s -o /dev/null -X DELETE $API/contacts/$CONTACT2 -H "Authorization: Bearer $CEO"; \
     psql_ "select (\"deletedAt\" is not null) from \"Contact\" where id='$CONTACT2';")" "t"

echo "=== 23. Web UI in three locales ==="
curl -s -c /tmp/acms_smoke.jar -o /dev/null -X POST $WEB/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"ceo@afro.example\",\"password\":\"$SEED_PASSWORD\"}"
for L in ar en fr; do
  for P in dashboard accounts leads leads/new opportunities partners partners/new; do
    check "$L/$P renders" "$(code -b /tmp/acms_smoke.jar $WEB/$L/$P)" "200"
  done
  check "$L partner file renders" "$(code -b /tmp/acms_smoke.jar $WEB/$L/partners/$PARTNER_A)" "200"
  check "$L supplier comparison renders" \
    "$(code -b /tmp/acms_smoke.jar $WEB/$L/opportunities/$NEWOPP/quotations)" "200"
done
# The sidebar is pinned to the START of the reading direction, so it renders on
# the left in English and on the right in Arabic from one rule rather than two.
# Asserted against the built stylesheet because it is a one-word change to flip
# it back by accident, and nothing else would notice.
SHEET=$(curl -sL $WEB/en/login | grep -oE '/_next/static/css/[^"]+[.]css' | head -1)
check "the sidebar sits on the reading side, not the far side" \
  "$(curl -s $WEB$SHEET | grep -c 'sidebar{position:fixed;top:0;inset-inline-start:0')" "1"
check "Arabic shell is RTL" "$(curl -s -b /tmp/acms_smoke.jar $WEB/ar/dashboard | grep -c 'dir="rtl"')" "1"
check "notification bell present" "$(curl -s -b /tmp/acms_smoke.jar $WEB/en/dashboard | grep -c 'bell-wrap')" "1"
check "signed-out visitor is redirected" "$(code $WEB/en/dashboard)" "307"
check "and lands on the login page" \
  "$(curl -sL $WEB/en/dashboard | grep -c 'type="password"')" "1"
rm -f /tmp/acms_smoke.jar

echo "=== 24. Response compression ==="
# Asserted here rather than trusted, because compression is invisible when it
# works and equally invisible when it silently stops working — a middleware
# ordering change or a proxy stripping Accept-Encoding would cost bandwidth on
# every request with nothing on any screen to show for it.
enc()  { curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "$@" \
           | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{print tolower($2)}'; }
vary() { curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "$@" \
           | tr -d '\r' | awk 'tolower($1)=="vary:"{print tolower($0)}' | grep -c 'accept-encoding'; }
size() { curl -s -o /dev/null -w '%{size_download}' "$@"; }

RAW=$(size $API/accounts -H "Authorization: Bearer $CEO" -H 'Accept-Encoding: identity')
GZ=$(size $API/accounts -H "Authorization: Bearer $CEO" -H 'Accept-Encoding: gzip')

# If the seeded list were under the threshold the compression checks below
# would pass for the wrong reason, so the fixture is asserted before it is used.
[ "$RAW" -gt 1024 ] && ok "account list is large enough to be a real test (${RAW}B)" \
  || bad "account list large enough to test" "only ${RAW}B, at or under the 1KB threshold"

check "a JSON list is gzipped when the client accepts it" \
  "$(enc $API/accounts -H "Authorization: Bearer $CEO")" "gzip"
check "and says so in Vary, so a cache cannot serve it to a client that cannot read it" \
  "$(vary $API/accounts -H "Authorization: Bearer $CEO")" "1"
[ "$GZ" -lt "$RAW" ] && ok "compressed smaller than raw (${GZ}B vs ${RAW}B, $(( 100 - GZ * 100 / RAW ))% saved)" \
  || bad "compressed smaller than raw" "gzip ${GZ}B vs raw ${RAW}B"

# A client that did not ask must still get plain JSON. Compressing regardless
# would break anything reading the body without a gzip decoder.
check "a client that does not accept gzip still gets plain JSON" \
  "$(curl -s -D - -o /dev/null -H 'Accept-Encoding: identity' $API/accounts -H "Authorization: Bearer $CEO" \
     | tr -d '\r' | awk 'tolower($1)=="content-encoding:"{print tolower($2)}')" ""

# Under the threshold nothing is gained: the gzip framing can make a short reply
# longer than it started, and the liveness probe runs constantly.
check "a tiny response is left alone" "$(enc $API/health/live)" ""

echo "=== 25. Release 2/7 gaps: relationships, bid team and the clause register ==="

# This section builds its own fixtures. Section 22 soft-deletes the scoped
# account and the opportunity it borrowed from earlier sections, to prove that
# deletes are soft — so reusing those two here would test nothing but the 404
# they now correctly return.
#
# Who creates each one is the whole point. The account manager holds an OWN
# scope, so a record the CEO created is invisible to them by the scope rule,
# not by any fault of these modules — the near end and the bid are therefore
# made by the account manager, and only the far end by the CEO.
NEAR=$(curl -s -X POST $API/accounts -H "Authorization: Bearer $AM" -H 'Content-Type: application/json' \
  -d '{"legalName":"Smoke Relationship Near Ltd","type":"VENDOR","country":"EG"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
FAR=$(curl -s -X POST $API/accounts -H "Authorization: Bearer $CEO" -H 'Content-Type: application/json' \
  -d '{"legalName":"Smoke Relationship Far Ltd","type":"VENDOR","country":"EG"}' \
  | JQ "print(json.load(sys.stdin)['id'])")
TEAM_OPP=$(curl -s -X POST $API/opportunities -H "Authorization: Bearer $AM" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Team Bid","accountId":"'$NEAR'","country":"EG","currency":"USD"}' \
  | JQ "print(json.load(sys.stdin)['id'])")

# --- account relationships -------------------------------------------------
# $NEAR belongs to the account manager; $FAR was created by the CEO just above
# precisely because it is outside the account manager's scope. The pair is what
# makes the visibility checks below mean anything.

REL=$(curl -s -X POST $API/accounts/$NEAR/relationships -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"toId":"'$FAR'","typeCode":"PARENT","notes":"smoke"}' \
  | JQ "print(json.load(sys.stdin).get('id','NONE'))")
[ "$REL" != "NONE" ] && ok "a relationship is recorded" || bad "relationship recorded" "$REL"

check "an account cannot be related to itself" \
  "$(code -X POST $API/accounts/$NEAR/relationships -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"toId":"'$NEAR'","typeCode":"JV_PARTNER"}')" "400"

# The whole security question in this module: naming an id you cannot see must
# not read its legal name back out of the list.
check "linking to an account outside your scope is refused as absent" \
  "$(code -X POST $API/accounts/$NEAR/relationships -H "Authorization: Bearer $AM" \
     -H 'Content-Type: application/json' -d '{"toId":"'$FAR'","typeCode":"PARENT"}')" "404"

check "the link reads as PARENT from the account it was recorded on" \
  "$(curl -s $API/accounts/$NEAR/relationships -H "Authorization: Bearer $CEO" \
     | JQ "print(next(r['typeCode'] for r in json.load(sys.stdin)['items'] if r['id']=='$REL'))")" "PARENT"

# Stored once, read from both ends. Without the flip, a subsidiary's own file
# would never mention its parent.
check "and as SUBSIDIARY from the other end, from the same single row" \
  "$(curl -s $API/accounts/$FAR/relationships -H "Authorization: Bearer $CEO" \
     | JQ "print(next(r['typeCode'] for r in json.load(sys.stdin)['items'] if r['id']=='$REL'))")" "SUBSIDIARY"

check "recording the same fact from the other side is refused as a duplicate" \
  "$(code -X POST $API/accounts/$FAR/relationships -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"toId":"'$NEAR'","typeCode":"SUBSIDIARY"}')" "400"

# The counterparty is dropped whole rather than shown blank: a row naming a
# customer you are not allowed to know exists is the leak this prevents.
check "a link whose far end is out of scope disappears for that reader" \
  "$(curl -s $API/accounts/$NEAR/relationships -H "Authorization: Bearer $AM" \
     | JQ "print(any(r['id']=='$REL' for r in json.load(sys.stdin)['items']))")" "False"

curl -s -o /dev/null -X DELETE $API/relationships/$REL -H "Authorization: Bearer $CEO"
check "removing a relationship is a soft delete" \
  "$(psql_ "select (\"deletedAt\" is not null) from \"AccountRelationship\" where id='$REL';")" "t"

check "and re-adding it revives the same row rather than colliding" \
  "$(curl -s -X POST $API/accounts/$NEAR/relationships -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"toId":"'$FAR'","typeCode":"PARENT"}' \
     | JQ "print(json.load(sys.stdin).get('id'))")" "$REL"

# --- bid team --------------------------------------------------------------

TM_USER=$(psql_ "select \"userId\" from \"UserRole\" order by \"userId\" limit 1;")
TM_ROLE=$(psql_ "select role::text from \"UserRole\" where \"userId\"='$TM_USER' order by role limit 1;")
TM_BAD=$(psql_ "select r::text from unnest(enum_range(NULL::\"Role\")) r
                where r::text not in (select role::text from \"UserRole\" where \"userId\"='$TM_USER')
                order by r limit 1;")
TM_USER2=$(psql_ "select \"userId\" from \"UserRole\" where \"userId\" <> '$TM_USER' order by \"userId\" limit 1;")
TM_ROLE2=$(psql_ "select role::text from \"UserRole\" where \"userId\"='$TM_USER2' order by role limit 1;")

check "the candidate list is readable without being an administrator" \
  "$(code $API/opportunities/$TEAM_OPP/team/candidates -H "Authorization: Bearer $AM")" "200"

# /users is SYSTEM_ADMIN only and carries emails and login history. Staffing a
# bid needs neither, so the thin list must not start leaking them.
check "and it carries no email addresses" \
  "$(curl -s $API/opportunities/$TEAM_OPP/team/candidates -H "Authorization: Bearer $CEO" \
     | JQ "print(any('email' in u for u in json.load(sys.stdin)['items']))")" "False"

TM=$(curl -s -X POST $API/opportunities/$TEAM_OPP/team -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"'$TM_USER'","role":"'$TM_ROLE'","isLead":true}' \
  | JQ "print(json.load(sys.stdin).get('id','NONE'))")
[ "$TM" != "NONE" ] && ok "somebody is put on the bid team under a role they hold" \
  || bad "team member added" "$TM"

# A FINANCE line on the bid team that finance never granted reads as a control
# and is not one.
check "a role the person does not hold is refused" \
  "$(code -X POST $API/opportunities/$TEAM_OPP/team -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"userId":"'$TM_USER'","role":"'$TM_BAD'"}')" "400"

check "the team reports that it has a lead" \
  "$(curl -s $API/opportunities/$TEAM_OPP/team -H "Authorization: Bearer $CEO" \
     | JQ "print(json.load(sys.stdin)['hasLead'])")" "True"

TM2=$(curl -s -X POST $API/opportunities/$TEAM_OPP/team -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"'$TM_USER2'","role":"'$TM_ROLE2'","isLead":true}' \
  | JQ "print(json.load(sys.stdin).get('id','NONE'))")

# "Lead" is a claim about the bid, not about the person, so it can only be true
# once — the incumbent steps down in the same transaction.
check "naming a new lead steps the previous one down" \
  "$(curl -s $API/opportunities/$TEAM_OPP/team -H "Authorization: Bearer $CEO" \
     | JQ "print(sum(1 for m in json.load(sys.stdin)['items'] if m['isLead']))")" "1"

curl -s -o /dev/null -X DELETE $API/team-members/$TM2 -H "Authorization: Bearer $CEO"
check "removing a member is a soft delete, so who was on the bid survives" \
  "$(psql_ "select (\"deletedAt\" is not null) from \"OpportunityTeam\" where id='$TM2';")" "t"

# --- contract clauses ------------------------------------------------------
# $R7_CNT is the reviewed contract from section 19.

CL=$(curl -s -X POST $API/contracts/$R7_CNT/clauses -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' \
  -d '{"clauseType":"LIABILITY_CAP","clauseText":"Liability is uncapped.","riskLevel":"CRITICAL"}' \
  | JQ "print(json.load(sys.stdin).get('id','NONE'))")
[ "$CL" != "NONE" ] && ok "a clause is registered" || bad "clause registered" "$CL"

check "a clause never arrives approved, whoever registered it" \
  "$(psql_ "select \"isApproved\" from \"ContractClause\" where id='$CL';")" "f"

# Approving an uncapped liability with nothing written down records a decision
# nobody can explain later.
check "a critical clause cannot be approved with an empty mitigation" \
  "$(code -X POST $API/clauses/$CL/approve -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{}')" "400"

check "and the register says how many high-risk clauses are still owed" \
  "$(curl -s $API/contracts/$R7_CNT/clauses -H "Authorization: Bearer $CEO" \
     | JQ "print(json.load(sys.stdin)['unapprovedHighRisk'])")" "1"

check "it goes through once a mitigation is written" \
  "$(code -X POST $API/clauses/$CL/approve -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"mitigation":"Insured to 5M; board informed."}')" "201"

check "approving twice is refused" \
  "$(code -X POST $API/clauses/$CL/approve -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"mitigation":"again"}')" "400"

# An approval is approval of a specific text. Letting the words move underneath
# it would leave the register asserting somebody approved wording never read.
curl -s -o /dev/null -X PATCH $API/clauses/$CL -H "Authorization: Bearer $CEO" \
  -H 'Content-Type: application/json' -d '{"clauseText":"Liability is capped at contract value."}'
check "changing the wording re-opens the sign-off" \
  "$(psql_ "select \"isApproved\" from \"ContractClause\" where id='$CL';")" "f"

check "correcting only the owner leaves the sign-off standing" \
  "$(curl -s -X POST $API/clauses/$CL/approve -H "Authorization: Bearer $CEO" \
     -H 'Content-Type: application/json' -d '{"mitigation":"Capped; accepted."}' >/dev/null; \
     curl -s -o /dev/null -X PATCH $API/clauses/$CL -H "Authorization: Bearer $CEO" \
       -H 'Content-Type: application/json' -d '{"owner":"Legal - Cairo"}'; \
     psql_ "select \"isApproved\" from \"ContractClause\" where id='$CL';")" "t"

check "a clause on a contract outside your scope is absent, not forbidden" \
  "$(code $API/contracts/$R7_CNT/clauses -H "Authorization: Bearer $AM")" "404"

curl -s -o /dev/null -X DELETE $API/clauses/$CL -H "Authorization: Bearer $CEO"
check "removing a clause is a soft delete" \
  "$(psql_ "select (\"deletedAt\" is not null) from \"ContractClause\" where id='$CL';")" "t"

# --- the three screens render ----------------------------------------------
curl -s -c /tmp/acms_smoke2.jar -o /dev/null -X POST $WEB/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"ceo@afro.example\",\"password\":\"$SEED_PASSWORD\"}"
for L in ar en fr; do
  # Asserted on the data, not on a 200. The page returns 200 whether or not the
  # panel found anything, so the counterparty's own name is the only evidence
  # that the relationship was read, flipped and rendered.
  check "$L account file shows the relationship it holds" \
    "$(curl -s -b /tmp/acms_smoke2.jar $WEB/$L/accounts/$NEAR \
       | grep -q 'Smoke Relationship Far Ltd' && echo yes || echo no)" "yes"
  check "$L opportunity file renders with the bid team" \
    "$(code -b /tmp/acms_smoke2.jar $WEB/$L/opportunities/$TEAM_OPP)" "200"
  check "$L contract screen renders with the clause register" \
    "$(code -b /tmp/acms_smoke2.jar $WEB/$L/opportunities/$R7_OPP/contract)" "200"
done

echo "=== 26. The proposals screen ==="
# $R7_OPP carries an approved costing and the "Smoke offer" proposal from
# section 19, which is exactly the state this screen exists to work in.

for L in ar en fr; do
  check "$L proposals screen lists the proposal" \
    "$(curl -s -b /tmp/acms_smoke2.jar $WEB/$L/opportunities/$R7_OPP/proposals \
       | grep -q 'Smoke offer' && echo yes || echo no)" "yes"
done

# The writes below go through the web app's own routes with the session cookie,
# not straight to the API with a bearer token. That is the path the screen
# actually takes, and until now nothing proved it existed.
wpost() { curl -s -b /tmp/acms_smoke2.jar -o /dev/null -w '%{http_code}' \
  -X POST "$WEB$1" -H 'Content-Type: application/json' -d "$2"; }

SPRP=$(curl -s -b /tmp/acms_smoke2.jar -X POST $WEB/api/opportunities/$R7_OPP/proposals \
  -H 'Content-Type: application/json' -d '{"title":"Smoke screen offer"}' \
  | JQ "print(json.load(sys.stdin).get('id','NONE'))")
[ "$SPRP" != "NONE" ] && ok "a proposal is created from the screen" \
  || bad "proposal created through the web route" "$SPRP"

# A technical proposal quotes nothing, so it needs no costing behind it.
check "a technical version needs no costing" \
  "$(wpost /api/proposals/$SPRP/versions '{"type":"TECHNICAL"}')" "200"

# The screen refuses to offer this combination at all, but the refusal has to
# hold underneath it too: the form is a convenience, never the control.
check "a commercial version with no costing is refused through the same route" \
  "$(wpost /api/proposals/$SPRP/versions '{"type":"COMMERCIAL"}')" "400"

check "and goes through against the approved costing" \
  "$(wpost /api/proposals/$SPRP/versions \
     '{"type":"COMMERCIAL","costingVersionId":"'$R7_VER'","sellingPrice":'$R7_PRICE'}')" "200"

SPV=$(psql_ "select v.id from \"ProposalVersion\" v where v.\"proposalId\"='$SPRP'
             and v.type='COMMERCIAL' limit 1;")
check "sending it from the screen records who it went to" \
  "$(wpost /api/proposal-versions/$SPV/submit '{"submittedTo":"Smoke Customer","submissionMethod":"EMAIL"}')" "200"
check "the recipient is stored, not merely accepted" \
  "$(psql_ "select \"submittedTo\" from \"ProposalVersion\" where id='$SPV';")" "Smoke Customer"

# What the customer holds is a fact. The screen hides the send button on a sent
# version; the API refuses regardless, which is the half that matters.
check "and it cannot be sent twice" \
  "$(wpost /api/proposal-versions/$SPV/submit '{"submittedTo":"Again"}')" "400"

echo "=== 27. Moving a deal from the screen ==="
# The stage is the journey the whole system is built on, and until now it could
# only be moved from an API client. These go through the web route the button
# calls, because that is the part that was missing.

SOPP=$(curl -s -b /tmp/acms_smoke2.jar -X POST $WEB/api/opportunities -H 'Content-Type: application/json'   -d '{"name":"Smoke stage move","accountId":"'$NEAR'","country":"EG","currency":"USD"}'   | JQ "print(json.load(sys.stdin).get('id','NONE'))")

# A deal one field short of the next stage: the refusal is the feature.
REFUSED=$(curl -s -b /tmp/acms_smoke2.jar -X POST $WEB/api/opportunities/$SOPP/stage   -H 'Content-Type: application/json' -d '{"toStage":"LEAD_QUALIFICATION"}')
check "an incomplete stage move is refused through the web route"   "$(echo "$REFUSED" | JQ "print(json.load(sys.stdin).get('statusCode'))")" "400"
check "and the refusal names the missing fields rather than counting them"   "$(echo "$REFUSED" | JQ "print(len(json.load(sys.stdin).get('missingFields',[]))>0)")" "True"

# Supplying the fields is not what is under test here, so it goes straight to
# the API — the web route being proven is the stage move itself.
curl -s -o /dev/null -X PATCH $API/opportunities/$SOPP -H "Authorization: Bearer $CEO"   -H 'Content-Type: application/json'   -d '{"source":"TENDER_PORTAL","industry":"FTTH","estimatedValue":100000,"nextStep":"Site survey"}'
check "and goes through once they are supplied"   "$(curl -s -b /tmp/acms_smoke2.jar -o /dev/null -w '%{http_code}' -X POST $WEB/api/opportunities/$SOPP/stage      -H 'Content-Type: application/json' -d '{"toStage":"LEAD_QUALIFICATION","reason":"smoke"}')" "200"
check "the move is recorded with who moved it and why"   "$(psql_ "select reason from \"OpportunityStageHistory\" where \"opportunityId\"='$SOPP' order by \"createdAt\" desc limit 1;")" "smoke"

curl -s -o /dev/null -X DELETE $API/opportunities/$SOPP -H "Authorization: Bearer $CEO"

rm -f /tmp/acms_smoke2.jar

echo
echo "==================== $PASS passed, $FAIL failed ===================="
[ "$FAIL" -eq 0 ]
