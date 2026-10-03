<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Wahana icon">
</p>

<h1 align="center">Wahana</h1>

<p align="center">
  A cross-platform WhatsApp desktop client: link your phone directly (native, no server) or connect to a <a href="https://waha.devlike.pro">WAHA</a> server.<br>
  Chat across several accounts — with scheduling, broadcasts, auto-reply, stories, and built-in AI.
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

> macOS: the build is not notarized yet, so Gatekeeper may claim the app "is damaged and can't be opened". It isn't — after copying it to Applications, run `xattr -cr /Applications/Wahana.app` once in Terminal, then open it normally. Pick `aarch64` for Apple Silicon (M1–M4) and `x64` for Intel Macs.

## How it works

Wahana is **only a client**. There is no Wahana backend, account, or cloud. Accounts come in two kinds, and both live side by side in the same account picker:

|             | **Native WhatsApp**                                                                                      | **WAHA session**                                              |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Connects to | WhatsApp directly, via [whatsapp-rust](https://github.com/oxidezap/whatsapp-rust) running inside the app | **Your own WAHA server** (Docker, VPS, home server, anything) |
| Setup       | Scan a QR code with your phone                                                                           | Server URL + API key, then QR / pairing code per session      |
| Runs while  | The app is open                                                                                          | The server is up (24/7 bots, webhooks)                        |
| Data        | Session and chat history in SQLite on your machine                                                       | On your server                                                |

Either way, your WhatsApp session, messages and media stay between your machine, WhatsApp and (if used) your server; the project never sees them.

For a native account you need nothing but your phone. For WAHA you need:

- A running [WAHA](https://waha.devlike.pro) server (the free **CORE** build works; WAHA 2026.8+ recommended). Several servers can be configured and switched at any time.
- Its **plain-text API key** — if your server config says `WAHA_API_KEY=sha512:…`, that is the hash; clients still send the original key.

Optionally, for the AI features, your own API key for Anthropic or any OpenAI-compatible endpoint. Requests go straight from the app to that provider.

## Features

Features below are for WAHA sessions unless noted; see [Native WhatsApp](#native-whatsapp-no-server-needed) for what native accounts support.

**Chats**

- Session list with QR / pairing-code login, multiple sessions and multiple servers (per-server keys in the OS keychain)
- Realtime via WAHA WebSocket: messages, acks, presence (online / typing), reactions, edits, deletions
- WhatsApp formatting, @mentions with autocomplete, link previews, quoted replies with media thumbnails
- Send text, photos, videos, documents, voice notes, location, contacts, polls; drag-and-drop, and paste of screenshots or copied images anywhere in the chat; stickers from a tray of saved and recent ones
- Message menu: reactions, reply, forward, pin (24 hours / 7 days / 30 days, pins from the phone show up too), edit, delete (for everyone / for me), info (delivery & read times), translate
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

- **Scheduler** — one-off or daily / weekly / monthly messages to chats, groups, channels or your status, from any WAHA session or native account (SQLite-backed, with history)
- **Broadcast** — one message to many recipients from any WAHA session or native account, with random pauses, progress, retry and per-recipient log
- **Auto-reply** — per-account rules (WAHA or native) (direct messages / groups / specific chats, hours & weekdays, keyword or regex match) answering with a fixed text or an AI reply that follows your instructions; per-chat cooldown, reply log, one-click pause
- Webhook manager per session, live event log for debugging integrations

**AI (bring your own key)**

- Anthropic (official SDK) or any OpenAI-compatible endpoint (routers, Ollama…); optional cheaper "fast model" for short tasks; a persona/system prompt used by every feature, with per-session overrides when one app serves several businesses
- Translate incoming messages and drafts; per-chat auto-translate (incoming shown in your language, outgoing sent in theirs)
- Summarize a chat or group (since last read / today / last N) or ask a question about it
- Writing assistant in the composer (fix grammar, formal / casual / friendlier, shorter / longer, bullets) and reply suggestions
- Describe an image or extract its text (OCR)
- Draft a broadcast or status from a short brief ("Draft with AI" in the composer)
- Optionally label new direct chats automatically with your existing labels (Settings → AI)

<a id="native-whatsapp-no-server-needed"></a>**Native WhatsApp (no server needed)**

- Link WhatsApp accounts directly by scanning a QR code: the app talks to WhatsApp itself through [whatsapp-rust](https://github.com/oxidezap/whatsapp-rust), with no server and no embedded browser
- Several accounts next to your WAHA sessions in the same picker; each keeps its own session on disk, reconnects on launch, and can be renamed, disconnected, logged out or removed
- Chat history: your phone sends it when the account is linked, it is kept in SQLite, and older messages of a chat are fetched from the phone as you scroll up; group, contact and channel names and profile pictures are filled in
- Text with WhatsApp formatting, emoji, quick replies; send and receive photos, videos, audio, voice notes, documents and stickers (sticker tray with saved and recent ones, any image converted to a 512×512 WebP), with media viewer and save; paste a screenshot to send it
- Read receipts and typing indicator (following the privacy settings), unread badges, OS notifications, filters (unread / groups / channels)
- Pin chats, mute them for 8 hours / 1 week / always, and manage labels (create, rename, delete, assign), all synced with your phone
- Info panel: contact profile, or group details with members and shared media
- Group management: rename, description, photo, admin-only messages / edit info, join approval, add / remove / promote / demote, join requests, invite link, leave
- Status: view contacts' updates (marked as viewed), post text / photo / video, delete your own
- AI: translate (including per-chat auto-translate), summarize, reply suggestions, writing assistant, describe image / OCR
- Scheduler, broadcast and auto-reply can send from native accounts
- Message actions: reactions, quoted replies, forward, edit, delete for everyone, pin for 24 hours / 7 days / 30 days / unpin (pins made on the phone, including those in history, show up too)
- Not yet: locations, contacts and polls (shown as "unsupported message"), calls

**App**

- First-run welcome screen: link WhatsApp natively or connect a WAHA server, no manual required
- System tray, desktop notifications, incoming-call banner, keyboard shortcuts, light / dark theme
- Privacy tweaks: typing indicator on/off, read receipts always / on reply / manual / never
- Settings backup & restore (incl. auto-reply rules, theme, stickers, native account names), auto-updater

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
                 WhatsAppScreen + whatsapp/ = native accounts: pairing, info panel, group tools, media, labels, status, AI
src/components/  dialogs, menus, media, group tools
src/lib/         WhatsApp markdown, AI client, media cache, secrets, backup, export; nativeWa.ts (native commands & events), send.ts (one send API for WAHA and native)
src-tauri/       Rust shell: keychain, media cache, tray, SQLite migrations
  whatsapp.rs    native client on whatsapp-rust: accounts, pairing, events, send, media, groups, status, labels
  whatsapp_db.rs per-account SQLite chat store: chats, messages, media keys, LID ↔ phone map, labels
```

## Known WAHA quirks handled by the app

- History pages can be shorter than `limit` (the server filters after limiting) — only an empty page ends pagination.
- Messages delivered live are sometimes missing from history (e.g. sent by another session on the same server) — the app keeps them locally.
- Undecryptable messages (`UndecryptableMessage`) are shown as "waiting" placeholders until the sender's retry arrives.

## License

[MIT](LICENSE) © Adam Suchi Hafizullah
