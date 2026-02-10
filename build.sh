#!/usr/bin/env bash
#
# build.sh – Build the Seafile FileLink extension as .xpi
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/manifest.json'))['version'])")
OUTPUT="$SCRIPT_DIR/tb-seafile-filelink-${VERSION}.xpi"

# Colored output (if running in a terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  NC='\033[0m'
else
  GREEN='' YELLOW='' RED='' NC=''
fi

echo -e "${YELLOW}Building Seafile FileLink Extension...${NC}"

# Check if zip is available
if ! command -v zip &>/dev/null; then
  echo -e "${RED}Error: 'zip' is not installed.${NC}"
  echo "  Debian/Ubuntu: sudo apt install zip"
  echo "  macOS:         brew install zip"
  exit 1
fi

# Validate JSON files
echo "Validating JSON..."
for f in manifest.json _locales/*/messages.json experiment_apis/loginManager/schema.json; do
  if ! python3 -c "import json, sys; json.load(open('$SCRIPT_DIR/$f'))" 2>/dev/null; then
    echo -e "${RED}JSON error in: $f${NC}"
    exit 1
  fi
  echo "  ✓ $f"
done

# Remove old XPI files
rm -f "$SCRIPT_DIR"/tb-seafile-filelink*.xpi

# Create XPI
cd "$SCRIPT_DIR"
zip -r "$OUTPUT" . \
  -x '.git/*' \
  -x '.gitignore' \
  -x '.github/*' \
  -x 'build.sh' \
  -x 'README.md' \
  -x 'LICENSE' \
  -x '*.xpi' \
  -x '.vscode/*' \
  -x '.idea/*' \
  -x '.claude/*' \
  -x 'node_modules/*' \
  -x '.DS_Store' \
  -x 'Thumbs.db'

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo -e "${GREEN}✅ Done: $OUTPUT ($SIZE)${NC}"
echo ""
echo "Installation in Thunderbird:"
echo "  Tools → Add-ons → Gear icon → Install Add-on From File…"