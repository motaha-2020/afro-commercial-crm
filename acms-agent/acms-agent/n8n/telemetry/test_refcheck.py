# -*- coding: utf-8 -*-
"""Reference-verification tests for the action whitelist.

Half of these assert the new check stays QUIET. A gate that blocks everything is
as useless as one that blocks nothing — the previous guard work was measured the
same way.
"""
import importlib.util
import sys
import uuid

spec = importlib.util.spec_from_file_location(
    "svc", "/home/mohamed.adel/acms-reports/service.py")
m = importlib.util.module_from_spec(spec)
sys.argv = ["x"]
spec.loader.exec_module(m)

accounts = (m.acms.get("/accounts") or {}).get("items", [])
opps = (m.acms.get("/opportunities") or {}).get("items", [])
vodafone = next(a for a in accounts if a.get("legalName") == "Vodafone")
other = next(a for a in accounts if a.get("legalName") != "Vodafone")
opp = opps[0]

BOGUS = str(uuid.UUID(int=0x9e4bd07700004000800000000000ffff))
SESSION = "reftest-session"

cases = []


def case(name, should_block, action, params, why):
    cases.append((name, should_block, action, params, why))


# ---- must BLOCK ---------------------------------------------------------
case("the original failure: right uuid, wrong company", True,
     "opportunity_create",
     {"name": "Ghost Deal", "accountId": vodafone["id"], "country": "EG",
      "accountName": "Zzz Telecom"},
     "id resolves to Vodafone, model says Zzz Telecom")

case("id names nothing at all", True,
     "opportunity_create",
     {"name": "Ghost Deal", "accountId": BOGUS, "country": "EG",
      "accountName": "Zzz Telecom"},
     "well-formed uuid, no such account")

case("no name stated for a create", True,
     "opportunity_create",
     {"name": "Ghost Deal", "accountId": vodafone["id"], "country": "EG"},
     "accountName is required on creates")

case("a different real account substituted", True,
     "opportunity_create",
     {"name": "Ghost Deal 2", "accountId": other["id"], "country": "EG",
      "accountName": vodafone["legalName"]},
     "names Vodafone, sends another account's id")

case("contact create with mismatched account", True,
     "contact_create",
     {"accountId": vodafone["id"], "fullName": "Ghost Person",
      "accountName": "Zzz Telecom"},
     "same rule applies to contacts")

# ---- must STAY QUIET ----------------------------------------------------
case("honest create on a real account", False,
     "opportunity_create",
     {"name": "RefCheck Probe A", "accountId": vodafone["id"], "country": "EG",
      "accountName": "Vodafone"},
     "name and id agree")

case("name given as the account code", False,
     "opportunity_create",
     {"name": "RefCheck Probe B", "accountId": vodafone["id"], "country": "EG",
      "accountName": vodafone["code"]},
     "code is an acceptable statement of identity")

case("name with extra words around it", False,
     "opportunity_create",
     {"name": "RefCheck Probe C", "accountId": vodafone["id"], "country": "EG",
      "accountName": "شركة Vodafone مصر"},
     "substring match must tolerate ordinary phrasing")

case("opportunity action untouched by the new rule", False,
     "stage",
     {"opportunityId": opp["id"], "toStage": "QUALIFICATION"},
     "no NAME_CONFIRM entry, and the id resolves")

case("update on a real opportunity", False,
     "update",
     {"opportunityId": opp["id"], "nextStep": "متابعة مع العميل"},
     "resolution succeeds, nothing to cross-check")

# ---- run ----------------------------------------------------------------
passed = failed = 0
for name, should_block, action, params, why in cases:
    r = m.propose(SESSION, action, params, summary="اختبار")
    blocked = not r.get("ok")
    err = (r.get("error") or "")
    # A duplicate-name rejection is the older check firing, not this one.
    ours = any(k in err for k in ("بالمعرّف", "يخصّ", "ناقص accountName"))
    ok = (blocked and ours) if should_block else (not blocked)
    if blocked and not should_block and "بالفعل" in err:
        ok = True   # pre-existing duplicate guard, unrelated to this change
        err += "  [duplicate guard, not ref-check]"
    passed += ok
    failed += not ok
    print("%-4s %-46s %s" % ("PASS" if ok else "FAIL", name,
                             (err[:96] or "proposal created")))
    if not ok:
        print("       expected %s — %s" % ("block" if should_block else "quiet", why))

print("\n%d passed, %d failed  (%d blocking, %d quiet)"
      % (passed, failed, sum(1 for c in cases if c[1]),
         sum(1 for c in cases if not c[1])))
sys.exit(1 if failed else 0)
