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
psql_ "update \"Opportunity\" set \"deletedAt\"=now() where \"deletedAt\" is null and (name like 'Smoke%' or name like 'مشروع FTTH%' or name like 'مناقصة FTTH%' or name like 'توسعة شبكة%' or name like 'ربط ٤٠ مدرسة%' or name like 'أبراج نقل%');" >/dev/null
psql_ "update \"Lead\" set \"deletedAt\"=now() where \"deletedAt\" is null and (name like 'Smoke%' or name like 'مناقصة FTTH%');" >/dev/null
psql_ "update \"Account\" set \"deletedAt\"=now() where \"deletedAt\" is null and (\"legalName\" like 'Smoke%' or \"legalName\" like 'شركة النيل%' or \"legalName\" like 'النيل للاتصالات%' or \"legalName\" like 'الشركة المصرية%' or \"legalName\" like 'هيئة تنمية%' or \"legalName\" like 'مدغشقر تليكوم%');" >/dev/null
psql_ "update \"BusinessPartner\" set \"deletedAt\"=now() where \"deletedAt\" is null and (\"legalName\" like 'Smoke%' or \"legalName\" like 'مصر للكابلات%' or \"legalName\" like 'دلتا كابل%' or \"legalName\" like 'الشرق للمقاولات%');" >/dev/null
# Cost rules are global and apply to every costing, so a stray "Smoke G&A 10%"
# would quietly sit on top of the demo numbers.
psql_ "update \"CostRule\" set \"deletedAt\"=now() where \"deletedAt\" is null and (name like 'Smoke%' or name like 'أعباء%' or name like 'مخصص مخاطر%');" >/dev/null
say "test rows hidden"

echo "=== 1. The customer, its group and its people ==="
HOLDING=$(post /accounts "$AM" '{"legalName":"شركة النيل للاتصالات القابضة","tradeName":"النيل تيليكوم","type":"OPERATOR","country":"EG","industry":"FTTH"}' | id_of)
ARM=$(post /accounts "$AM" '{"legalName":"النيل للاتصالات — الذراع التنفيذي","type":"OPERATOR","country":"EG","industry":"FTTH"}' | id_of)
post /accounts/$HOLDING/relationships "$AM" "{\"toId\":\"$ARM\",\"typeCode\":\"PARENT\",\"notes\":\"الذراع التنفيذي المسؤول عن مشاريع الألياف\"}" >/dev/null
say "holding + executive arm, one relationship read from both ends"

post /contacts "$AM" "{\"accountId\":\"$ARM\",\"fullName\":\"م. أحمد سمير\",\"jobTitle\":\"مدير الشبكات\",\"influence\":\"HIGH\",\"roles\":[\"TECHNICAL_EVALUATOR\"],\"email\":\"a.samir@nile.example\"}" >/dev/null
CONTACT=$(post /contacts "$AM" "{\"accountId\":\"$ARM\",\"fullName\":\"أ. هالة فؤاد\",\"jobTitle\":\"مدير المشتريات\",\"influence\":\"HIGH\",\"roles\":[\"DECISION_MAKER\",\"PROCUREMENT\"],\"isPrimary\":true,\"email\":\"h.fouad@nile.example\"}" | id_of)
post /contacts "$AM" "{\"accountId\":\"$ARM\",\"fullName\":\"أ. طارق منصور\",\"jobTitle\":\"المدير المالي\",\"influence\":\"MEDIUM\",\"roles\":[\"FINANCE\"]}" >/dev/null
say "three contacts, one primary"

echo "=== 2. The enquiry, qualified then converted ==="
LEAD=$(post /leads "$AM" '{"name":"مناقصة FTTH — ثلاث محافظات","source":"TENDER_PORTAL","country":"EG","estimatedValue":2400000,"nextStep":"دراسة كراسة الشروط"}' | id_of)
post /activities "$AM" "{\"leadId\":\"$LEAD\",\"type\":\"CALL\",\"subject\":\"مكالمة تأهيل مع إدارة المشتريات\",\"notes\":\"تأكيد الميزانية والجدول الزمني\"}" >/dev/null
patch /leads/$LEAD/status "$AM" '{"status":"QUALIFIED"}' >/dev/null
OPP=$(post /leads/$LEAD/convert "$AM" "{\"accountId\":\"$ARM\"}" | JQ "print(json.load(sys.stdin)['opportunity']['id'])")
say "lead converted — its call history went with it"

