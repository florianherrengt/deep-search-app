#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-icon.png}"

if ! command -v magick >/dev/null 2>&1; then
  echo "Missing ImageMagick: install it with: brew install imagemagick"
  exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "Missing iconutil: this script must run on macOS"
  exit 1
fi

if [ ! -f "$SRC" ]; then
  echo "Source icon not found: $SRC"
  exit 1
fi

# Clean previous generated macOS iconset
rm -rf icon.iconset
mkdir -p icon.iconset

# Normalize source to 1024x1024 PNG
magick "$SRC" \
  -resize 1024x1024 \
  -background none \
  -gravity center \
  -extent 1024x1024 \
  icon.png

SRC="icon.png"

# macOS .icns iconset
magick "$SRC" -resize 16x16     icon.iconset/icon_16x16.png
magick "$SRC" -resize 32x32     icon.iconset/icon_16x16@2x.png
magick "$SRC" -resize 32x32     icon.iconset/icon_32x32.png
magick "$SRC" -resize 64x64     icon.iconset/icon_32x32@2x.png
magick "$SRC" -resize 128x128   icon.iconset/icon_128x128.png
magick "$SRC" -resize 256x256   icon.iconset/icon_128x128@2x.png
magick "$SRC" -resize 256x256   icon.iconset/icon_256x256.png
magick "$SRC" -resize 512x512   icon.iconset/icon_256x256@2x.png
magick "$SRC" -resize 512x512   icon.iconset/icon_512x512.png
magick "$SRC" -resize 1024x1024 icon.iconset/icon_512x512@2x.png

iconutil -c icns icon.iconset -o icon.icns

# Windows .ico
magick "$SRC" \
  -define icon:auto-resize=256,128,64,48,32,24,16 \
  icon.ico

# Tauri/common PNGs
magick "$SRC" -resize 32x32     32x32.png
magick "$SRC" -resize 128x128   128x128.png
magick "$SRC" -resize 256x256   128x128@2x.png

# Windows Store / Microsoft logo assets
magick "$SRC" -resize 30x30     Square30x30Logo.png
magick "$SRC" -resize 44x44     Square44x44Logo.png
magick "$SRC" -resize 71x71     Square71x71Logo.png
magick "$SRC" -resize 89x89     Square89x89Logo.png
magick "$SRC" -resize 107x107   Square107x107Logo.png
magick "$SRC" -resize 142x142   Square142x142Logo.png
magick "$SRC" -resize 150x150   Square150x150Logo.png
magick "$SRC" -resize 284x284   Square284x284Logo.png
magick "$SRC" -resize 310x310   Square310x310Logo.png
magick "$SRC" -resize 50x50     StoreLogo.png

echo "Generated icons from $SRC"