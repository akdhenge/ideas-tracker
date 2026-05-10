# Changes — ideas-tracker

## Video Background Implementation

**Date:** 2026-05-10  
**Author:** Akshay Dhenge  
**Status:** ✅ Locally previewed — ⏳ Pending deployment

---

## Summary

Added a full-screen looping video background (`snowman.mp4`) to the main app page of the Idea Reactor. The video plays silently behind the kanban board with a dark gradient overlay to maintain UI readability.

---

## Files Changed

### `src/worker.js`
The entire site is a Cloudflare Worker — all HTML is generated inside this single file as JavaScript template literals.

#### 1. Body CSS (inside `appHTML()` function, ~line 856)

**Before:**
```css
body {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  background-image:
    radial-gradient(ellipse at 10% 0%, rgba(99,102,241,0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 100%, rgba(16,185,129,0.05) 0%, transparent 50%);
}
```

**After:**
```css
body {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  position: relative;    /* ← needed for z-index stacking context */
}

/* ── Video background ── */
#bg-video {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: cover;        /* fills the viewport without distortion */
  z-index: 0;
  pointer-events: none;     /* video never intercepts clicks */
}

#bg-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background:
    radial-gradient(ellipse at 10% 0%, rgba(99,102,241,0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 100%, rgba(16,185,129,0.08) 0%, transparent 50%),
    linear-gradient(to bottom, rgba(8,12,20,0.72) 0%, rgba(8,12,20,0.60) 100%);
  z-index: 1;
  pointer-events: none;
}

/* Ensure all content sits above the video */
nav, .board, footer, .modal-backdrop, #toast-area {
  position: relative;
  z-index: 2;
}
```

#### 2. HTML body (inside `appHTML()` function, ~line 1232)

Added immediately after `<body>` opens:

```html
<video id="bg-video" autoplay muted loop playsinline>
  <source src="/snowman.mp4" type="video/mp4">
</video>
<div id="bg-overlay"></div>
```

- `autoplay` — starts automatically on page load
- `muted` — **required** for autoplay to work in all modern browsers
- `loop` — restarts when it reaches the end
- `playsinline` — prevents fullscreen takeover on iOS

---

## New Files Added

### `resource/preview.html`
A standalone local preview page that mirrors the look of the live app. Used to verify the video background before deployment. It serves the video using a relative path (`snowman.mp4`) and shows a "PREVIEW MODE" badge.

> **To open the preview:**
> 1. Start a local HTTP server from the `resource/` folder:
>    ```powershell
>    python -m http.server 7788 --directory "C:\Users\Akshay\Documents\SW_projects\ideas-tracker\resource"
>    ```
> 2. Open your browser at: **http://localhost:7788/preview.html**

---

## Deployment Instructions

The video file needs to be publicly accessible via HTTPS for the live Cloudflare Worker to serve it. The recommended approach is **Cloudflare R2**.

### Option A — Cloudflare R2 (Recommended)

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Go to **R2 Object Storage** → Create a bucket (e.g. `ideas-assets`)
3. Enable **Public Access** on the bucket
4. Upload `resource/snowman.mp4` to the bucket
5. Copy the public URL (e.g. `https://pub-xxxx.r2.dev/snowman.mp4`)
6. Update the `<source>` tag in `src/worker.js`:
   ```html
   <source src="https://pub-xxxx.r2.dev/snowman.mp4" type="video/mp4">
   ```
7. Deploy the worker:
   ```powershell
   npx wrangler deploy
   ```

### Option B — Serve via the Worker itself (Not recommended for large files)

Cloudflare Workers have a **1 MB script size limit** — `snowman.mp4` is ~3 MB, so this option won't work.

### Option C — Any public CDN / GitHub Releases

Upload the video to any public URL (GitHub Releases asset, Bunny CDN, etc.) and update the `src` attribute in the same way as Option A.

---

## Visual Design Notes

| Layer       | z-index | Description |
|-------------|---------|-------------|
| `#bg-video` | 0       | Raw video, fixed, covers full viewport |
| `#bg-overlay` | 1     | Gradient overlay — darkens + tints video so UI is readable |
| `nav`, `.board`, `footer` | 2 | All interactive UI content |

The overlay uses two radial gradients (purple top-left, green bottom-right — matching the existing site accent colours) layered over a 60–72% dark linear gradient. This keeps the snowman visible while making white text on the kanban cards fully readable.

---

## Known Behaviour

- **Automated/headless browsers** (e.g. Puppeteer, Playwright without flags) will not autoplay the video due to browser policy. In a real user session it works correctly.
- **iOS Safari** requires the `muted` + `playsinline` attributes — both are present.
- **Fallback** — if the video fails to load, `body { background: var(--bg); }` (#080c14 dark navy) is used as fallback, so the page never looks broken.
