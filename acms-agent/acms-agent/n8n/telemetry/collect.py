#!/usr/bin/env python3
"""Append new telemetry records to the store, exactly once each.

Runs on the host (it needs docker), keeps a high-water mark so a re-run costs
nothing, and never rewrites history — the store is append-only JSON lines so a
bad run can be inspected rather than having silently replaced good data.

    python3 collect.py            # harvest whatever is new
    python3 collect.py --reset N  # re-harvest from execution N (appends)
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "telemetry.jsonl")
MARK = os.path.join(HERE, ".highwater")
CONTAINER = "n8n-n8n-1"
HARVEST = os.path.join(HERE, "harvest.js")


def high_water():
    if "--reset" in sys.argv:
        return int(sys.argv[sys.argv.index("--reset") + 1])
    try:
        return int(open(MARK).read().strip())
    except Exception:
        return 0


def main():
    since = high_water()
    subprocess.run(["docker", "cp", HARVEST, CONTAINER + ":/tmp/harvest.js"],
                   check=True, stdout=subprocess.DEVNULL)
    p = subprocess.run(["docker", "exec", CONTAINER, "node", "/tmp/harvest.js", str(since)],
                       capture_output=True, timeout=300)
    if p.returncode:
        print("harvest failed:", p.stderr.decode()[-400:], file=sys.stderr)
        return 1

    lines = [l for l in p.stdout.decode().splitlines() if l.strip()]
    if not lines:
        print("nothing new (since exec %d)" % since)
        return 0

    top = since
    with open(STORE, "a", encoding="utf-8") as fh:
        for l in lines:
            try:
                rec = json.loads(l)
            except ValueError:
                continue
            fh.write(l + "\n")
            top = max(top, int(rec["exec"]))

    with open(MARK, "w") as fh:
        fh.write(str(top))
    print("appended %d records, high-water now %d" % (len(lines), top))
    return 0


if __name__ == "__main__":
    sys.exit(main())
