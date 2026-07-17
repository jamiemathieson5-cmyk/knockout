# Knockout

Drag-and-drop background remover. Runs entirely in your browser — no ChatGPT, no Gemini, no upload to a third-party editor.

**Live:** https://jamiemathieson5-cmyk.github.io/knockout/

Created by [Jamie Mathieson](http://tiktok.com/@therealonesliveagency).

## Features

- Drag & drop (or browse) any image
- Transparent PNG output
- Original pixel dimensions preserved
- Local AI model (`@imgly/background-removal`, large quality model)
- No per-image AI API costs — processing stays on the visitor’s device

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

The first run downloads the ONNX model (~80–180 MB). After that it’s cached by the browser.

## Build

```bash
npm run build
npm run preview
```

## Deploy

Pushes to `main` build and publish via GitHub Actions → GitHub Pages (`/knockout/`).
