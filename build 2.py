#!/usr/bin/env python3
"""build.py - splice time-tracker.jsx into the PWA shell.

    python3 build.py [--src time-tracker.jsx] [--shell index.html]
                     [--out index.html] [--stamp "08-20 module platform"]

The shell is the deployed index.html: an inlined React 19 bundle followed by a
second <script> holding the app. Everything between the React bundle and the
createRoot call is replaced, so the React payload, the manifest links, the
service-worker registration and the error trap all survive untouched.
"""
import argparse, re, sys

HEAD = "var useState=React.useState, useEffect=React.useEffect, useRef=React.useRef;\n"
TAIL = "\ntry {\n  ReactDOMClient.createRoot(document.getElementById('root')).render(React.createElement(App));"
IMPORT_RE = re.compile(r'^\s*import\s*\{[^}]*\}\s*from\s*"react";\s*\n', re.M)
STAMP_RE = re.compile(r"Time Tracker build [^<]*")


def transform(src: str) -> str:
    """JSX-file conventions -> browser globals. No JSX to compile: the app is
    React.createElement throughout, so this is two textual edits."""
    src, n = IMPORT_RE.subn("", src, count=1)
    if n != 1:
        sys.exit("build: expected exactly one react import in the source")
    if "export default function App(){" not in src:
        sys.exit("build: no `export default function App(){` in the source")
    return src.replace("export default function App(){", "function App(){", 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="time-tracker.jsx")
    ap.add_argument("--shell", default="index.html")
    ap.add_argument("--out", default="index.html")
    ap.add_argument("--stamp", default=None, help='e.g. "08-20 module platform"')
    a = ap.parse_args()

    shell = open(a.shell, encoding="utf-8").read()
    i = shell.find(HEAD)
    j = shell.find(TAIL)
    if i < 0 or j < 0 or j <= i:
        sys.exit("build: could not find the app slot in " + a.shell)

    body = transform(open(a.src, encoding="utf-8").read())
    out = shell[: i + len(HEAD)] + "\n" + body + shell[j:]

    if a.stamp:
        out, n = STAMP_RE.subn("Time Tracker build " + a.stamp, out, count=1)
        if n != 1:
            sys.exit("build: build stamp not found in the shell")

    open(a.out, "w", encoding="utf-8").write(out)
    print("build: %s -> %s  (%d bytes, %d lines)"
          % (a.src, a.out, len(out), out.count("\n") + 1))


if __name__ == "__main__":
    main()
