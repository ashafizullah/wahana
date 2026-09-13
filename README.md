# Wahana

**Wahana** (Indonesian for "vehicle / platform") is a cross-platform (macOS + Windows) desktop client for [WAHA](https://waha.devlike.pro) — WhatsApp HTTP API. Point it at your WAHA server, pick a session, and chat.

> Not affiliated with WAHA/devlike.pro or WhatsApp/Meta.

Built with **Tauri 2 + React + TypeScript**. ~10 MB bundle, native webview, API key stored in the OS keychain.

## Features

- Connection settings with "Test connection" (`GET /api/server/version`)
- Sessions: list, create, start/stop/restart/logout/delete, QR-code login (auto-refresh) and phone pairing code
- Chats: overview list with search, message history with "Load older", inline images/audio/video/files
- Send text (with reply), photos, videos, documents, voice messages, location, contacts, polls
- Message menu (right-click): quick reactions, reply, copy, forward, pin, edit, delete
- WhatsApp formatting rendered (*bold*, _italic_, ~strike~, `mono`, lists, quotes, links)
- Media auto-load per kind (images / stickers / videos / audio) or click-to-load blurred previews
- Lightbox for images & videos with zoom and save-to-disk
- Unread badges per chat, on the Chats tab, on the dock icon and tray
- System tray: closing the window hides it; realtime keeps running
- Realtime via WAHA WebSocket (`/ws`): new messages, acks, session status; desktop notifications
- Multi-session: every session on the server is listed; switch from the dropdown above the chat list
- Multiple servers (profiles) with per-server keychain entries; switch from Settings or the chat list
- New chat by phone number (checks the number is on WhatsApp) or from contacts; group info with participants
- Presence: online / last seen / typing in the chat header; sends typing indicators while you write
- In-chat message search (⌘F), chat list filters (All / Unread / Groups), infinite scroll, virtualized list
- Events tab: live log of everything arriving on the WebSocket (great for debugging webhooks)
- Auto-updater: signed releases from GitHub, one-click "Install & restart"
- Keyboard: ⌘K search chats · ⌘F search in chat · ⌘1–4 tabs · ⌘, settings · Esc close
- Light/dark theme follows the OS

## Development

```bash
# prerequisites: Node 22+, Rust (https://rustup.rs), Xcode CLT (mac) / VS Build Tools + WebView2 (win)
npm install
npm run tauri dev
```

Optional: create `.env.development.local` to prefill the connection in dev builds only:

```
VITE_WAHA_BASE_URL=https://your-waha.example.com
VITE_WAHA_API_KEY=your-plain-api-key
VITE_WAHA_SESSION=default
```

> The API key must be the **plaintext** key. If your server config has `WAHA_API_KEY=sha512:...`, that is the hash — clients still send the original key.

## Build

```bash
npm run tauri build            # .dmg / .app on macOS, .msi / .exe on Windows
```

Tag a release (`git tag v0.1.0 && git push --tags`) to have GitHub Actions build all three targets (macOS arm64, macOS x64, Windows x64) into a draft release, including the signed updater artifacts and `latest.json`.

### Release signing (auto-updater)

Updates are verified with a minisign keypair. Generate one once:

```bash
npx tauri signer generate -w ~/.tauri/wahana.key
```

Put the public key in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and add two repository secrets for CI: `TAURI_SIGNING_PRIVATE_KEY` (contents of `wahana.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The updater endpoint points at `releases/latest/download/latest.json` of this repo.

## Icons

`assets/logo-source.png` is the raw mark; `assets/app-icon.png` (macOS, with margin) and `assets/app-icon-fullbleed.png` (Windows/tray) are composed from it. Regenerate the platform icons with:

```bash
npx tauri icon assets/app-icon.png -o src-tauri/icons
```

## Regenerate API types

```bash
curl -sL https://waha.devlike.pro/swagger/openapi.json -o spec/waha-openapi.json
node scripts/fix-spec.mjs
npx openapi-typescript@7 spec/waha-openapi.fixed.json -o src/api/schema.d.ts
```

## Project layout

```
src/api/        typed WAHA client (client.ts), query hooks, generated schema
src/realtime/   WebSocket hook + notifications
src/store/      settings (tauri-plugin-store + OS keychain via Rust command)
src/screens/    Settings, Sessions (QR login), Chat
src-tauri/      Rust shell: keychain commands, plugins (store, notification, http, opener)
```
