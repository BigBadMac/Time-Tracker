#!/usr/bin/env python3
"""extract.py - pull the app payload out of a built index.html for boot.js."""
import sys
HEAD = "var useState=React.useState, useEffect=React.useEffect, useRef=React.useRef;\n"
TAIL = "\ntry {\n  ReactDOMClient.createRoot(document.getElementById('root')).render(React.createElement(App));"
src = sys.argv[1] if len(sys.argv) > 1 else "index.html"
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/app_only.js"
s = open(src, encoding="utf-8").read()
i, j = s.find(HEAD), s.find(TAIL)
if i < 0 or j < 0 or j <= i: sys.exit("extract: app slot not found in " + src)
open(out, "w", encoding="utf-8").write(s[i:j])
print("extract: %s -> %s  (%d bytes)" % (src, out, j - i))
