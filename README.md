<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Wahana icon">
</p>

<h1 align="center">Wahana</h1>

<p align="center">
  An unofficial, cross-platform WhatsApp desktop client. Link your phone directly — no server, no embedded browser.<br>
  Chat across several accounts — with scheduling, broadcasts, auto-reply, stories, and built-in AI.
</p>

<p align="center">
  <a href="https://github.com/ashafizullah/wahana/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ashafizullah/wahana?display_name=tag&sort=semver"></a>
  <a href="https://github.com/ashafizullah/wahana/actions/workflows/build.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/ashafizullah/wahana/build.yml?label=build"></a>
  <a href="https://github.com/ashafizullah/wahana/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/ashafizullah/wahana/total"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white">
</p>

> **Wahana** means "vehicle / platform" in Indonesian. This is an unofficial client, not affiliated with, endorsed by, or connected to WhatsApp or Meta. "WhatsApp" is a trademark of Meta Platforms, Inc.
>
> Using unofficial clients may violate WhatsApp's Terms of Service and can get your number banned, especially with bulk messaging or auto-replies. Use at your own risk.

## Download

Grab the latest `.dmg` (macOS, Apple Silicon or Intel) or `.msi` (Windows x64) from the [Releases page](https://github.com/ashafizullah/wahana/releases/latest). The app checks for signed updates automatically.

> macOS: the build is not notarized yet, so Gatekeeper may claim the app "is damaged and can't be opened". It isn't — after copying it to Applications, run `xattr -cr /Applications/Wahana.app` once in Terminal, then open it normally. Pick `aarch64` for Apple Silicon (M1–M4) and `x64` for Intel Macs.

## How it works

Wahana is **only a client**. There is no Wahana backend, account, or cloud. It links your own WhatsApp account the same way WhatsApp Web does: you scan a QR code (or enter a pairing code) with your phone.

Accounts connect to WhatsApp directly, via [whatsapp-rust](https://github.com/oxidezap/whatsapp-rust) running inside the app — no server and no embedded browser. Each account keeps its session and chat history in SQLite on your machine. Messages and media stay between your machine and WhatsApp; the project never sees them.

Optionally, for the AI features, your own API key for Anthropic or any OpenAI-compatible endpoint. Requests go straight from the app to that provider.

## Features

**Chats**

- Link accounts with QR / pairing-code login; several accounts in the same picker, each keeping its own session on disk (rename, disconnect, log out, remove)
- Chat history: your phone sends it when an account is linked, it is kept in SQLite, and older messages of a chat are fetched from the phone as you scroll up; group, contact and channel names and profile pictures are filled in
- WhatsApp formatting, emoji, quick replies (`/shortcut` with variables), link previews, quoted replies with media thumbnails
- Send and receive photos, videos, audio, voice notes, documents and stickers (sticker tray with saved and recent ones; any image converted to a 512×512 WebP), with media viewer and save; paste a screenshot to send it
- Message menu: reactions, reply, forward, pin (24 hours / 7 days / 30 days, pins made on the phone show up too), edit, delete for everyone, delete for me, info, translate
- Media auto-load per kind with blurred click-to-load previews, on-disk cache, lightbox with zoom and save
- Read receipts and typing indicator (following the privacy settings), unread badges (list, tab, dock/tray), filters (unread / groups / channels)
- Pin chats, mute for 8 hours / 1 week / always, drafts, labels (create, rename, delete, assign), all synced with your phone
- In-chat search, jump to a pinned message, infinite history paging, export to `.txt` / `.html` / `.json`

**Groups & contacts**

- Group info with description, searchable participants (photos, names, numbers), add / remove / promote / demote
- Join requests (approve / reject), invite link, rename, description, photo, admin-only settings, leave
- Contact profile panel; follow channels

**Status (stories)**

- View contacts' updates (marked as viewed, auto-play, start from unseen, next contact), post text / photo / video, delete your own

**Automation**

- **Scheduler** — one-off or daily / weekly / monthly messages to chats, groups, channels or your status, from any account (SQLite-backed, with history)
- **Broadcast** — one message to many recipients from any account, with random pauses, progress, retry and per-recipient log
- **Auto-reply** — per-account rules (direct messages / groups / specific chats, hours & weekdays, keyword or regex match) answering with a fixed text or an AI reply that follows your instructions; per-chat cooldown, reply log, one-click pause

**AI (bring your own key)**

- Anthropic (official SDK) or any OpenAI-compatible endpoint (routers, Ollama…); optional cheaper "fast model" for short tasks; a persona/system prompt used by every feature, with per-account overrides when one app serves several businesses
- Translate incoming messages and drafts; per-chat auto-translate (incoming shown in your language, outgoing sent in theirs)
- Summarize a chat or group (since last read / today / last N) or ask a question about it
- Writing assistant in the composer (fix grammar, formal / casual / friendlier, shorter / longer, bullets) and reply suggestions
- Describe an image or extract its text (OCR)
- Draft a broadcast or status from a short brief ("Draft with AI" in the composer)
- Optionally label new direct chats automatically with your existing labels (Settings → AI)

**App**

- First-run welcome screen: link WhatsApp, no manual required
- System tray, desktop notifications, keyboard shortcuts, light / dark theme
- Privacy tweaks: typing indicator on/off, read receipts always / on reply / manual / never
- Settings backup & restore (incl. auto-reply rules, theme, stickers, account names), auto-updater

**Not yet**: locations, contacts and polls (shown as "unsupported message"), calls.

## Development

Prerequisites: Node 22+, Rust (via [rustup](https://rustup.rs)), Xcode Command Line Tools (macOS) or Visual Studio Build Tools + WebView2 (Windows).

```bash
npm install
npm run tauri dev
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

### Project layout

```
src/realtime/    scheduler, broadcast & auto-reply runners, notifications, updater
src/store/       zustand stores (settings, reactions, pins, drafts, …) and SQLite data layers
src/screens/     Chats, Status, Features (Scheduler / Broadcast / Auto-reply / Tweaks / Quick replies), Accounts, Settings (settings/ = one file per section)
                 WhatsAppScreen + whatsapp/ = pairing, info panel, group tools, media, labels, status, AI
src/components/  dialogs, menus, media, pickers
src/lib/         WhatsApp markdown, AI client, media cache, secrets, backup; nativeWa.ts (commands & events), send.ts
src-tauri/       Rust shell: keychain, media cache, tray, SQLite migrations
  whatsapp.rs    native client on whatsapp-rust: accounts, pairing, events, send, media, groups, status, labels
  whatsapp_db.rs per-account SQLite chat store: chats, messages, media keys, LID ↔ phone map, labels
```

## License

[MIT](LICENSE) © Adam Suchi Hafizullah
