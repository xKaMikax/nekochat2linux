#!/usr/bin/env bash
#
# Pre-render every bundled theme into electron/prebuilt/<id> so the packaged
# app (Windows/Linux) never needs Python at runtime. Run before electron-builder:
#
#   bash electron/tools/prebuild_themes.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ROOT="$ROOT/themes"
OUT_ROOT="$ROOT/prebuilt"

import_one() {
  local src="$1" out="$2"
  python3 "$ROOT/tools/import_msstyles.py" "$src" "$out"
}

rm -rf "$OUT_ROOT"
mkdir -p "$OUT_ROOT"

# Windows Classic is a pure CSS theme, kept in the same runtime layout.
CLASSIC_OUT="$OUT_ROOT/Classic/schemes/classic"
mkdir -p "$CLASSIC_OUT"
cp "$SOURCE_ROOT/classic/theme.css" "$CLASSIC_OUT/theme.css"
cat > "$OUT_ROOT/Classic/theme.json" <<'JSON'
{
  "theme": "Windows Classic",
  "schemes": [{ "id": "classic", "name": "Windows Classic" }],
  "defaultScheme": "classic"
}
JSON

# Every other theme directory (including user-built ones like "zune") maps one
# to one prebuilt bundle, mirroring main.js discoverThemes().
for dir in "$SOURCE_ROOT"/*/; do
  name="$(basename "$dir")"
  case "$name" in
    Classic|Current|Luna|Embedded|Royale) continue ;;
  esac
  src="$(find "$dir" -maxdepth 1 -type f \( -iname '*.theme' -o -iname '*.msstyles' \) -print -quit || true)"
  [ -n "$src" ] || continue
  if ! import_one "$src" "$OUT_ROOT/$name"; then
    echo "warning: skipping unrenderable theme dir '$name' (missing msstyles)" >&2
    rm -rf "$OUT_ROOT/$name"
    continue
  fi
done

# Built-in msstyles themes use fixed ids in main.js that are skipped above.
import_one "$SOURCE_ROOT/luna/Luna.theme" "$OUT_ROOT/Luna"
import_one "$SOURCE_ROOT/embedded/Embedded.msstyles" "$OUT_ROOT/Embedded"
import_one "$SOURCE_ROOT/royal/Royale.msstyles" "$OUT_ROOT/Royale"

echo "Prebuilt themes written to $OUT_ROOT"
