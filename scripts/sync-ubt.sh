#!/usr/bin/env bash
# Sync /spalah-ubt with /  (index.html → spalah-ubt/index.html)
# Idempotent: safe to run any time. Replaces the standard Zenedu
# checkout link with the UBT-specific one in the copy.
#
# Standard CTA link  : gMhJvJMAb7hGo36d
# UBT-specific link  : WV2OTvfOmfEjL7xs
#
# Run manually     :  bash scripts/sync-ubt.sh
# Auto on commit   :  via .git/hooks/pre-commit
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/index.html"
DST="$ROOT/spalah-ubt/index.html"

OLD_URL="https://app.zenedu.io/l/gMhJvJMAb7hGo36d"
NEW_URL="https://app.zenedu.io/l/WV2OTvfOmfEjL7xs"

if [ ! -f "$SRC" ]; then
  echo "ERROR: $SRC not found" >&2
  exit 1
fi

mkdir -p "$(dirname "$DST")"

# Swap the URL via Python (avoids sed escaping headaches with /)
python3 - "$SRC" "$DST" "$OLD_URL" "$NEW_URL" <<'PY'
import sys, pathlib
src, dst, old, new = sys.argv[1:5]
txt = pathlib.Path(src).read_text(encoding='utf-8')
n_old = txt.count(old)
out = txt.replace(old, new)
n_new = out.count(new)
pathlib.Path(dst).write_text(out, encoding='utf-8')
print(f"sync-ubt: copied index.html → spalah-ubt/index.html "
      f"({n_old} payment links rewritten → {n_new} UBT links)")
PY
