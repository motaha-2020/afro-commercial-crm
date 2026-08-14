"""Add closed opportunities so Win Rate and Forecast Accuracy have a basis.

Win Rate is Won / (Won + Lost) and Forecast Accuracy compares won value against
what was forecast as committed — both read 0 records while every opportunity is
still open, which is why the dashboard showed NO_DATA.
"""
import json
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://100.122.6.64:4010/api"
PW = "AgentDev#2026"
NOW = datetime.now(timezone.utc)


def iso(d=0):
    return (NOW + timedelta(days=d)).isoformat().replace("+00:00", "Z")


tok = {}


def T(e):
    if e not in tok:
        r = urllib.request.Request(
            BASE + "/auth/login",
            data=json.dumps({"email": e, "password": PW}).encode(), method="POST")
        r.add_header("Content-Type", "application/json")
        tok[e] = json.load(urllib.request.urlopen(r, timeout=30))["accessToken"]
    return tok[e]


def call(m, p, u, b=None, quiet=False):
    r = urllib.request.Request(
        BASE + p, data=(json.dumps(b).encode() if b is not None else None), method=m)
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + T(u))
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            raw = x.read().decode()
            return json.loads(raw) if raw else True
    except urllib.error.HTTPError as e:
        if not quiet:
            print("  !", m, p, e.code, e.read().decode()[:240])
        return None


CEO = "ceo@afro.example"
DIR = "sales.director@afro.example"

accounts = {a["legalName"]: a for a in call("GET", "/accounts", CEO)["items"]}
names = list(accounts)

# (name, account, country, industry, value, won?, exitReason, notes, path to terminal stage)
HISTORY = [
    ("FTTH Phase 1 — 80 Cabinets", "Sudanese Telecom (STE)", "SD", "FTTH",
     2900000, True, None, "فوز بفارق سعري بسيط بعد جولة تفاوض واحدة."),
    ("Metro Ring Extension — Antananarivo", "Madagascar Fiber Co.", "MG", "CORE_NETWORK",
     1650000, True, None, "فوز مدعوم بسابقة أعمال قوية لدى نفس العميل."),
    ("Enterprise ELV — Nairobi HQ", "East Africa Mobile", "KE", "ELV",
     540000, True, None, "فوز بعد تحسين شروط الدفع."),
    ("Backbone Link — Port Sudan", "Sudanese Telecom (STE)", "SD", "SUBMARINE",
     4100000, False, "LOST", "خسارة بسبب السعر: المنافس أقل بنحو 12% على بند الكابل."),
    ("Wireless Rollout — Mahajanga", "Madagascar Fiber Co.", "MG", "WIRELESS",
     980000, False, "LOST", "خسارة بسبب مدة التوريد: المنافس التزم بـ90 يومًا مقابل 150."),
    ("Government WAN — Moroni", "Comoros Digital", "KM", "IT",
     1450000, False, "LOST", "خسارة بسبب اشتراط شريك محلي لم يكن متاحًا وقت التقديم."),
    ("Campus Fiber — Khartoum University", "Sudanese Telecom (STE)", "SD", "FTTS",
     620000, False, "NO_BID", "قرار عدم التقديم: الهامش المتوقع أقل من سياسة الشركة."),
]

# Stage order matters: the system enforces progressive data capture, so an
# opportunity has to walk the funnel rather than jump to the end.
PATH = ["OPPORTUNITY_QUALIFICATION", "SCOPE_DISCOVERY", "BID_STRATEGY_SOLUTION",
        "COSTING_SOURCING", "OPERATIONAL_FINANCIAL_REVIEW", "MANAGEMENT_APPROVAL",
        "PROPOSAL_SUBMISSION", "CLARIFICATIONS_NEGOTIATION", "AWARD_CONTRACTING"]

created = won = lost = nobid = 0
for name, acc_name, country, industry, value, is_won, exit_reason, notes in HISTORY:
    acc = accounts.get(acc_name)
    if not acc:
        continue
    o = call("POST", "/opportunities", DIR, {
        "name": name, "accountId": acc["id"], "country": country,
        "industry": industry, "currency": "USD", "estimatedValue": value,
        "source": "TENDER_PORTAL", "nextStep": "أرشيف",
    })
    if not o:
        continue
    created += 1
    oid = o["id"]

    # Forecast Accuracy compares won value against what was committed, so these
    # need a probability and a COMMIT/CLOSED_WON forecast before they close.
    call("PATCH", "/opportunities/" + oid, DIR, {
        "probability": 90 if is_won else 55,
        "forecastCategory": "COMMIT",
        "health": "GREEN" if is_won else "AMBER",
        "expectedCloseDate": iso(-30),
        "proposedPrice": value,
    })

    target = "AWARD_CONTRACTING" if is_won else "PROPOSAL_SUBMISSION"
    for stage in PATH:
        r = call("POST", f"/opportunities/{oid}/stage", DIR,
                 {"toStage": stage, "reason": "بيانات تاريخية"}, quiet=True)
        if r is None:
            break
        if stage == target:
            break

    if is_won:
        body = {"status": "CLOSED", "exitNotes": notes}
    elif exit_reason == "NO_BID":
        body = {"status": "CANCELLED", "exitReason": "NO_BID", "exitNotes": notes}
    else:
        body = {"status": "LOST", "exitReason": "LOST", "exitNotes": notes}

    if call("POST", f"/opportunities/{oid}/status", DIR, body):
        if is_won:
            won += 1
        elif exit_reason == "NO_BID":
            nobid += 1
        else:
            lost += 1
    print(f"  {name[:44]:46} {'WON' if is_won else (exit_reason or '')}")

print(f"\ncreated {created}  won {won}  lost {lost}  no-bid {nobid}")

print("\n== metrics ==")
for m in call("GET", "/metrics/dashboard", CEO)["metrics"]:
    v = m.get("value")
    v = "-" if v is None else v
    print("  %-20s %14s  basis=%s %s"
          % (m["code"], str(v), m["basis"], m.get("unavailableReason") or ""))
