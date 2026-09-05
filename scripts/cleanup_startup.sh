#!/usr/bin/env bash
# Startup cleanup: remove broken uploads (no valid input.mp4 or corrupt)
PROJECT=/home/b/skating-editor-v2
for d in $PROJECT/public/uploads/skate-*; do
  [ -d "$d" ] || continue
  name=$(basename "$d")
  [[ "$name" == skate-process-* ]] && continue
  input="$d/input.mp4"
  if [ -f "$input" ]; then
    # Validate with ffmpeg quietly
    if ! ffmpeg -v error -i "$input" -t 0.1 -f null - 2>/dev/null; then
      echo "Removing corrupt: $name"
      rm -rf "$d"
    fi
  else
    echo "Removing empty dir: $name"
    rm -rf "$d"
  fi
done
echo "Startup cleanup done"