patch /opportunities/$OPP "$AM" "{\"name\":\"مشروع FTTH — المرحلة الأولى\",\"primaryContactId\":\"$CONTACT\",\"source\":\"TENDER_PORTAL\",\"industry\":\"FTTH\",\"currency\":\"USD\",\"estimatedValue\":2400000,\"expectedCloseDate\":\"2026-11-30T00:00:00.000Z\",\"nextStep\":\"زيارة موقع في المحافظات الثلاث\"}" >/dev/null

echo "=== 3. The bid team ==="
for PAIR in "am@afro.example:ACCOUNT_MANAGER:true" "estimation@afro.example:ESTIMATION:false" "finance@afro.example:FINANCE:false"; do
  EMAIL=${PAIR%%:*}; REST=${PAIR#*:}; ROLE=${REST%%:*}; LEADFLAG=${REST##*:}
  UID_=$(psql_ "select id from \"User\" where email='$EMAIL';")
  post /opportunities/$OPP/team "$AM" "{\"userId\":\"$UID_\",\"role\":\"$ROLE\",\"isLead\":$LEADFLAG}" >/dev/null
done
say "three on the team, one lead"

echo "=== 4. The tender and the bid/no-bid decision ==="
BID=$(post /opportunities/$OPP/bids "$AM" '{"type":"PUBLIC_TENDER","tenderNumber":"TND-FTTH-2026-14","submissionDeadline":"2026-10-15T00:00:00Z","clarificationDeadline":"2026-09-20T00:00:00Z"}' | id_of)
post /bids/$BID/requirements "$AM" '{"description":"خطاب ضمان ابتدائي ٢٪","type":"FINANCIAL","mandatory":true}' >/dev/null
post /bids/$BID/requirements "$AM" '{"description":"شهادة ISO 9001 سارية","type":"TECHNICAL","mandatory":true}' >/dev/null
post /bids/$BID/requirements "$AM" '{"description":"خبرة مماثلة في ثلاثة مشاريع FTTH","type":"TECHNICAL","mandatory":true}' >/dev/null
post /bids/$BID/requirements "$AM" '{"description":"ملف الشركة والسجل التجاري","type":"ADMINISTRATIVE","mandatory":false}' >/dev/null

ASSESS=$(post /opportunities/$OPP/bid-assessment "$SD" '{"ratings":{"RELATIONSHIP_STRENGTH":4,"TECHNICAL_FIT":4,"DELIVERY_CAPACITY":3,"EXPECTED_PROFITABILITY":4,"PAYMENT_TERMS":3,"COMPETITION":2,"SCOPE_CLARITY":3,"STRATEGIC_VALUE":5},"notes":"عميل قائم، والنطاق واضح في الحزمتين الأولى والثانية. المنافسة قوية على السعر."}' | id_of)
post /bid-assessments/$ASSESS/decision "$SD" '{"decision":"BID_WITH_CONDITIONS","rationale":"نشارك بشرط تثبيت سعر الكابل من المورّد قبل التقديم، وتأكيد مسؤولية العميل عن تصاريح الحفر."}' >/dev/null
say "assessed on eight factors, decided with a written condition"

echo "=== 5. The scope ==="
P1=$(post /opportunities/$OPP/scope/packages "$AM" '{"name":"توريد الكابلات والمهمات","category":"MATERIALS"}' | id_of)
P2=$(post /opportunities/$OPP/scope/packages "$AM" '{"name":"الأعمال المدنية","category":"CIVIL_WORKS"}' | id_of)
P3=$(post /opportunities/$OPP/scope/packages "$AM" '{"name":"التركيب والتشغيل","category":"INSTALLATION"}' | id_of)
post /scope/packages/$P1/items "$AM" '{"name":"كابل ضوئي 24F","quantity":42000,"unit":"متر"}' >/dev/null
post /scope/packages/$P1/items "$AM" '{"name":"كابينات توزيع خارجية","quantity":180,"unit":"كابينة"}' >/dev/null
post /scope/packages/$P2/items "$AM" '{"name":"حفر وردم مسارات","quantity":42,"unit":"كم"}' >/dev/null
post /scope/packages/$P2/items "$AM" '{"name":"غرف تفتيش","quantity":180,"unit":"غرفة"}' >/dev/null
post /scope/packages/$P3/items "$AM" '{"name":"لحام وتركيب","quantity":180,"unit":"نقطة"}' >/dev/null
post /scope/packages/$P3/items "$AM" '{"name":"اختبار وتسليم","quantity":3,"unit":"محافظة","exclusion":"لا يشمل نقل المرافق القائمة"}' >/dev/null
post /opportunities/$OPP/assumptions "$AM" '{"description":"تصاريح الحفر على العميل","category":"COMMERCIAL","impactIfIncorrect":"تأخير شهرين على الأقل وتكلفة تصاريح غير مسعّرة"}' >/dev/null
post /opportunities/$OPP/assumptions "$AM" '{"description":"طبيعة التربة رملية في المسارات الثلاثة","category":"TECHNICAL","impactIfIncorrect":"ارتفاع تكلفة الحفر ٣٥٪ في حال الصخر"}' >/dev/null
post /opportunities/$OPP/clarifications "$AM" '{"question":"هل تشمل الأعمال توريد عدادات الطاقة للكابينات؟"}' >/dev/null
patch /opportunities/$OPP "$AM" '{"scopeSummary":"ثلاث حزم: توريد كابلات، أعمال مدنية، تركيب وتشغيل — في ثلاث محافظات","solutionStrategy":"نموذج مختلط: توريد ذاتي للكابلات وإسناد الحفر لمقاول باطن معتمد"}' >/dev/null
say "three packages, six items, two assumptions, one clarification"

echo "=== 6. The suppliers and their offers ==="
SUP_A=$(post /partners "$AM" '{"legalName":"مصر للكابلات","country":"EG","types":["SUPPLIER"]}' | id_of)
SUP_B=$(post /partners "$AM" '{"legalName":"دلتا كابل","country":"EG","types":["SUPPLIER"]}' | id_of)
SUB_C=$(post /partners "$AM" '{"legalName":"الشرق للمقاولات","country":"EG","types":["SUBCONTRACTOR"]}' | id_of)
patch /partners/$SUP_A/approval "$CEO" '{"approvalStatus":"APPROVED"}' >/dev/null
say "two suppliers and a civil subcontractor"

RFQ=$(post /opportunities/$OPP/rfqs "$AM" "{\"title\":\"طلب عرض سعر — توريد كابل ضوئي 24F\",\"partnerIds\":[\"$SUP_A\",\"$SUP_B\"]}" | id_of)
patch /rfqs/$RFQ "$AM" '{"status":"ISSUED"}' >/dev/null

QA=$(post /opportunities/$OPP/quotations "$AM" "{\"partnerId\":\"$SUP_B\",\"rfqId\":\"$RFQ\",\"quotationNumber\":\"DC-2026-771\",\"validUntil\":\"2026-12-31T00:00:00.000Z\",\"deliveryDays\":84,\"paymentTerms\":\"٥٠٪ مقدم\",\"items\":[{\"description\":\"كابل ضوئي 24F\",\"quantity\":42000,\"unitPrice\":11.43}]}" | id_of)
QB=$(post /opportunities/$OPP/quotations "$AM" "{\"partnerId\":\"$SUP_A\",\"rfqId\":\"$RFQ\",\"quotationNumber\":\"EC-2026-4410\",\"validUntil\":\"2026-12-31T00:00:00.000Z\",\"deliveryDays\":42,\"paymentTerms\":\"٣٠ يومًا من التوريد\",\"items\":[{\"description\":\"كابل ضوئي 24F\",\"quantity\":42000,\"unitPrice\":11.81}]}" | id_of)
post /quotations/$QA/evaluation "$FIN" '{"priceScore":5,"technicalScore":3,"deliveryScore":2,"paymentScore":2,"qualityScore":3,"riskScore":3,"recommendation":"الأرخص، لكن التسليم ١٢ أسبوعًا و٥٠٪ مقدمًا"}' >/dev/null
post /quotations/$QB/evaluation "$FIN" '{"priceScore":4,"technicalScore":5,"deliveryScore":5,"paymentScore":4,"qualityScore":5,"riskScore":4,"recommendation":"أعلى بـ١٦ ألفًا وتسليم أسرع بستة أسابيع وشروط سداد أفضل"}' >/dev/null
post /quotations/$QB/select "$AM" '{"rationale":"فارق السعر ١٦ ألف دولار مقابل ستة أسابيع تسليم أبكر. غرامة التأخير في المناقصة ٥٪ أسبوعيًا، أي أن التأخير وحده يكلّف أضعاف الفارق."}' >/dev/null
say "two offers compared, the dearer one chosen with the reason written down"

echo "=== 7. The costing — built by estimation, approved by finance ==="
SCN=$(post /opportunities/$OPP/costing "$EST" '{"name":"نموذج مختلط","type":"MIXED_MODEL","currency":"USD"}' | id_of)
VER=$(post /costing/scenarios/$SCN/versions "$EST" '{}' | id_of)
CP1=$(post /costing/versions/$VER/packages "$EST" '{"name":"توريد الكابلات والمهمات","type":"MATERIALS"}' | id_of)
CP2=$(post /costing/versions/$VER/packages "$EST" '{"name":"الأعمال المدنية","type":"CIVIL_WORKS"}' | id_of)
CP3=$(post /costing/versions/$VER/packages "$EST" '{"name":"التركيب والتشغيل","type":"INSTALLATION"}' | id_of)

I1=$(post /costing/packages/$CP1/items "$EST" '{"description":"كابل ضوئي 24F","quantity":42000,"unit":"متر"}' | id_of)
post /costing/items/$I1/breakdown "$EST" '{"quantity":42000,"unitCost":11.81,"source":"VENDOR_QUOTE","description":"عرض مصر للكابلات المختار"}' >/dev/null
I2=$(post /costing/packages/$CP1/items "$EST" '{"description":"كابينات توزيع خارجية","quantity":180,"unit":"كابينة"}' | id_of)
post /costing/items/$I2/breakdown "$EST" '{"quantity":180,"unitCost":1450,"source":"MARKET_BENCHMARK"}' >/dev/null
I3=$(post /costing/packages/$CP2/items "$EST" '{"description":"حفر وردم مسارات","quantity":42,"unit":"كم"}' | id_of)
post /costing/items/$I3/breakdown "$EST" '{"quantity":42,"unitCost":13500,"source":"SUBCONTRACTOR_QUOTE","description":"عرض الشرق للمقاولات"}' >/dev/null
I4=$(post /costing/packages/$CP2/items "$EST" '{"description":"غرف تفتيش","quantity":180,"unit":"غرفة"}' | id_of)
post /costing/items/$I4/breakdown "$EST" '{"quantity":180,"unitCost":819,"source":"HISTORICAL_RATE"}' >/dev/null
I5=$(post /costing/packages/$CP3/items "$EST" '{"description":"لحام وتركيب وتشغيل","quantity":180,"unit":"نقطة"}' | id_of)
post /costing/items/$I5/breakdown "$EST" '{"quantity":180,"unitCost":1270,"source":"INTERNAL_RATE"}' >/dev/null

# 29.17% on DIRECT cost puts the price at 2.4M; once the 10% of overheads
# below is added the margin the company actually earns reads 22.1%, and the
# screen shows both numbers side by side rather than one of them.
for I in $I1 $I2 $I3 $I4 $I5; do patch /costing/items/$I "$EST" '{"targetMarginPercent":29.17}' >/dev/null; done
RULE_A=$(post /cost-rules "$EST" '{"name":"أعباء إدارية وعمومية","category":"OVERHEAD","method":"PERCENT_OF_DIRECT_COST","value":7,"note":"نسبة معتمدة لوحدة الاتصالات"}' | id_of)
RULE_B=$(post /cost-rules "$EST" '{"name":"مخصص مخاطر","category":"RISK_PROVISION","method":"PERCENT_OF_DIRECT_COST","value":3,"note":"مخاطر التربة وتأخر التصاريح"}' | id_of)
post /cost-rules/$RULE_A/decision "$FIN" '{"approve":true}' >/dev/null
post /cost-rules/$RULE_B/decision "$FIN" '{"approve":true}' >/dev/null

post /costing/versions/$VER/submit "$EST" '{}' >/dev/null
post /costing/versions/$VER/approve "$FIN" '{}' >/dev/null
PRICE=$(psql_ "select \"totalPrice\" from \"CostingVersion\" where id='$VER';")
COST=$(psql_ "select \"totalCost\" from \"CostingVersion\" where id='$VER';")
MARGIN=$(psql_ "select \"marginPercent\" from \"CostingVersion\" where id='$VER';")
say "cost $COST · price $PRICE · margin $MARGIN%"

echo "=== 8. The offer to the customer ==="
patch /opportunities/$OPP "$AM" "{\"estimatedCost\":$COST,\"proposedPrice\":$PRICE}" >/dev/null
PRP=$(post /opportunities/$OPP/proposals "$AM" "{\"title\":\"عرض FTTH — المرحلة الأولى\",\"bidId\":\"$BID\"}" | id_of)
PV1=$(post /proposals/$PRP/versions "$AM" "{\"type\":\"COMMERCIAL\",\"costingVersionId\":\"$VER\",\"sellingPrice\":$PRICE,\"currency\":\"USD\",\"validUntil\":\"2026-12-15T00:00:00.000Z\",\"paymentTerms\":\"٣٠ يومًا من تاريخ الفاتورة\",\"durationDays\":180,\"warrantyMonths\":12,\"ldPercent\":5,\"liabilityCap\":$PRICE}" | id_of)
post /proposal-versions/$PV1/submit "$AM" '{"submittedTo":"إدارة المشتريات — النيل للاتصالات","submissionMethod":"بوابة المناقصات"}' >/dev/null
PV2=$(post /proposals/$PRP/versions "$AM" "{\"type\":\"BAFO\",\"costingVersionId\":\"$VER\",\"sellingPrice\":$PRICE,\"currency\":\"USD\",\"validUntil\":\"2027-01-15T00:00:00.000Z\",\"paymentTerms\":\"٣٠ يومًا من تاريخ الفاتورة\",\"durationDays\":165,\"warrantyMonths\":12,\"ldPercent\":5,\"liabilityCap\":$PRICE}" | id_of)
post /proposal-versions/$PV2/submit "$AM" '{"submittedTo":"إدارة المشتريات — النيل للاتصالات","submissionMethod":"بريد إلكتروني"}' >/dev/null
say "version 1 sent then superseded by the best-and-final"

echo "=== 9. The award and the contract that does not match it ==="
post /opportunities/$OPP/awards "$CEO" '{"type":"LETTER_OF_INTENT","awardedAt":"2026-11-05T00:00:00.000Z","awardedValue":2300000}' >/dev/null
post /opportunities/$OPP/awards "$CEO" '{"type":"PURCHASE_ORDER","awardedAt":"2026-11-20T00:00:00.000Z","awardedValue":2300000,"customerReference":"PO-NT-2026-3391","erpCostCode":"OPP-FTTH-001","erpCostCenter":"CC-FTTH-2026"}' >/dev/null

CNT=$(post /opportunities/$OPP/contracts "$CEO" "{\"proposalVersionId\":\"$PV2\",\"contractNumber\":\"NT-CNT-2026-118\",\"contractValue\":2300000,\"currency\":\"USD\",\"paymentTerms\":\"٦٠ يومًا من تاريخ الفاتورة\",\"warrantyMonths\":24,\"ldPercent\":10,\"startDate\":\"2027-01-05T00:00:00.000Z\",\"endDate\":\"2027-07-05T00:00:00.000Z\"}" | id_of)
post /contracts/$CNT/review "$CEO" '{}' >/dev/null
DEV=$(psql_ "select count(*) from \"ContractDeviation\" where \"contractId\"='$CNT' and \"deletedAt\" is null;")
say "contract reviewed against the offer — $DEV deviations found"

post /contracts/$CNT/clauses "$CEO" '{"clauseType":"LIABILITY_CAP","clauseText":"مسؤولية المقاول عن الأضرار غير المباشرة غير محدودة بسقف.","riskLevel":"CRITICAL","owner":"الإدارة القانونية"}' >/dev/null
CL=$(psql_ "select id from \"ContractClause\" where \"contractId\"='$CNT' and \"clauseType\"='LIABILITY_CAP' limit 1;")
post /clauses/$CL/approve "$CEO" '{"mitigation":"تأمين مسؤولية مدنية بحد ٥ مليون دولار، وإخطار مجلس الإدارة قبل التوقيع."}' >/dev/null
post /contracts/$CNT/clauses "$CEO" '{"clauseType":"PENALTIES","clauseText":"غرامة تأخير ١٠٪ أسبوعيًا بحد أقصى ٢٠٪ من قيمة العقد.","riskLevel":"HIGH","owner":"إدارة المشاريع"}' >/dev/null
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
advance OPPORTUNITY_QUALIFICATION "اكتمل التأهيل وتحديد جهة الاتصال"
advance SCOPE_DISCOVERY "زيارة الموقع في المحافظات الثلاث"
advance BID_STRATEGY_SOLUTION "اعتماد النموذج المختلط"
advance COSTING_SOURCING "بدء التسعير وطلب عروض الموردين"
advance OPERATIONAL_FINANCIAL_REVIEW "اكتمال التكلفة المعتمدة"
advance MANAGEMENT_APPROVAL "رفع للاعتماد"
advance PROPOSAL_SUBMISSION "تقديم العرض عبر بوابة المناقصات"
advance CLARIFICATIONS_NEGOTIATION "استفسارات العميل على الحزمة الثانية"
advance AWARD_CONTRACTING "أمر شراء PO-NT-2026-3391"
say "the deal now sits at award and contracting, with its stage history behind it"

echo "=== 11. A board with more than one deal on it ==="
# The pipeline screenshot is meaningless with a single card. Three more deals,
# each stopped where a real one stops.
side() {
  A=$(post /accounts "$AM" "{\"legalName\":\"$1\",\"type\":\"$2\",\"country\":\"$3\",\"industry\":\"$4\"}" | id_of)
  O=$(post /opportunities "$AM" "{\"name\":\"$5\",\"accountId\":\"$A\",\"country\":\"$3\",\"currency\":\"USD\",\"estimatedValue\":$6,\"source\":\"$7\",\"industry\":\"$4\",\"nextStep\":\"$8\"}" | id_of)
  echo "$O"
}
O2=$(side "الشركة المصرية لخدمات الشبكات" "ENTERPRISE" "EG" "ICT" "توسعة شبكة المقر الرئيسي" 320000 "EXISTING_CLIENT" "إعداد الحل الفني")
O3=$(side "هيئة تنمية الاتصالات" "GOVERNMENT" "KE" "FTTH" "ربط ٤٠ مدرسة بالألياف — كينيا" 780000 "TENDER_PORTAL" "دراسة كراسة الشروط")
O4=$(side "مدغشقر تليكوم" "OPERATOR" "MG" "WIRELESS" "أبراج نقل — المرحلة الثانية" 1450000 "DIRECT_INVITATION" "تأكيد الميزانية مع العميل")
post /opportunities/$O4/stage "$AM" '{"toStage":"LEAD_QUALIFICATION","reason":"تأكيد الميزانية مع العميل"}' >/dev/null
say "three more deals, and one of them a stage further on"

echo
echo "==================== المشهد جاهز ===================="
echo "العميل (الذراع التنفيذي): /ar/accounts/$ARM"
echo "العميل (القابضة):        /ar/accounts/$HOLDING"
echo "الفرصة:                  /ar/opportunities/$OPP"
echo "النطاق:                  /ar/opportunities/$OPP/scope"
echo "المناقصة:                /ar/opportunities/$OPP/bids"
echo "مقارنة الموردين:         /ar/opportunities/$OPP/quotations"
echo "التكلفة:                 /ar/opportunities/$OPP/costing"
echo "العروض:                  /ar/opportunities/$OPP/proposals"
echo "الترسية والعقد:          /ar/opportunities/$OPP/contract"
echo "العميل المحتمل:          /ar/leads/$LEAD"
