#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run build

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R dist/. "$TMP/"
cd "$TMP"
git init -q
git checkout -b gh-pages
git add -A
git -c user.name="Jamie Mathieson" -c user.email="jamiemathieson5-cmyk@users.noreply.github.com" \
  commit -q -m "Deploy Knockout to GitHub Pages"
git push -f "https://github.com/jamiemathieson5-cmyk/knockout.git" gh-pages

echo "Published: https://jamiemathieson5-cmyk.github.io/knockout/"
