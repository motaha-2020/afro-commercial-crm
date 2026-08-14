# -*- coding: utf-8 -*-
"""Push internal documents into the ACMS knowledge index.

The corpus here is the project's own operating documentation — real, internal,
and carrying no client confidentiality. It exists to prove the pipeline
end-to-end before anything sensitive is indexed, which is the order the scope
decision called for.

Point DOCS at the real document set to use this for anything else; nothing in
the workflow knows or cares where the text came from.
"""
import json
import os
import sys
import urllib.request

HOOK = "http://127.0.0.1:5678/webhook/acms-rag-ingest-01"
ROOT = "/home/mohamed.adel/acms-agent"

DOCS = [
    ("AGENT.md", "دليل تشغيل مساعد ACMS", "sop"),
    ("DEPLOY.md", "إجراءات النشر", "sop"),
    ("README.md", "نظرة عامة على النظام", "reference"),
    ("PROGRESS.md", "سجل التقدّم", "reference"),
    ("n8n/CACHE.md", "تصميم ذاكرة الإجابات", "reference"),
    ("n8n/PROVIDER-STATE.md", "حالة مزوّد النماذج", "policy"),
    ("n8n/README.md", "بناء ونشر الوكيل", "sop"),
]


def post(payload):
    req = urllib.request.Request(
        HOOK, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode() or "{}")


ok = failed = skipped = 0
for rel, title, doc_type in DOCS:
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        print("%-28s SKIP  (not on this box)" % rel)
        skipped += 1
        continue
    text = open(path, encoding="utf-8").read()
    try:
        r = post({
            "docId": rel,
            "title": title,
            "text": text,
            "classification": "internal",
            "orgUnitId": "*",
            "docType": doc_type,
            "source": "repo:acms-agent",
        })
    except Exception as e:
        print("%-28s ERROR %s" % (rel, str(e)[:70]))
        failed += 1
        continue
    if r.get("ok"):
        print("%-28s OK    %d chars" % (rel, len(text)))
        ok += 1
    else:
        print("%-28s FAIL  %s" % (rel, r.get("error")))
        failed += 1

print("\nindexed %d, failed %d, skipped %d" % (ok, failed, skipped))
sys.exit(1 if failed else 0)
