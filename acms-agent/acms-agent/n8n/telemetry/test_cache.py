# -*- coding: utf-8 -*-
"""Answer-cache tests.

The roadmap's exit gate for this item is "TTL and validation mandatory", so the
tests that matter are the ones proving an entry is *refused*: after the TTL,
after the data moves, and for a different user. A cache that only proves it can
return something is not tested.
"""
import importlib.util
import sys
import time

spec = importlib.util.spec_from_file_location(
    "svc", "/home/mohamed.adel/acms-reports/service.py")
m = importlib.util.module_from_spec(spec)
sys.argv = ["x"]
spec.loader.exec_module(m)

Q = "إيه الفرص المفتوحة دلوقتي؟"
A = "هذه إجابة اختبارية طويلة بما يكفي كي تُقبَل للتخزين في الذاكرة."
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    passed += bool(ok)
    failed += not ok
    print("%-4s %-52s %s" % ("PASS" if ok else "FAIL", name, detail))


# ---- the fingerprint must actually respond to data --------------------------
real_get = m.acms.get
base_items = {"items": [{"id": "1", "updatedAt": "2026-08-14T10:00:00Z"},
                        {"id": "2", "updatedAt": "2026-08-14T11:00:00Z"}]}


def stub(payload):
    def _g(path):
        return payload
    return _g


def version_with(payload):
    m.acms.get = stub(payload)
    m._dv_cache["v"] = None          # defeat the 30s memo for the test
    m._dv_cache["ts"] = 0.0
    return m._data_version()


v0 = version_with(base_items)
v_more = version_with({"items": base_items["items"] +
                       [{"id": "3", "updatedAt": "2026-08-14T11:00:00Z"}]})
v_newer = version_with({"items": [{"id": "1", "updatedAt": "2026-08-14T10:00:00Z"},
                                  {"id": "2", "updatedAt": "2026-08-14T12:00:00Z"}]})
check("fingerprint changes when a row is added", v0 != v_more,
      "%s -> %s" % (v0, v_more))
check("fingerprint changes when a row is edited", v0 != v_newer,
      "%s -> %s" % (v0, v_newer))
check("fingerprint is stable when nothing moves", version_with(base_items) == v0)

# a lookup must refuse everything while the marker cannot be computed
def boom(path):
    raise RuntimeError("acms down")


m.acms.get = boom
m._dv_cache["v"] = None
m._dv_cache["ts"] = 0.0
r = m.cache_lookup("u@x.com", Q)
check("no hit while the data marker is unavailable",
      not r["hit"] and r["reason"] == "no-data-version", str(r))

# ---- store / hit / isolation ------------------------------------------------
version_with(base_items)
m.acms.get = stub(base_items)
m.cache_store("u@x.com", Q, A)
check("stored answer is returned to the same user",
      m.cache_lookup("u@x.com", Q)["hit"])
check("normalised phrasing still hits",
      m.cache_lookup("u@x.com", "ايه الفرص المفتوحه دلوقتي")["hit"])
check("another user does not get it",
      not m.cache_lookup("other@x.com", Q)["hit"])
check("a different question does not hit",
      not m.cache_lookup("u@x.com", "إيه هامش الربح؟")["hit"])
check("an answer too short to be real is not stored",
      not m.cache_store("u@x.com", "س", "قصير")["ok"])

# ---- validation: the data moves --------------------------------------------
m.cache_store("u@x.com", Q, A)
m.acms.get = stub({"items": base_items["items"] +
                   [{"id": "9", "updatedAt": "2026-08-14T13:00:00Z"}]})
m._dv_cache["v"] = None
m._dv_cache["ts"] = 0.0
r = m.cache_lookup("u@x.com", Q)
check("entry is dropped once the data changes",
      not r["hit"] and r["reason"] == "data-changed", str(r))
check("and it stays dropped, not merely skipped",
      not m.cache_lookup("u@x.com", Q)["hit"])

# ---- validation: time ------------------------------------------------------
m.acms.get = stub(base_items)
m._dv_cache["v"] = None
m._dv_cache["ts"] = 0.0
m.cache_store("u@x.com", Q, A)
old_ttl = m.ANSWER_CACHE_TTL
m.ANSWER_CACHE_TTL = 1
time.sleep(1.2)
r = m.cache_lookup("u@x.com", Q)
check("entry expires on TTL", not r["hit"] and r["reason"] == "expired", str(r))
m.ANSWER_CACHE_TTL = old_ttl

# ---- similarity matching ----------------------------------------------------
# The half that matters is the refusals. A similarity cache that answers a
# nearby-but-different question is worse than no cache: it is confidently
# wrong, it quotes real record codes, and nothing downstream flags it.
m.acms.get = stub(base_items)
m._dv_cache["v"] = None
m._dv_cache["ts"] = 0.0
m._answer_cache.clear()

U = "u@x.com"
m.cache_store(U, "اعرض الفرص المفتوحة بأسمائها ومراحلها", A)
m.cache_store(U, "فيه مناقصات قافلة خلال 60 يوم؟", A)
m.cache_store(U, "إيه تكلفة وهامش فرصة FTTH؟", A)


def sim(name, q, should_hit, who=U):
    r = m.cache_lookup(who, q)
    ok = bool(r["hit"]) == should_hit
    check(name, ok, r.get("matched") or r.get("reason", ""))


sim("same words, different order hits",
    "اعرض الفرص المفتوحة ومراحلها بأسمائها", True)
sim("politeness added still hits",
    "ممكن تعرض الفرص المفتوحة بأسمائها ومراحلها لو سمحت", True)
sim("a different number does NOT hit",
    "فيه مناقصات قافلة خلال 30 يوم؟", False)
sim("a different code does NOT hit",
    "إيه تكلفة وهامش فرصة Backbone؟", False)
sim("an unrelated question does NOT hit",
    "مين العملاء اللي مفيش معاهم تواصل؟", False)
sim("a narrower question does NOT hit",
    "اعرض الفرص المفتوحة في مصر بأسمائها ومراحلها", False)
sim("similarity does not cross users",
    "اعرض الفرص المفتوحة ومراحلها بأسمائها", False, who="someone@else.com")

m.acms.get = real_get
print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
