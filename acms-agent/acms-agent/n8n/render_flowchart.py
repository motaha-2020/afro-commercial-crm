# -*- coding: utf-8 -*-
"""Render the workflow as a standalone SVG flow chart.

Drawn from the workflow's own node positions, so the picture is the canvas
rather than a redrawing of it — if the layout in build_agent.py changes, so does
this, and neither can drift from the other.

Self-contained: no scripts, no fonts, no network. One file to send.

    python3 render_flowchart.py [workflows/acmsOrch01.json] [out.svg]
"""
import html
import json
import os
import sys

NODE_W, NODE_H = 200, 78
SCALE = 0.5
MARGIN = 90

# n8n's sticky palette, muted to sit behind the nodes rather than compete.
STICKY_FILL = {
    1: "#EEF1F4", 2: "#F3EAE2", 3: "#F8E7E7", 4: "#FBF0DF",
    5: "#FBF7DE", 6: "#E6F3EA", 7: "#EAEBF7",
}
STICKY_EDGE = {
    1: "#B9C2CC", 2: "#C6A98D", 3: "#DFA3A3", 4: "#E0BC7C",
    5: "#DDD07A", 6: "#8FC3A4", 7: "#A3A7DC",
}

KIND_COLOUR = [
    ("stickyNote", None, None),
    ("chatTrigger", "#0A7B67", "#E0F1ED"),
    ("webhook", "#0A7B67", "#E0F1ED"),
    ("agentTool", "#6B3FA0", "#F0E9F8"),
    (".agent", "#6B3FA0", "#F0E9F8"),
    ("lmChat", "#2C4C8C", "#E7ECF7"),
    ("embeddings", "#2C4C8C", "#E7ECF7"),
    ("outputParser", "#2C4C8C", "#E7ECF7"),
    ("memoryBuffer", "#2C4C8C", "#E7ECF7"),
    ("vectorStoreQdrant", "#0F6E8C", "#E2F0F5"),
    ("documentDefaultDataLoader", "#0F6E8C", "#E2F0F5"),
    ("textSplitter", "#0F6E8C", "#E2F0F5"),
    ("httpRequestTool", "#A86C14", "#FAF0DC"),
    ("httpRequest", "#A8324A", "#FAE6EA"),
    ("extractFromFile", "#96461F", "#F9EAE2"),
    ("code", "#3D4854", "#EDF0F4"),
    ("switch", "#3D4854", "#EDF0F4"),
    ("if", "#3D4854", "#EDF0F4"),
]


def colour_for(node_type):
    for key, edge, fill in KIND_COLOUR:
        if key and key in node_type:
            return edge, fill
    return "#6D7883", "#F2F4F7"


def esc(s):
    return html.escape(str(s), quote=True)


def wrap(name, limit=22):
    words, lines, cur = str(name).split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > limit and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines[:3]


