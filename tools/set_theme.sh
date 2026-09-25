#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: npm run set-theme -- /path/to/theme.msstyles"
  exit 1
fi

python3 electron/tools/import_msstyles.py "$1" electron/themes/Current
