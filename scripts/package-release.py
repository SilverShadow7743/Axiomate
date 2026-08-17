#!/usr/bin/env python3
"""
Build the deployment zip for a manual release, and refuse to put secrets in it.

Why this exists at all, and why it is Python.

There is no git remote on this repository, so `.github/workflows/deploy.yml` has never run. A
manual release is therefore the only kind there has been, and it has to produce a zip that Kudu
will accept. Two of the three obvious ways to make one on Windows are broken, and both failures
are silent until Azure answers 400:

  Compress-Archive    writes entry names with BACKSLASH separators. Kudu unpacks them as files
                      with backslashes in the name rather than as directories, the app has no
                      server.js where it looks for one, and the site "fails to start" with no
                      stated cause. Cost three failed deploys before it was understood.

  tar -a -c -f x.zip  produces an archive whose central directory Python's own `zipfile` module
                      cannot open, and which Kudu rejects with 400. It also barely compresses:
                      the same tree was 110 MB through tar and 37 MB through this script. This
                      was previously written down as the FIX for Compress-Archive. It is not.

  zipfile (this)      forward slashes by construction, a valid central directory, and it is the
                      method that produced the archive that actually deployed.

On the GitHub runner none of this applies — `zip -qry` there is Info-ZIP on Linux and is fine.
This script is for releasing from a workstation.

---------------------------------------------------------------------------
The refusal

`.env` holds DATABASE_URL, AXIOMATE_ENTRA_CLIENT_SECRET and ANTHROPIC_API_KEY. It reached a
release package once, by being copied into a build directory for a typecheck and then swept up
with everything else, and it was caught by eye. App Service supplies every one of those as an
app setting, so the file has no business in the artifact and its absence cannot break anything.

Refusing is better than filtering quietly: the run prints what it excluded, so a person who
genuinely needed a file in there finds out at build time rather than at boot.

Usage:

    npm run build                      # with output: 'standalone' in next.config.ts
    python scripts/package-release.py .next/standalone dist/release.zip \\
        --extra .next/static=.next/static

`--extra SRC=DEST` copies a tree in at a named path. `.next/static` needs it: standalone does
not include it, and without it every stylesheet and client chunk 404s while the server itself
looks healthy. Use `=` rather than `:` — Git Bash on Windows rewrites a colon-separated pair
into a mangled path before the script sees it.
"""
import argparse
import os
import shutil
import sys
import tempfile
import zipfile

# Never shipped, whatever the caller says. Matched on the basename, so a nested one is caught too.
SECRETS = {".env"}
SECRET_SUFFIXES = (".env", ".pem", ".key", ".pfx")

# Build state, not release content. `.next/cache` alone is usually most of the bulk.
SKIP_DIRS = {".git", "node_modules/.cache", ".next/cache"}


def is_secret(name: str) -> bool:
    base = os.path.basename(name)
    return base in SECRETS or base.startswith(".env.") or base.endswith(SECRET_SUFFIXES)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("source", help="directory to package, normally .next/standalone")
    p.add_argument("output", help="zip to write")
    p.add_argument(
        "--extra",
        action="append",
        default=[],
        metavar="SRC:DEST",
        help="copy an extra tree in at DEST, e.g. .next/static:.next/static",
    )
    args = p.parse_args()

    if not os.path.isdir(args.source):
        print(f"No such directory: {args.source}", file=sys.stderr)
        print("Did `npm run build` run, and is output: 'standalone' set in next.config.ts?", file=sys.stderr)
        return 1

    staging = tempfile.mkdtemp(prefix="axiomate-release-")
    try:
        shutil.copytree(args.source, staging, dirs_exist_ok=True)
        for spec in args.extra:
            # `=` as well as `:`, because Git Bash on Windows rewrites a colon-separated pair
            # into a mangled Windows path before argparse ever sees it — `a:b` arrives as
            # `a;b` with backslashes. `=` survives untouched, so it is the one to prefer.
            if "=" in spec:
                src, dest = spec.rsplit("=", 1)
            elif ":" in spec:
                # rsplit, because a Windows source path contains a colon after the drive letter.
                src, dest = spec.rsplit(":", 1)
            else:
                print(f"--extra needs SRC=DEST, got {spec!r}", file=sys.stderr)
                return 1
            if not os.path.exists(src):
                print(f"--extra source does not exist: {src}", file=sys.stderr)
                return 1
            target = os.path.join(staging, dest.replace("/", os.sep))
            os.makedirs(os.path.dirname(target) or staging, exist_ok=True)
            if os.path.isdir(src):
                shutil.copytree(src, target, dirs_exist_ok=True)
            else:
                shutil.copy2(src, target)

        out_dir = os.path.dirname(os.path.abspath(args.output))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        if os.path.exists(args.output):
            os.remove(args.output)

        written = 0
        excluded = []
        with zipfile.ZipFile(
            args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True
        ) as z:
            for root, dirs, files in os.walk(staging):
                rel_root = os.path.relpath(root, staging).replace(os.sep, "/")
                if any(rel_root == d or rel_root.startswith(d + "/") for d in SKIP_DIRS):
                    dirs[:] = []
                    continue
                for f in files:
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, staging).replace(os.sep, "/")
                    if is_secret(rel):
                        excluded.append(rel)
                        continue
                    z.write(full, rel)
                    written += 1

        size_mb = round(os.path.getsize(args.output) / 1024 / 1024, 1)

        # Read the archive back. A zip that cannot be opened is exactly the failure this script
        # exists to prevent, so it is not taken on trust.
        with zipfile.ZipFile(args.output) as z:
            if z.testzip() is not None:
                print("The archive did not verify. Refusing to hand it on.", file=sys.stderr)
                return 1
            names = z.namelist()

        problems = []
        if any(chr(92) in n for n in names):
            problems.append("entry names contain backslashes — Kudu will not unpack this")
        if "server.js" not in names:
            problems.append("no server.js at the root — the startup command is `node server.js`")
        if not any(n.startswith(".next/static/") for n in names):
            problems.append("no .next/static — every stylesheet and client chunk will 404")

        print(f"entries   : {written}")
        print(f"size      : {size_mb} MB")
        print(f"verified  : yes")
        if excluded:
            # ASCII only. The Windows console's default code page mangles an em-dash, and a
            # warning about secrets is the last line that should be hard to read.
            print(f"EXCLUDED  : {len(excluded)} secret file(s) - {', '.join(excluded[:5])}")
            print("            App Service supplies these as app settings.")
        for problem in problems:
            print(f"PROBLEM   : {problem}", file=sys.stderr)
        if problems:
            return 1

        print(f"\nWrote {args.output}")
        print("Deploy with:")
        print("  az webapp deploy --name axiomate-tms --resource-group Axiomate-TMS-RG \\")
        print(f"    --src-path {args.output} --type zip")
        return 0
    finally:
        shutil.rmtree(staging, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
