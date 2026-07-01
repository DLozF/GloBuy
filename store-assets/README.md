# GloBuy — Chrome Web Store image assets

Generated from HTML with headless Chrome using the real extension palette and
the Inter font. Re-render anytime with:

```
cd store-assets
node render.mjs            # render everything
node render.mjs shot-2     # render just the file(s) whose name contains "shot-2"
```

Sources live in `src/`, finished PNGs land in `out/` at exact store dimensions.

## What to upload (Chrome Web Store → Store listing)

| File (`out/`) | Size | Listing field |
|---|---|---|
| `screenshot-1-translate-1280x800.png` | 1280×800 | **Screenshots** (required, 1–5) |
| `screenshot-2-currency-1280x800.png`  | 1280×800 | Screenshots |
| `screenshot-3-sizes-1280x800.png`     | 1280×800 | Screenshots |
| `screenshot-4-privacy-1280x800.png`   | 1280×800 | Screenshots |
| `promo-tile-440x280.png`              | 440×280  | **Small promo tile** (optional) |
| `marquee-1400x560.png`                | 1400×560 | **Marquee promo tile** (optional, for featuring) |

Upload the four screenshots in order 1→4 — the store shows them in the order you add them.

## Using the frame template for real captures

`frame-template-1280x800.png` is a preview of `src/frame-template.html`, a reusable
frame for your own screen captures:

1. Capture your extension translating a real site (≈1100px+ wide looks best).
2. Save it as `src/capture.png`.
3. In `src/frame-template.html`: uncomment the `.shot` `background` rule, and edit
   the eyebrow / headline / sub / url text.
4. `node render.mjs frame` → `out/frame-template-1280x800.png` now wraps your capture.

You can copy `frame-template.html` to a new name for each real screenshot.

## Notes

- These are designed mockups that render the **actual** GloBuy popup UI and real
  behavior (full-page translation, inline `₩ → $` conversion, KR/JP/EU→US sizes)
  with representative sample content — an accurate depiction of the product.
- Brand: navy `#0A1228`, teal `#1EC6AA`, Inter. Same palette as `src/popup/popup.css`.
- Sample brand/site names are illustrative; swap them for ones you prefer before
  publishing if you like.
