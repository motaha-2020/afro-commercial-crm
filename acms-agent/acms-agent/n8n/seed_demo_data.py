#!/usr/bin/env python3
"""Fill the ACMS *staging* copy with realistic commercial data.

Everything goes through the HTTP API rather than SQL so the system's own
validation, stage rules, progressive-data-capture checks and audit logging all
apply — SQL inserts would produce rows the app itself would consider invalid.

Each step runs as the role that would really do it (account manager logs the
calls, estimation builds the cost sheet, procurement collects quotes, the sales
director submits, finance/CEO approve), because the approval endpoints enforce
segregation of duties and reject self-approval.

Idempotent-ish: re-running adds more rows rather than replacing. To start over,
restore the DB from the live dump — see AGENT.md.

Run on the server:  python3 seed_demo_data.py
"""

import json
import random
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://100.122.6.64:4010/api"
PASSWORD = "AgentDev#2026"

random.seed(20260810)
NOW = datetime.now(timezone.utc)


def iso(days=0):
    return (NOW + timedelta(days=days)).isoformat().replace("+00:00", "Z")


class Api:
    """Thin API client that remembers one token per user."""

    def __init__(self):
        self.tokens = {}

    def token(self, email):
        if email not in self.tokens:
            body = self._raw("POST", "/auth/login", None,
                             {"email": email, "password": PASSWORD})
            self.tokens[email] = body["accessToken"]
        return self.tokens[email]

    def _raw(self, method, path, tok, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if tok:
            req.add_header("Authorization", "Bearer " + tok)
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
        return json.loads(raw) if raw else None

    def call(self, method, path, as_user, payload=None, quiet=False):
        try:
            return self._raw(method, path, self.token(as_user), payload)
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            if not quiet:
                print(f"    ! {method} {path} -> {e.code} {detail}")
            return None

    get = lambda self, p, u: self.call("GET", p, u)
    post = lambda self, p, u, b=None, quiet=False: self.call("POST", p, u, b or {}, quiet)
    patch = lambda self, p, u, b=None: self.call("PATCH", p, u, b or {})


api = Api()

CEO = "ceo@afro.example"
DIRECTOR = "sales.director@afro.example"
AM = "am@afro.example"
EST = "estimation@afro.example"
FIN = "finance@afro.example"
ADMIN = "admin@afro.example"

made = {}


def note(label, n):
    made[label] = made.get(label, 0) + n
    print(f"  + {n:>3}  {label}")


# --------------------------------------------------------------- what exists

opps = {o["code"]: o for o in api.get("/opportunities", CEO)["items"]}
accounts = api.get("/accounts", CEO)["items"]
acc_by_name = {a["legalName"]: a for a in accounts}
users = {}
for e in (CEO, DIRECTOR, AM, EST, FIN):
    me = api.get("/auth/me", e)
    users[e] = me["id"] if me and "id" in me else (me or {}).get("user", {}).get("id")

print(f"opportunities: {list(opps)}")
print(f"accounts: {list(acc_by_name)}\n")

FTTH = opps["OPP-2026-000001"]      # COSTING_SOURCING  — the deep one
WIRELESS = opps["OPP-2026-000002"]  # SCOPE_DISCOVERY
BACKBONE = opps["OPP-2026-000003"]  # PROPOSAL_SUBMISSION
GOV = opps["OPP-2026-000004"]       # LEAD_QUALIFICATION


# ------------------------------------------------------------------ contacts

print("contacts")
# influence is HIGH/MEDIUM/LOW/UNKNOWN; roles come from CONTACT_ROLES
# (DECISION_MAKER, TECHNICAL_EVALUATOR, COMMERCIAL_EVALUATOR, PROCUREMENT,
# FINANCE, END_USER, GATEKEEPER, CHAMPION, BLOCKER).
CONTACTS = [
    ("Sudanese Telecom (STE)", "Khalid Osman", "Head of Network Rollout",
     "k.osman@ste.example", "HIGH", True, ["DECISION_MAKER", "CHAMPION"]),
    ("Sudanese Telecom (STE)", "Amira Bashir", "Procurement Manager",
     "a.bashir@ste.example", "MEDIUM", False, ["PROCUREMENT", "GATEKEEPER"]),
    ("Madagascar Fiber Co.", "Hery Rakoto", "Chief Technology Officer",
     "h.rakoto@mgfiber.example", "HIGH", True, ["DECISION_MAKER", "TECHNICAL_EVALUATOR"]),
    ("East Africa Mobile", "Grace Wanjiru", "Director of Infrastructure",
     "g.wanjiru@eamobile.example", "HIGH", True, ["DECISION_MAKER"]),
    ("East Africa Mobile", "Peter Otieno", "Senior Network Engineer",
     "p.otieno@eamobile.example", "LOW", False, ["TECHNICAL_EVALUATOR", "END_USER"]),
    ("Comoros Digital", "Said Ahmed", "Programme Director",
     "s.ahmed@comdigital.example", "HIGH", True, ["DECISION_MAKER", "FINANCE"]),
]
contacts = {}
n = 0
for acc_name, full, title, email, influence, primary, roles in CONTACTS:
    acc = acc_by_name.get(acc_name)
    if not acc:
        continue
    r = api.post("/contacts", AM, {
        "accountId": acc["id"], "fullName": full, "jobTitle": title,
        "email": email, "influence": influence, "isPrimary": primary,
        "roles": roles,
    })
    if r:
        contacts[full] = r
        n += 1
note("contacts", n)


# ------------------------------------------------- opportunity forecast shape

# Weighted pipeline is estimatedValue × probability, and probability ships null,
# so the metric reads 0 until each opportunity carries a forecast.
print("opportunity forecast fields")
PROFILE = [
    (GOV,      15, "PIPELINE",   "AMBER", 150),
    (WIRELESS, 30, "UPSIDE",     "GREEN", 110),
    (FTTH,     60, "BEST_CASE",  "GREEN",  55),
    (BACKBONE, 80, "COMMIT",     "AMBER",  25),
]
n = 0
for opp, prob, forecast, health, close_in in PROFILE:
    r = api.patch(f"/opportunities/{opp['id']}", DIRECTOR, {
        "probability": prob, "forecastCategory": forecast,
        "health": health, "expectedCloseDate": iso(close_in),
    })
    n += 1 if r else 0
note("opportunities given probability + close date", n)


# --------------------------------------------------------------- activities

print("activities")
ACTS = [
    ("MEETING", "اجتماع تقييم فني لمشروع FTTH", FTTH["id"], -12, True),
    ("CALL", "متابعة موعد فتح المظاريف", FTTH["id"], -5, True),
    ("SITE_VISIT", "زيارة موقع الكبائن — المرحلة الأولى", FTTH["id"], -3, True),
    ("TASK", "تجهيز خطاب ضمان العطاء", FTTH["id"], 4, False),
    ("TASK", "مراجعة أسعار الكابل مع المورد", FTTH["id"], -2, False),
    ("EMAIL", "إرسال العرض الفني المبدئي", BACKBONE["id"], -8, True),
    ("MEETING", "جلسة استيضاحات مع العميل", BACKBONE["id"], -1, True),
    ("TASK", "الرد على استفسارات المناقصة", BACKBONE["id"], 2, False),
    ("CALL", "مكالمة تعريفية أولى", WIRELESS["id"], -20, True),
    ("MEETING", "ورشة تحديد النطاق", WIRELESS["id"], -6, True),
    ("TASK", "استكمال مصفوفة النطاق", WIRELESS["id"], 9, False),
    ("CALL", "تأهيل الفرصة الحكومية", GOV["id"], -15, True),
    ("TASK", "طلب كراسة الشروط", GOV["id"], -4, False),
]
n = 0
for typ, subject, opp_id, day, done in ACTS:
    r = api.post("/activities", AM, {
        "type": typ, "subject": subject, "opportunityId": opp_id,
        "dueAt": iso(day), "completed": done,
    })
    n += 1 if r else 0
note("activities", n)


# --------------------------------------------------------------------- leads

print("leads")
LEADS = [
    ("Data Centre Interconnect — Nairobi", "REFERRAL", "KE", "CORE_NETWORK", 1250000),
    ("Campus ELV Fit-out — Khartoum", "EXISTING_CLIENT", "SD", "ELV", 480000),
    ("Submarine Landing Station Upgrade", "TENDER_PORTAL", "KM", "SUBMARINE", 3100000),
    ("Rural Wireless Coverage Phase 2", "DIRECT_INVITATION", "MG", "WIRELESS", 890000),
]
n = 0
for name, source, country, industry, value in LEADS:
    r = api.post("/leads", AM, {
        "name": name, "source": source, "country": country,
        "industry": industry, "estimatedValue": value, "currency": "USD",
        "nextStep": "تحديد موعد اجتماع التأهيل",
    })
    n += 1 if r else 0
note("leads", n)


# ---------------------------------------------------------------------- bids

print("bids (with real deadlines)")
BIDS = [
    (FTTH, "PUBLIC_TENDER", "STE/2026/FTTH/114", -20, 18, 8, True, 210000, "PORTAL"),
    (BACKBONE, "PUBLIC_TENDER", "MGF/NB/2026/007", -35, 6, -2, True, 475000, "PORTAL"),
    (WIRELESS, "PRIVATE_TENDER", "EAM-RFP-2026-33", -10, 45, 30, False, 0, "EMAIL"),
    (GOV, "RFP", "CD-GOV-2026-002", -6, 75, 55, False, 0, "HAND_DELIVERY"),
]
bids = {}
n = 0
for opp, typ, tender, issued, deadline, clarif, bond, bond_amt, method in BIDS:
    body = {"type": typ, "tenderNumber": tender, "issueDate": iso(issued),
            "submissionDeadline": iso(deadline),
            "clarificationDeadline": iso(clarif),
            "bidBondRequired": bond, "submissionMethod": method,
            "notes": "مناقصة تجريبية للاختبار"}
    if bond:
        body["bidBondAmount"] = bond_amt
        body["bidBondCurrency"] = "USD"
    r = api.post(f"/opportunities/{opp['id']}/bids", DIRECTOR, body)
    if r:
        bids[opp["code"]] = r
        n += 1
note("bids", n)

print("bid requirements")
REQS = [
    (FTTH, "شهادة تسجيل الشركة سارية", "ADMINISTRATIVE", True, 3),
    (FTTH, "خطاب ضمان ابتدائي 5%", "FINANCIAL", True, 5),
    (FTTH, "سابقة أعمال FTTH خلال 3 سنوات", "TECHNICAL", True, 7),
    (FTTH, "شهادة السلامة والصحة المهنية", "HSE", False, 10),
    (BACKBONE, "الميزانية المعتمدة لآخر سنتين", "FINANCIAL", True, -1),
    (BACKBONE, "المواصفات الفنية للكابل البحري", "TECHNICAL", True, 2),
]
n = 0
for opp, desc, typ, mandatory, due in REQS:
    b = bids.get(opp["code"])
    if not b:
        continue
    r = api.post(f"/bids/{b['id']}/requirements", DIRECTOR, {
        "description": desc, "type": typ, "mandatory": mandatory,
        "dueDate": iso(due),
    })
    n += 1 if r else 0
note("bid requirements", n)


# ------------------------------------------------------------------ partners

print("partners")
PARTNERS = [
    ("Nile Cables & Accessories", "EG", ["SUPPLIER"], "Tarek Fouad", (4, 4, 3, 4)),
    ("Delta Civil Contracting", "EG", ["SUBCONTRACTOR"], "Mostafa Zaki", (3, 4, 3, 3)),
    ("Indian Ocean Logistics", "MG", ["LOGISTICS_PROVIDER"], "Nirina Andria", (4, 3, 4, 4)),
    ("EastLink Installations", "KE", ["SUBCONTRACTOR"], "Daniel Kimani", (5, 3, 4, 5)),
    ("Gulf Optical Supplies", "EG", ["SUPPLIER"], "Hassan Nour", (3, 5, 3, 3)),
]
partners = {}
n = 0
for legal, country, types, contact, ratings in PARTNERS:
    r = api.post("/partners", EST, {
        "legalName": legal, "country": country, "types": types,
        "contactName": contact,
        "contactEmail": contact.split()[0].lower() + "@" +
                        legal.split()[0].lower() + ".example",
    })
    if not r:
        continue
    partners[legal] = r
    n += 1
    t, c, f, h = ratings
    api.patch(f"/partners/{r['id']}/ratings", EST, {
        "technicalRating": t, "commercialRating": c,
        "financialRating": f, "hseRating": h,
    })
    api.patch(f"/partners/{r['id']}/approval", FIN,
              {"approvalStatus": "APPROVED"})
note("partners (rated + approved)", n)


# ------------------------------------------------------- costing for the FTTH

print("costing — FTTH scenario, packages, BOQ, breakdown")
scenario = api.post(f"/opportunities/{FTTH['id']}/costing", EST, {
    "name": "التنفيذ الذاتي — سيناريو أساسي",
    "type": "SELF_EXECUTION", "currency": "USD",
    "notes": "سيناريو مرجعي لتسعير 120 كابينة",
})
version = None
packages_made = items_made = breakdown_made = 0
if scenario:
    api.post(f"/costing/scenarios/{scenario['id']}/select", EST)
    version = api.post(f"/costing/scenarios/{scenario['id']}/versions", EST,
                       {"revisionReason": "الإصدار الأول"})

PACKAGES = [
    ("توريد الكابلات والمهمات", "MATERIALS", [
        ("كابل ضوئي 24F", "m", 96000, 2.10, 1.55),
        ("مقسم بصري 1:16", "pcs", 480, 74.00, 52.00),
        ("كابينة توزيع خارجية", "pcs", 120, 910.00, 640.00),
    ]),
    ("الأعمال المدنية", "CIVIL_WORKS", [
        ("حفر وردم مسار الكابل", "m", 42000, 6.40, 4.35),
        ("قواعد خرسانية للكبائن", "pcs", 120, 260.00, 175.00),
    ]),
    ("التركيب والاختبار", "INSTALLATION", [
        ("سحب وتركيب الكابل", "m", 96000, 1.35, 0.88),
        ("لحام وقياس OTDR", "pcs", 3800, 12.50, 7.90),
    ]),
    ("إدارة المشروع", "PROJECT_MANAGEMENT", [
        ("فريق إدارة المشروع", "month", 14, 9800.00, 7100.00),
    ]),
]
if version:
    for order, (pkg_name, pkg_type, rows) in enumerate(PACKAGES):
        pkg = api.post(f"/costing/versions/{version['id']}/packages", EST, {
            "name": pkg_name, "type": pkg_type, "sortOrder": order,
        })
        if not pkg:
            continue
        packages_made += 1
        for i, (desc, unit, qty, sell, cost) in enumerate(rows):
            item = api.post(f"/costing/packages/{pkg['id']}/items", EST, {
                "description": desc, "quantity": qty, "unit": unit,
                "sellingRate": sell, "customerRate": sell, "sortOrder": i,
            })
            if not item:
                continue
            items_made += 1
            b = api.post(f"/costing/items/{item['id']}/breakdown", EST, {
                "quantity": qty, "unitCost": cost, "unit": unit,
                "description": "تكلفة مباشرة",
            })
            breakdown_made += 1 if b else 0
note("costing packages", packages_made)
note("BOQ items", items_made)
note("cost breakdown rows", breakdown_made)

# Submitted by estimation, approved by finance — the two cannot be the same
# person, which is exactly what the SoD rules enforce.
if version:
    if api.post(f"/costing/versions/{version['id']}/submit", EST,
                {"note": "جاهز للاعتماد"}):
        note("costing version submitted", 1)
    if api.post(f"/costing/versions/{version['id']}/approve", FIN,
                {"note": "معتمد — الهامش ضمن السياسة"}):
        note("costing version approved", 1)


# --------------------------------------------------- RFQ + supplier quotations

print("RFQ and supplier quotations")
rfq = api.post(f"/opportunities/{FTTH['id']}/rfqs", EST, {
    "title": "طلب عروض — كابلات ومهمات FTTH",
    "description": "توريد كابلات ضوئية ومقسمات وكبائن لمشروع 120 كابينة",
    "dueAt": iso(9), "currency": "USD",
    "partnerIds": [p["id"] for p in partners.values()][:3],
})
note("RFQ", 1 if rfq else 0)

QUOTES = [
    ("Nile Cables & Accessories", 12, [
        ("كابل ضوئي 24F", 96000, 1.52, "COMPLIANT"),
        ("مقسم بصري 1:16", 480, 51.00, "COMPLIANT"),
        ("كابينة توزيع خارجية", 120, 655.00, "ALTERNATIVE"),
    ]),
    ("Gulf Optical Supplies", 21, [
        ("كابل ضوئي 24F", 96000, 1.44, "COMPLIANT"),
        ("مقسم بصري 1:16", 480, 56.50, "COMPLIANT"),
        ("كابينة توزيع خارجية", 120, 612.00, "COMPLIANT"),
    ]),
    ("Indian Ocean Logistics", 30, [
        ("شحن وتخليص جمركي", 1, 148000.00, "COMPLIANT"),
    ]),
]
n = q_items = 0
for legal, lead_days, lines in QUOTES:
    p = partners.get(legal)
    if not p:
        continue
    r = api.post(f"/opportunities/{FTTH['id']}/quotations", EST, {
        "partnerId": p["id"],
        "rfqId": rfq["id"] if rfq else None,
        "quotationNumber": "Q-" + legal.split()[0].upper() + "-2026-01",
        "quotationDate": iso(-2), "validUntil": iso(45),
        "currency": "USD", "deliveryDays": lead_days,
        "paymentTerms": "30 يومًا من تاريخ الفاتورة",
        "warranty": "24 شهرًا",
        "items": [{"description": d, "quantity": q, "unitPrice": u,
                   "compliance": c, "leadTimeDays": lead_days}
                  for d, q, u, c in lines],
    })
    if r:
        n += 1
        q_items += len(lines)
note("supplier quotations", n)
note("quotation lines", q_items)


# ------------------------------------------------------- discount + approvals

print("discount request awaiting a decision")
d = api.post(f"/opportunities/{FTTH['id']}/discounts", DIRECTOR, {
    "requestedPercent": 7.5,
    "fromPrice": 4200000,
    "toPrice": 3885000,
    "justification": "منافسة قوية من مورد محلي، والعميل طلب تحسين السعر "
                     "للحفاظ على الجدول الزمني.",
})
note("discount request (pending)", 1 if d else 0)

print("approval request on the opportunity")
a = api.post(f"/opportunities/{FTTH['id']}/approvals", DIRECTOR,
             {"note": "طلب اعتماد التسعير النهائي قبل التقديم"})
note("approval request (pending)", 1 if a else 0)


# ------------------------------------------------------------------- summary

print("\n" + "=" * 46)
print("seeded:")
for k, v in made.items():
    print(f"  {v:>4}  {k}")
print("=" * 46)

m = api.get("/metrics/dashboard", CEO)
if m:
    print("\nmetrics now:")
    for metric in m["metrics"]:
        val = metric.get("value")
        val = "—" if val is None else val
        reason = metric.get("unavailableReason") or ""
        print(f"  {metric['code']:<20} {str(val):>14}  basis={metric['basis']} {reason}")