def render(wf):
    nodes = wf["nodes"]
    stickies = [n for n in nodes if n["type"].endswith("stickyNote")]
    ops = [n for n in nodes if not n["type"].endswith("stickyNote")]

    xs, ys = [], []
    for n in ops:
        xs += [n["position"][0], n["position"][0] + NODE_W]
        ys += [n["position"][1], n["position"][1] + NODE_H]
    for s in stickies:
        p = s["parameters"]
        xs += [s["position"][0], s["position"][0] + p["width"]]
        ys += [s["position"][1], s["position"][1] + p["height"]]

    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    w = (maxx - minx) * SCALE + MARGIN * 2
    h = (maxy - miny) * SCALE + MARGIN * 2

    def X(v):
        return round((v - minx) * SCALE + MARGIN, 1)

    def Y(v):
        return round((v - miny) * SCALE + MARGIN, 1)

    out = []
    out.append(
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
        'viewBox="0 0 %d %d" font-family="Segoe UI, Noto Sans Arabic, Tahoma, '
        'sans-serif">' % (w, h, w, h))
    out.append('<rect width="100%" height="100%" fill="#FBFCFD"/>')
    out.append('<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" '
               'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
               '<path d="M0,0 L10,5 L0,10 z" fill="#8A9199"/></marker></defs>')

    # sticky regions first, as background
    for s in stickies:
        p = s["parameters"]
        c = p.get("color", 1)
        x, y = X(s["position"][0]), Y(s["position"][1])
        bw, bh = p["width"] * SCALE, p["height"] * SCALE
        out.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="8" '
                   'fill="%s" stroke="%s" stroke-width="1.5"/>'
                   % (x, y, bw, bh, STICKY_FILL.get(c, "#EEF1F4"),
                      STICKY_EDGE.get(c, "#B9C2CC")))
        title = (p.get("content", "").splitlines() or [""])[0].lstrip("# ").strip()
        out.append('<text x="%.1f" y="%.1f" font-size="17" font-weight="700" '
                   'fill="%s" direction="rtl">%s</text>'
                   % (x + 14, y + 26, STICKY_EDGE.get(c, "#6D7883"), esc(title)))

    pos = {n["name"]: n["position"] for n in ops}

    # connections
    for src, kinds in wf["connections"].items():
        if src not in pos:
            continue
        for kind, lists in kinds.items():
            for lst in lists:
                for t in (lst or []):
                    if t["node"] not in pos:
                        continue
                    ai = kind != "main"
                    sx, sy = pos[src]
                    tx, ty = pos[t["node"]]
                    x1, y1 = X(sx + NODE_W), Y(sy + NODE_H / 2)
                    x2, y2 = X(tx), Y(ty + NODE_H / 2)
                    if ai:
                        # sub-node links read better as a vertical tie
                        x1, y1 = X(sx + NODE_W / 2), Y(sy)
                        x2, y2 = X(tx + NODE_W / 2), Y(ty + NODE_H)
                    mx = (x1 + x2) / 2
                    out.append(
                        '<path d="M%.1f,%.1f C%.1f,%.1f %.1f,%.1f %.1f,%.1f" '
                        'fill="none" stroke="%s" stroke-width="%s"%s '
                        'marker-end="url(#a)" opacity="%s"/>'
                        % (x1, y1, mx, y1, mx, y2, x2, y2,
                           "#A3A7DC" if ai else "#8A9199",
                           "1" if ai else "1.6",
                           ' stroke-dasharray="4 4"' if ai else "",
                           "0.55" if ai else "0.85"))

    # nodes
    for n in ops:
        edge, fill = colour_for(n["type"])
        off = bool(n.get("disabled"))
        x, y = X(n["position"][0]), Y(n["position"][1])
        nw, nh = NODE_W * SCALE, NODE_H * SCALE
        out.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="6" '
                   'fill="%s" stroke="%s" stroke-width="1.6"%s opacity="%s"/>'
                   % (x, y, nw, nh, "#F2F4F7" if off else fill,
                      "#B9C2CC" if off else edge, ' stroke-dasharray="5 4"'
                      if off else "", "0.6" if off else "1"))
        lines = wrap(n["name"])
        ty = y + nh / 2 - (len(lines) - 1) * 6 + 4
        for i, line in enumerate(lines):
            out.append('<text x="%.1f" y="%.1f" font-size="10.5" '
                       'text-anchor="middle" fill="%s" opacity="%s">%s</text>'
                       % (x + nw / 2, ty + i * 12,
                          "#6D7883" if off else "#10141A",
                          "0.7" if off else "1", esc(line)))
        if off:
            out.append('<text x="%.1f" y="%.1f" font-size="7.5" '
                       'text-anchor="middle" fill="#8A9199" '
                       'letter-spacing="0.5">DISABLED</text>'
                       % (x + nw / 2, y + nh - 5))

    out.append('</svg>')
    return "\n".join(out)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        here, "workflows", "acmsOrch01.json")
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        here, "ACMS-AI-Agent-flow.svg")
    wf = json.load(open(src, encoding="utf-8"))
    if isinstance(wf, list):
        wf = wf[0]
    svg = render(wf)
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write(svg)
    ops = [n for n in wf["nodes"] if not n["type"].endswith("stickyNote")]
    print("%s — %d nodes, %d regions, %.0f KB"
          % (os.path.basename(dst), len(ops),
             len(wf["nodes"]) - len(ops), len(svg) / 1024))
