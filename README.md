<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Wahana icon">
</p>

<h1 align="center">Wahana</h1>

<p align="center">
  A cross-platform desktop client for <a href="https://waha.devlike.pro">WAHA</a> (WhatsApp HTTP API).<br>
  Point it at your WAHA server, pick a session, and chat — with scheduling, broadcasts, stories, and built-in AI.
</p>

<p align="center">
  <a href="https://github.com/ashafizullah/wahana/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ashafizullah/wahana?display_name=tag&sort=semver"></a>
  <a href="https://github.com/ashafizullah/wahana/actions/workflows/build.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/ashafizullah/wahana/build.yml?label=build"></a>
  <a href="https://github.com/ashafizullah/wahana/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/ashafizullah/wahana/total"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white">
  <img alt="WAHA" src="https://img.shields.io/badge/WAHA-2026.8%2B-25D366?logo=whatsapp&logoColor=white">
</p>

> **Wahana** means "vehicle / platform" in Indonesian. Not affiliated with WAHA/devlike.pro or WhatsApp/Meta.

## Download

Grab the latest `.dmg` (macOS, Apple Silicon or Intel) or `.msi` (Windows x64) from the [Releases page](https://github.com/ashafizullah/wahana/releases/latest). The app checks for signed updates automatically.

> macOS: the build is not notarized yet — on first launch, right-click the app → **Open**, or run `xattr -dr com.apple.quarantine /Applications/Wahana.app`.

## How it works

Wahana is **only a client**. There is no Wahana backend, account, or cloud — the app talks directly to **your own WAHA server**, the one you deploy and run yourself (Docker, VPS, home server, anything). Your WhatsApp session, messages and media stay between your machine and your server; the project never sees them.

You need:

- A running [WAHA](https://waha.devlike.pro) server (the free **CORE** build works; WAHA 2026.8+ recommended). Several servers can be configured and switched at any time.
- Its **plain-text API key** — if your server config says `WAHA_API_KEY=sha512:…`, that is the hash; clients still send the original key.
- Optionally, for the AI features, your own API key for Anthropic or any OpenAI-compatible endpoint. Requests go straight from the app to that provider.

## Features

**Chats**

- Session list with QR / pairing-code login, multiple sessions and multiple servers (per-server keys in the OS keychain)
- Realtime via WAHA WebSocket: messages, acks, presence (online / typing), reactions, edits, deletions
- WhatsApp formatting, @mentions with autocomplete, link previews, quoted replies with media thumbnails
- Send text, photos, videos, documents, voice notes, location, contacts, polls; drag-and-drop and paste
- Message menu: reactions, reply, forward, pin, edit, delete (for everyone / for me), info (delivery & read times), translate
- Media auto-load per kind with blurred click-to-load previews, on-disk cache, lightbox with zoom and save
- Unread badges (list, tab, dock/tray), pin / mute / archive, labels, drafts, quick replies (`/shortcut` with variables, optionally per session)
- In-chat search, jump to date, infinite history, export to `.txt` / `.html` / `.json`
- Deleted-message tombstones and "waiting for this message" placeholders; live messages survive server history gaps

**Groups & contacts**

- Group info with description, searchable participants (photos, names, numbers), add / remove / promote / demote
- Join requests (approve / reject), invite link, rename, description, photo, admin-only settings, leave, participants CSV
- New chat by number, create group, join by link, browse / follow channels; contact card with block and save

**Status (stories)**

- View contacts' updates (auto-play, start from unseen, next contact), post text / photo / video, delete your own

**Automation**

- **Scheduler** — one-off or daily / weekly / monthly messages to chats, groups, channels or your status, from any session (SQLite-backed, with history)
- **Broadcast** — one message to many recipients from any session, with random pauses, progress, retry and per-recipient log
- **Auto-reply** — per-session rules (direct messages / groups / specific chats, hours & weekdays, keyword or regex match) answering with a fixed text or an AI reply that follows your instructions; per-chat cooldown, reply log, one-click pause
- Webhook manager per session, live event log for debugging integrations

**AI (bring your own key)**

- Anthropic (official SDK) or any OpenAI-compatible endpoint (routers, Ollama…); optional cheaper "fast model" for short tasks; a persona/system prompt used by every feature, with per-session overrides when one app serves several businesses
- Translate incoming messages and drafts; per-chat auto-translate (incoming shown in your language, outgoing sent in theirs)
- Summarize a chat or group (since last read / today / last N) or ask a question about it
- Writing assistant in the composer (fix grammar, formal / casual / friendlier, shorter / longer, bullets) and reply suggestions
- Describe an image or extract its text (OCR)
- Draft a broadcast or status from a short brief ("Draft with AI" in the composer)
- Optionally label new direct chats automatically with your existing labels (Settings → AI)

**WhatsApp Web (no server needed)**

- Plain, unmodified web.whatsapp.com embedded next to your WAHA sessions in the same picker — one place for everything
- Several WhatsApp Web accounts, each with its own isolated login — show any number of them side by side in one split view, drag the dividers to give one more room (double-click to even them out), drag title bars to reorder, lay them out in 1–4 rows, hide, rename / remove at will; when the window is too narrow the panes wrap onto extra rows
- Notifications reach the OS notification center, unread counts show on each pane and in the app badge, downloads land in ~/Downloads, links open in your browser, calls work

**App**

- System tray, desktop notifications, incoming-call banner, keyboard shortcuts, light / dark theme
- Privacy tweaks: typing indicator on/off, read receipts always / on reply / manual / never
- Settings backup & restore, auto-updater

## Development

Prerequisites: Node 22+, Rust (via [rustup](https://rustup.rs)), Xcode Command Line Tools (macOS) or Visual Studio Build Tools + WebView2 (Windows).

```bash
npm install
npm run tauri dev
```

Optional `.env.development.local` prefills the connection in dev builds only:

```
VITE_WAHA_BASE_URL=https://your-waha.example.com
VITE_WAHA_API_KEY=your-plain-api-key
VITE_WAHA_SESSION=default
```

### Check

```bash
npm run check           # tsc + eslint + prettier --check + unit tests (vitest)
npm run format          # prettier --write .
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo fmt --check
```

Pull requests run the same checks in CI (`.github/workflows/ci.yml`); tags trigger the release build.

### Build

```bash
npm run tauri build     # .dmg / .app on macOS, .msi / .exe on Windows
```

### Releasing

Push a tag (`git tag v0.2.0 && git push --tags`). GitHub Actions builds macOS (arm64, x64) and Windows (x64), signs the updater artifacts, and publishes the release with `latest.json` for the auto-updater.

Signing uses a minisign keypair: `npx tauri signer generate -w ~/.tauri/wahana.key`, put the public key in `src-tauri/tauri.conf.json → plugins.updater.pubkey`, and add the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### Regenerate API types

```bash
curl -sL https://waha.devlike.pro/swagger/openapi.json -o spec/waha-openapi.json
node scripts/fix-spec.mjs
npx openapi-typescript@7 spec/waha-openapi.fixed.json -o src/api/schema.d.ts
```

### Project layout

```
src/api/         typed WAHA client, query hooks, generated OpenAPI types
src/realtime/    WebSocket, presence, scheduler & broadcast runners, updater
src/store/       zustand stores (settings, unread, reactions, receipts, …) and SQLite data layers
src/screens/     Chats (chats/ = list, header, search, bubbles, composer, paging/scroll hooks), Status, Scheduler, Broadcast, Sessions, Events, Settings (settings/ = one file per section)
src/components/  dialogs, menus, media, group tools
src/lib/         WhatsApp markdown, AI client, media cache, secrets, backup, export
src-tauri/       Rust shell: keychain, media cache, tray, SQLite migrations
```

## Known WAHA quirks handled by the app

- History pages can be shorter than `limit` (the server filters after limiting) — only an empty page ends pagination.
- Messages delivered live are sometimes missing from history (e.g. sent by another session on the same server) — the app keeps them locally.
- Undecryptable messages (`UndecryptableMessage`) are shown as "waiting" placeholders until the sender's retry arrives.

## License

[MIT](LICENSE) © Adam Suchi Hafizullah
