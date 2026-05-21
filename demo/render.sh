#!/bin/bash
# OmniVault Demo — HyperFrames Render Script
set -e

SCENES=(
  "01-problem:25"
  "02-deposit:30"
  "03-apply:35"
  "04-ai-audit:40"
  "05-proof:15"
  "06-veto:15"
  "07-vesting:30"
  "08-dashboard:20"
  "09-guardian:20"
  "10-closing:10"
)

OUT_DIR="./rendered"
mkdir -p "$OUT_DIR"

echo "🎬 OmniVault Demo — Rendering ${#SCENES[@]} scenes..."
echo ""

for entry in "${SCENES[@]}"; do
  name="${entry%%:*}"
  echo "  ▶ Rendering compositions/${name}.html → ${name}.mp4"
  npx hyperframes render . \
    -c "compositions/${name}.html" \
    -o "${OUT_DIR}/${name}.mp4" \
    --quiet
  echo "  ✓ ${name}.mp4"
done

echo ""
echo "🔗 Concatenating ${#SCENES[@]} scenes..."

CONCAT_FILE="${OUT_DIR}/concat.txt"
> "$CONCAT_FILE"
for entry in "${SCENES[@]}"; do
  name="${entry%%:*}"
  echo "file '${name}.mp4'" >> "$CONCAT_FILE"
done

ffmpeg -y \
  -f concat -safe 0 -i "$CONCAT_FILE" \
  -c:v libx264 -preset slow -crf 18 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  "${OUT_DIR}/omnivault-demo-final.mp4"

echo ""
echo "✅ Done! → ${OUT_DIR}/omnivault-demo-final.mp4"
du -sh "${OUT_DIR}/omnivault-demo-final.mp4"
