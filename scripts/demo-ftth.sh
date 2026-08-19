#!/usr/bin/env bash
#
# Demo data — the FTTH story used in docs/client-walkthrough.md.
#
#   ssh <server> 'cd ~/acms && bash scripts/demo-ftth.sh'
#
# Everything is created THROUGH THE API, never by writing rows: the data has to
# obey the same governance the screens do, or a screenshot would be showing a
# state the system cannot actually reach. The costing is approved by finance
# because the estimator who built it is refused (SoD 1), the supplier is chosen
# with a written rationale because a bare selection is refused (SoD 3), and the
# proposal carries the approved costing's price because nothing else is allowed.
#
# Safe to re-run: it soft-deletes what a previous run created, by name.

set -u

API=${API:-http://100.122.6.64:4000/api}
SEED_PASSWORD=${SEED_PASSWORD:-ChangeMe#2026}
DB=${DB:-acms-postgres-1}

JQ() { python3 -c "import sys,json;$1"; }
psql_() { docker exec $DB psql -U acms -d acms -tAc "$1"; }
login() {
  curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$SEED_PASSWORD\"}" \
    | JQ "print(json.load(sys.stdin).get('accessToken','NONE'))"
}
id_of() { JQ "print(json.load(sys.stdin).get('id','NONE'))"; }
post() { curl -s -X POST "$API$1" -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -X PATCH "$API$1" -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "$3"; }
say() { echo "  · $1"; }

CEO=$(login ceo@afro.example)
AM=$(login am@afro.example)
EST=$(login estimation@afro.example)
FIN=$(login finance@afro.example)
SD=$(login sales.director@afro.example)
[ "$CEO" = "NONE" ] && { echo "login failed — is the API up?"; exit 1; }

echo "=== 0. Clearing the test residue and any previous demo run ==="
# The smoke suite leaves "Smoke ..." rows behind by design (nothing is ever hard
# deleted). They are harmless to the system and fatal to a screenshot, so they
# are soft-deleted here exactly as the API would: the row stays, the screen does
# not show it.
psql_ "update \"Opportunity\" set \"deletedAt\"=now() where \"deletedAt\" is null and (name like 'Smoke%' or name like 'FTTH %' or name like 'Headquarters network%' or name like 'Fibre to 40%' or name like 'Transmission towers%');" >/dev/null
psql_ "update \"Lead\" set \"deletedAt\"=now() where \"deletedAt\" is null and (name like 'Smoke%' or name like 'FTTH tender%');" >/dev/null
psql_ "update \"Account\" set \"deletedAt\"=now() where \"deletedAt\" is null and (\"legalName\" like 'Smoke%' or \"legalName\" like 'Nile Telecom%' or \"legalName\" like 'Egyptian Network%' or \"legalName\" like 'Telecom Development%' or \"legalName\" like 'Madagascar Telecom%');" >/dev/null
psql_ "update \"BusinessPartner\" set \"deletedAt\"=now() where \"deletedAt\" is null and (\"legalName\" like 'Smoke%' or \"legalName\" like 'Egypt Cables%' or \"legalName\" like 'Delta Cable%' or \"legalName\" like 'Sharq Contracting%');" >/dev/null
# Cost rules are global and apply to every costing, so a stray "Smoke G&A 10%"
# would quietly sit on top of the demo numbers.
# The smoke suite creates its own approval cycle each run; it belongs in the
# test residue rather than in a screenshot of the settings screen.
psql_ "update \"WorkflowDefinition\" set \"deletedAt\"=now() where \"deletedAt\" is null and code like 'SMOKE-%';" >/dev/null
psql_ "update \"CostRule\" set \"deletedAt\"=now() where \"deletedAt\" is null and (name like 'Smoke%' or name like 'To reject%' or name like 'General and administrative%' or name like 'Risk provision%');" >/dev/null
psql_ "update \"TaxRule\" set \"deletedAt\"=now() where \"deletedAt\" is null and (name like 'Smoke%' or name like 'Egyptian VAT%' or name like 'Withholding%');" >/dev/null
say "test rows hidden"

echo "=== 1. The customer, its group and its people ==="
HOLDING=$(post /accounts "$AM" '{"legalName":"Nile Telecom Holding","tradeName":"Nile Telecom","type":"OPERATOR","country":"EG","industry":"FTTH"}' | id_of)
ARM=$(post /accounts "$AM" '{"legalName":"Nile Telecom Networks","type":"OPERATOR","country":"EG","industry":"FTTH"}' | id_of)
post /accounts/$HOLDING/relationships "$AM" "{\"toId\":\"$ARM\",\"typeCode\":\"PARENT\",\"notes\":\"The operating arm that runs the fibre projects\"}" >/dev/null
say "holding + executive arm, one relationship read from both ends"

post /contacts "$AM" "{\"accountId\":\"$ARM\",\"fullName\":\"Ahmed Samir\",\"jobTitle\":\"Head of Networks\",\"influence\":\"HIGH\",\"roles\":[\"TECHNICAL_EVALUATOR\"],\"email\":\"a.samir@nile.example\"}" >/dev/null
CONTACT=$(post /contacts "$AM" "{\"accountId\":\"$ARM\",\"fullName\":\"Hala Fouad\",\"jobTitle\":\"Procurement Manager\",\"influence\":\"HIGH\",\"roles\":[\"DECISION_MAKER\",\"PROCUREMENT\"],\"isPrimary\":true,\"email\":\"h.fouad@nile.example\"}" | id_of)
post /contacts "$AM" "{\"accountId\":\"$ARM\",\"fullName\":\"Tarek Mansour\",\"jobTitle\":\"Chief Financial Officer\",\"influence\":\"MEDIUM\",\"roles\":[\"FINANCE\"]}" >/dev/null
say "three contacts, one primary"

echo "=== 2. The enquiry, qualified then converted ==="
LEAD=$(post /leads "$AM" '{"name":"FTTH tender - three governorates","source":"TENDER_PORTAL","country":"EG","estimatedValue":2400000,"nextStep":"Study the tender documents"}' | id_of)
post /activities "$AM" "{\"leadId\":\"$LEAD\",\"type\":\"CALL\",\"subject\":\"Qualification call with procurement\",\"notes\":\"Budget and schedule confirmed\"}" >/dev/null
patch /leads/$LEAD/status "$AM" '{"status":"QUALIFIED"}' >/dev/null
OPP=$(post /leads/$LEAD/convert "$AM" "{\"accountId\":\"$ARM\"}" | JQ "print(json.load(sys.stdin)['opportunity']['id'])")
say "lead converted — its call history went with it"

patch /opportunities/$OPP "$AM" "{\"name\":\"FTTH rollout - phase 1\",\"primaryContactId\":\"$CONTACT\",\"source\":\"TENDER_PORTAL\",\"industry\":\"FTTH\",\"currency\":\"USD\",\"estimatedValue\":2400000,\"expectedCloseDate\":\"2026-11-30T00:00:00.000Z\",\"nextStep\":\"Site survey across the three governorates\"}" >/dev/null

echo "=== 3. The bid team ==="
for PAIR in "am@afro.example:ACCOUNT_MANAGER:true" "estimation@afro.example:ESTIMATION:false" "finance@afro.example:FINANCE:false"; do
  EMAIL=${PAIR%%:*}; REST=${PAIR#*:}; ROLE=${REST%%:*}; LEADFLAG=${REST##*:}
  UID_=$(psql_ "select id from \"User\" where email='$EMAIL';")
  post /opportunities/$OPP/team "$AM" "{\"userId\":\"$UID_\",\"role\":\"$ROLE\",\"isLead\":$LEADFLAG}" >/dev/null
done
say "three on the team, one lead"

echo "=== 4. The tender and the bid/no-bid decision ==="
BID=$(post /opportunities/$OPP/bids "$AM" '{"type":"PUBLIC_TENDER","tenderNumber":"TND-FTTH-2026-14","submissionDeadline":"2026-10-15T00:00:00Z","clarificationDeadline":"2026-09-20T00:00:00Z"}' | id_of)
post /bids/$BID/requirements "$AM" '{"description":"Bid bond, 2 percent of tender value","type":"FINANCIAL","mandatory":true}' >/dev/null
post /bids/$BID/requirements "$AM" '{"description":"Valid ISO 9001 certificate","type":"TECHNICAL","mandatory":true}' >/dev/null
post /bids/$BID/requirements "$AM" '{"description":"Three comparable FTTH references","type":"TECHNICAL","mandatory":true}' >/dev/null
post /bids/$BID/requirements "$AM" '{"description":"Company profile and trade licence","type":"ADMINISTRATIVE","mandatory":false}' >/dev/null

ASSESS=$(post /opportunities/$OPP/bid-assessment "$SD" '{"ratings":{"RELATIONSHIP_STRENGTH":4,"TECHNICAL_FIT":4,"DELIVERY_CAPACITY":3,"EXPECTED_PROFITABILITY":4,"PAYMENT_TERMS":3,"COMPETITION":2,"SCOPE_CLARITY":3,"STRATEGIC_VALUE":5},"notes":"Existing customer, scope clear on packages 1 and 2. Price competition is strong."}' | id_of)
post /bid-assessments/$ASSESS/decision "$SD" '{"decision":"BID_WITH_CONDITIONS","rationale":"Bid, conditional on fixing the cable price with the supplier before submission and on the customer carrying the excavation permits."}' >/dev/null
say "assessed on eight factors, decided with a written condition"

echo "=== 5. The scope ==="
P1=$(post /opportunities/$OPP/scope/packages "$AM" '{"name":"Cable and materials supply","category":"MATERIALS"}' | id_of)
P2=$(post /opportunities/$OPP/scope/packages "$AM" '{"name":"Civil works","category":"CIVIL_WORKS"}' | id_of)
P3=$(post /opportunities/$OPP/scope/packages "$AM" '{"name":"Installation and commissioning","category":"INSTALLATION"}' | id_of)
post /scope/packages/$P1/items "$AM" '{"name":"24F fibre optic cable","quantity":42000,"unit":"m"}' >/dev/null
post /scope/packages/$P1/items "$AM" '{"name":"Outdoor distribution cabinets","quantity":180,"unit":"cabinet"}' >/dev/null
post /scope/packages/$P2/items "$AM" '{"name":"Trenching and reinstatement","quantity":42,"unit":"km"}' >/dev/null
post /scope/packages/$P2/items "$AM" '{"name":"Inspection chambers","quantity":180,"unit":"chamber"}' >/dev/null
post /scope/packages/$P3/items "$AM" '{"name":"Splicing and installation","quantity":180,"unit":"point"}' >/dev/null
post /scope/packages/$P3/items "$AM" '{"name":"Testing and handover","quantity":3,"unit":"governorate","exclusion":"Excludes relocation of existing utilities"}' >/dev/null
post /opportunities/$OPP/assumptions "$AM" '{"description":"Excavation permits are provided by the customer","category":"COMMERCIAL","impactIfIncorrect":"At least two months of delay and unpriced permit costs"}' >/dev/null
post /opportunities/$OPP/assumptions "$AM" '{"description":"Soil is sandy along all three routes","category":"TECHNICAL","impactIfIncorrect":"Trenching cost rises 35 percent if rock is encountered"}' >/dev/null
post /opportunities/$OPP/clarifications "$AM" '{"question":"Does the scope include power meters for the cabinets?"}' >/dev/null
patch /opportunities/$OPP "$AM" '{"scopeSummary":"Three packages - cable supply, civil works, installation - across three governorates","solutionStrategy":"Mixed model: cable supplied in house, trenching subcontracted to an approved partner"}' >/dev/null
say "three packages, six items, two assumptions, one clarification"

echo "=== 6. The suppliers and their offers ==="
SUP_A=$(post /partners "$AM" '{"legalName":"Egypt Cables","country":"EG","types":["SUPPLIER"]}' | id_of)
SUP_B=$(post /partners "$AM" '{"legalName":"Delta Cable","country":"EG","types":["SUPPLIER"]}' | id_of)
SUB_C=$(post /partners "$AM" '{"legalName":"Sharq Contracting","country":"EG","types":["SUBCONTRACTOR"]}' | id_of)
patch /partners/$SUP_A/approval "$CEO" '{"approvalStatus":"APPROVED"}' >/dev/null
say "two suppliers and a civil subcontractor"

RFQ=$(post /opportunities/$OPP/rfqs "$AM" "{\"title\":\"RFQ - 24F fibre optic cable supply\",\"partnerIds\":[\"$SUP_A\",\"$SUP_B\"]}" | id_of)
patch /rfqs/$RFQ "$AM" '{"status":"ISSUED"}' >/dev/null

QA=$(post /opportunities/$OPP/quotations "$AM" "{\"partnerId\":\"$SUP_B\",\"rfqId\":\"$RFQ\",\"quotationNumber\":\"DC-2026-771\",\"validUntil\":\"2026-12-31T00:00:00.000Z\",\"deliveryDays\":84,\"paymentTerms\":\"50 percent advance\",\"items\":[{\"description\":\"24F fibre optic cable\",\"quantity\":42000,\"unitPrice\":11.43}]}" | id_of)
QB=$(post /opportunities/$OPP/quotations "$AM" "{\"partnerId\":\"$SUP_A\",\"rfqId\":\"$RFQ\",\"quotationNumber\":\"EC-2026-4410\",\"validUntil\":\"2026-12-31T00:00:00.000Z\",\"deliveryDays\":42,\"paymentTerms\":\"30 days from delivery\",\"items\":[{\"description\":\"24F fibre optic cable\",\"quantity\":42000,\"unitPrice\":11.81}]}" | id_of)
post /quotations/$QA/evaluation "$FIN" '{"priceScore":5,"technicalScore":3,"deliveryScore":2,"paymentScore":2,"qualityScore":3,"riskScore":3,"recommendation":"Cheapest, but 12 weeks delivery and 50 percent up front"}' >/dev/null
post /quotations/$QB/evaluation "$FIN" '{"priceScore":4,"technicalScore":5,"deliveryScore":5,"paymentScore":4,"qualityScore":5,"riskScore":4,"recommendation":"USD 16k dearer, six weeks faster, better payment terms"}' >/dev/null
post /quotations/$QB/select "$AM" '{"rationale":"USD 16k dearer for six weeks earlier delivery. Liquidated damages in this tender run at 5 percent per week, so the delay alone would cost several times the difference."}' >/dev/null
say "two offers compared, the dearer one chosen with the reason written down"

echo "=== 7. The costing — built by estimation, approved by finance ==="
SCN=$(post /opportunities/$OPP/costing "$EST" '{"name":"Mixed model","type":"MIXED_MODEL","currency":"USD"}' | id_of)
VER=$(post /costing/scenarios/$SCN/versions "$EST" '{}' | id_of)
CP1=$(post /costing/versions/$VER/packages "$EST" '{"name":"Cable and materials supply","type":"MATERIALS"}' | id_of)
CP2=$(post /costing/versions/$VER/packages "$EST" '{"name":"Civil works","type":"CIVIL_WORKS"}' | id_of)
CP3=$(post /costing/versions/$VER/packages "$EST" '{"name":"Installation and commissioning","type":"INSTALLATION"}' | id_of)

I1=$(post /costing/packages/$CP1/items "$EST" '{"description":"24F fibre optic cable","quantity":42000,"unit":"m"}' | id_of)
post /costing/items/$I1/breakdown "$EST" '{"quantity":42000,"unitCost":11.81,"source":"VENDOR_QUOTE","description":"From the selected Egypt Cables offer"}' >/dev/null
I2=$(post /costing/packages/$CP1/items "$EST" '{"description":"Outdoor distribution cabinets","quantity":180,"unit":"cabinet"}' | id_of)
post /costing/items/$I2/breakdown "$EST" '{"quantity":180,"unitCost":1450,"source":"MARKET_BENCHMARK"}' >/dev/null
I3=$(post /costing/packages/$CP2/items "$EST" '{"description":"Trenching and reinstatement","quantity":42,"unit":"km"}' | id_of)
post /costing/items/$I3/breakdown "$EST" '{"quantity":42,"unitCost":13500,"source":"SUBCONTRACTOR_QUOTE","description":"From the Sharq Contracting offer"}' >/dev/null
I4=$(post /costing/packages/$CP2/items "$EST" '{"description":"Inspection chambers","quantity":180,"unit":"chamber"}' | id_of)
post /costing/items/$I4/breakdown "$EST" '{"quantity":180,"unitCost":819,"source":"HISTORICAL_RATE"}' >/dev/null
I5=$(post /costing/packages/$CP3/items "$EST" '{"description":"Splicing, installation and commissioning","quantity":180,"unit":"point"}' | id_of)
post /costing/items/$I5/breakdown "$EST" '{"quantity":180,"unitCost":1270,"source":"INTERNAL_RATE"}' >/dev/null

# 29.17% on DIRECT cost puts the price at 2.4M; once the 10% of overheads
# below is added the margin the company actually earns reads 22.1%, and the
# screen shows both numbers side by side rather than one of them.
for I in $I1 $I2 $I3 $I4 $I5; do patch /costing/items/$I "$EST" '{"targetMarginPercent":29.17}' >/dev/null; done
RULE_A=$(post /cost-rules "$EST" '{"name":"General and administrative overhead","category":"OVERHEAD","method":"PERCENT_OF_DIRECT_COST","value":7,"note":"Approved rate for the telecom business unit"}' | id_of)
RULE_B=$(post /cost-rules "$EST" '{"name":"Risk provision","category":"RISK_PROVISION","method":"PERCENT_OF_DIRECT_COST","value":3,"note":"Soil risk and permit delays"}' | id_of)
post /cost-rules/$RULE_A/decision "$FIN" '{"approve":true}' >/dev/null
post /cost-rules/$RULE_B/decision "$FIN" '{"approve":true}' >/dev/null

# Two tax rules, proposed by estimation and approved by finance — the same
# separation the cost rules have, and the reason neither is a field somebody
# types into a costing.
TAX_A=$(post /tax-rules "$EST" '{"name":"Egyptian VAT","taxType":"VAT","base":"SELLING_PRICE","ratePercent":14,"country":"EG","effectiveFrom":"2026-01-01T00:00:00.000Z","note":"Charged to the customer on the invoice"}' | id_of)
TAX_B=$(post /tax-rules "$EST" '{"name":"Withholding on subcontractors","taxType":"WITHHOLDING","base":"SUBCONTRACTOR_PAYMENTS","ratePercent":5,"country":"EG","effectiveFrom":"2026-01-01T00:00:00.000Z","note":"Deducted from what the subcontractor is paid"}' | id_of)
post /tax-rules/$TAX_A/decision "$FIN" '{"approve":true}' >/dev/null
post /tax-rules/$TAX_B/decision "$FIN" '{"approve":true}' >/dev/null
say "two tax rates approved by finance"

post /costing/versions/$VER/submit "$EST" '{}' >/dev/null
post /costing/versions/$VER/approve "$FIN" '{}' >/dev/null
PRICE=$(psql_ "select \"totalPrice\" from \"CostingVersion\" where id='$VER';")
COST=$(psql_ "select \"totalCost\" from \"CostingVersion\" where id='$VER';")
MARGIN=$(psql_ "select \"marginPercent\" from \"CostingVersion\" where id='$VER';")
say "cost $COST · price $PRICE · margin $MARGIN%"

echo "=== 8. The offer to the customer ==="
patch /opportunities/$OPP "$AM" "{\"estimatedCost\":$COST,\"proposedPrice\":$PRICE}" >/dev/null
PRP=$(post /opportunities/$OPP/proposals "$AM" "{\"title\":\"FTTH offer - phase 1\",\"bidId\":\"$BID\"}" | id_of)
PV1=$(post /proposals/$PRP/versions "$AM" "{\"type\":\"COMMERCIAL\",\"costingVersionId\":\"$VER\",\"sellingPrice\":$PRICE,\"currency\":\"USD\",\"validUntil\":\"2026-12-15T00:00:00.000Z\",\"paymentTerms\":\"30 days from invoice date\",\"durationDays\":180,\"warrantyMonths\":12,\"ldPercent\":5,\"liabilityCap\":$PRICE}" | id_of)
post /proposal-versions/$PV1/submit "$AM" '{"submittedTo":"Procurement - Nile Telecom","submissionMethod":"Tender portal"}' >/dev/null
PV2=$(post /proposals/$PRP/versions "$AM" "{\"type\":\"BAFO\",\"costingVersionId\":\"$VER\",\"sellingPrice\":$PRICE,\"currency\":\"USD\",\"validUntil\":\"2027-01-15T00:00:00.000Z\",\"paymentTerms\":\"30 days from invoice date\",\"durationDays\":165,\"warrantyMonths\":12,\"ldPercent\":5,\"liabilityCap\":$PRICE}" | id_of)
post /proposal-versions/$PV2/submit "$AM" '{"submittedTo":"Procurement - Nile Telecom","submissionMethod":"Email"}' >/dev/null
say "version 1 sent then superseded by the best-and-final"

echo "=== 9. The award and the contract that does not match it ==="
post /opportunities/$OPP/awards "$CEO" '{"type":"LETTER_OF_INTENT","awardedAt":"2026-11-05T00:00:00.000Z","awardedValue":2300000}' >/dev/null
post /opportunities/$OPP/awards "$CEO" '{"type":"PURCHASE_ORDER","awardedAt":"2026-11-20T00:00:00.000Z","awardedValue":2300000,"customerReference":"PO-NT-2026-3391","erpCostCode":"OPP-FTTH-001","erpCostCenter":"CC-FTTH-2026"}' >/dev/null

CNT=$(post /opportunities/$OPP/contracts "$CEO" "{\"proposalVersionId\":\"$PV2\",\"contractNumber\":\"NT-CNT-2026-118\",\"contractValue\":2300000,\"currency\":\"USD\",\"paymentTerms\":\"60 days from invoice date\",\"warrantyMonths\":24,\"ldPercent\":10,\"startDate\":\"2027-01-05T00:00:00.000Z\",\"endDate\":\"2027-07-05T00:00:00.000Z\"}" | id_of)
post /contracts/$CNT/review "$CEO" '{}' >/dev/null
DEV=$(psql_ "select count(*) from \"ContractDeviation\" where \"contractId\"='$CNT' and \"deletedAt\" is null;")
say "contract reviewed against the offer — $DEV deviations found"

post /contracts/$CNT/clauses "$CEO" '{"clauseType":"LIABILITY_CAP","clauseText":"Contractor liability for indirect damages is not capped.","riskLevel":"CRITICAL","owner":"Legal"}' >/dev/null
CL=$(psql_ "select id from \"ContractClause\" where \"contractId\"='$CNT' and \"clauseType\"='LIABILITY_CAP' limit 1;")
post /clauses/$CL/approve "$CEO" '{"mitigation":"Public liability insurance to USD 5M, and the board is informed before signature."}' >/dev/null
post /contracts/$CNT/clauses "$CEO" '{"clauseType":"PENALTIES","clauseText":"Liquidated damages of 10 percent per week, capped at 20 percent of the contract value.","riskLevel":"HIGH","owner":"Project management"}' >/dev/null
say "clause register: one critical approved with a mitigation, one high still owed"

echo "=== 10. Walking the deal up the stages ==="
# Done last, and through the same endpoint a user clicks: each move re-checks
# the stage's exit requirements, so a demo that reaches AWARD_CONTRACTING is
# itself proof that everything those stages demand is actually present.
advance() {
  R=$(post /opportunities/$OPP/stage "$AM" "{\"toStage\":\"$1\",\"reason\":\"$2\"}")
  M=$(echo "$R" | JQ "d=json.load(sys.stdin);print(','.join(d.get('missingFields',[])) if d.get('statusCode') else 'ok')")
  [ "$M" = "ok" ] || echo "    ! $1 refused — missing: $M"
}
patch /opportunities/$OPP "$AM" '{"bidNoBidScore":71,"submissionDate":"2026-10-14T00:00:00.000Z","awardedValue":2300000,"probability":80,"forecastCategory":"COMMIT"}' >/dev/null
# Stated after the fact rather than assumed: if any field above was refused the
# advance below says so by name instead of leaving a half-built demo.
advance OPPORTUNITY_QUALIFICATION "Qualification complete, primary contact named"
advance SCOPE_DISCOVERY "Site survey across the three governorates"
advance BID_STRATEGY_SOLUTION "Mixed delivery model agreed"
advance COSTING_SOURCING "Costing started and supplier RFQs issued"
advance OPERATIONAL_FINANCIAL_REVIEW "Costing approved"
advance MANAGEMENT_APPROVAL "Submitted for management approval"
advance PROPOSAL_SUBMISSION "Offer submitted through the tender portal"
advance CLARIFICATIONS_NEGOTIATION "Customer clarifications on package 2"
advance AWARD_CONTRACTING "Purchase order PO-NT-2026-3391 received"
say "the deal now sits at award and contracting, with its stage history behind it"

echo "=== 11. A board with more than one deal on it ==="
# The pipeline screenshot is meaningless with a single card. Three more deals,
# each stopped where a real one stops.
side() {
  A=$(post /accounts "$AM" "{\"legalName\":\"$1\",\"type\":\"$2\",\"country\":\"$3\",\"industry\":\"$4\"}" | id_of)
  O=$(post /opportunities "$AM" "{\"name\":\"$5\",\"accountId\":\"$A\",\"country\":\"$3\",\"currency\":\"USD\",\"estimatedValue\":$6,\"source\":\"$7\",\"industry\":\"$4\",\"nextStep\":\"$8\"}" | id_of)
  echo "$O"
}
O2=$(side "Egyptian Network Services" "ENTERPRISE" "EG" "ICT" "Headquarters network expansion" 320000 "EXISTING_CLIENT" "Draft the technical solution")
O3=$(side "Telecom Development Authority" "GOVERNMENT" "KE" "FTTH" "Fibre to 40 schools - Kenya" 780000 "TENDER_PORTAL" "Study the tender documents")
O4=$(side "Madagascar Telecom" "OPERATOR" "MG" "WIRELESS" "Transmission towers - phase 2" 1450000 "DIRECT_INVITATION" "Confirm the budget with the customer")
post /opportunities/$O4/stage "$AM" '{"toStage":"LEAD_QUALIFICATION","reason":"Confirm the budget with the customer"}' >/dev/null
say "three more deals, and one of them a stage further on"

echo
echo "==================== the demo scene is ready ===================="
echo "Customer (operating arm):   /en/accounts/$ARM"
echo "Customer (holding):         /en/accounts/$HOLDING"
echo "Opportunity:                /en/opportunities/$OPP"
echo "Scope:                      /en/opportunities/$OPP/scope"
echo "Tender:                     /en/opportunities/$OPP/bids"
echo "Supplier comparison:        /en/opportunities/$OPP/quotations"
echo "Costing:                    /en/opportunities/$OPP/costing"
echo "Proposals:                  /en/opportunities/$OPP/proposals"
echo "Award and contract:         /en/opportunities/$OPP/contract"
echo "Lead:                       /en/leads/$LEAD"
