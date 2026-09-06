# Web OSS contributor guidelines

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Root `AGENTS.md` also applies.

iOS Home Screen uses `apple-touch-icon` 180×180 (`<head>` link plus `/apple-touch-icon.png`), not the 192/512 PWA icons.

iOS Safari zooms the page when a focused input/textarea/select is under 16px.
Keep phone fields at `text-base` (16px). Do not “fix” that zoom with
`maximum-scale=1` / `user-scalable=no`. The coarse-pointer floor lives in
`packages/components/src/tailwind/index.css`.

Hashed `/assets/` and `/emojibase/` must send `Access-Control-Allow-Origin`
because Vite module tags use `crossorigin`. Without it, iOS Safari reports
`Importing a module script failed`.

iOS Safari often drops `Set-Cookie` from `fetch('/session')`. The login page
must also persist `X-Lody-Session` via `document.cookie` before navigating.

After copying `apps/web-oss/dist` to `/srv/lody-oss/web`, precompress hashed
assets (`gzip -9 -k` on JS/CSS/wasm) and keep `gzip_static on`. Do not
on-the-fly gzip wasm; that stalls the phone boot spinner.
