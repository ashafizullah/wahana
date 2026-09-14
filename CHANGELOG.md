# Changelog

## Unreleased

### Fixed
- Broadcasts created under one server profile no longer run through another profile's connection after switching servers.
- Scrolling up in a chat could page the same history range twice and show duplicate messages.
- The selected chat is cleared when switching sessions; drafts no longer leak between sessions.
- Read receipts are re-sent only when a new incoming message arrives, not every time older history loads.
- Scheduler claims a job before sending, so a second app instance or a crash right after a send cannot send it twice.
- Monthly schedules keep the originally chosen day (a "31st" schedule no longer drifts to the 28th after February).
- A weekly schedule with an empty weekday list keeps its original weekday instead of disabling itself.
- AI requests time out after 60 s instead of leaving a chat's auto-reply stuck.
- Media cache file names are hashed, so two different message ids can no longer map to the same cached file.
- WhatsApp Web: the child webview is created once even when the layout syncs several times at mount; removing a session waits for its browsing data to be cleared before closing.
- WhatsApp Web on macOS 11–13: the picker only offers one account (per-account isolation needs macOS 14).
- Unread badges, notifications and auto-replies ignore replayed / duplicate socket events.
- The WebSocket refetches chats and messages after a reconnect, and reconnects when the network returns or the window is used again after a long idle.

### Added
- "Draft with AI" in the broadcast and status composers: a short brief becomes a ready-to-send message in your persona's voice.
- Optional automatic labelling of new direct chats with your existing labels (Settings → AI, off by default).
- Daily cap on auto-replies (default 300, editable in the Auto-reply header) as a spend guard for AI replies.
- Broadcasts pause automatically after 5 consecutive failures.
- Content-Security-Policy for the app window.
- Unit tests (`npm test`) and a CI workflow that type-checks, tests, builds, and runs clippy/rustfmt on pull requests.

### Changed
- The message list is virtualised: only the bubbles near the viewport are in the DOM, so long scroll-backs no longer accumulate thousands of live bubbles and images.
- `ChatScreen.tsx` split into list / bubble / composer modules; Rust shell split into keychain, media-cache and WhatsApp Web modules (no behaviour change).
- Old schedule runs, auto-reply log rows and finished broadcasts are pruned after 90 days.
- Linux (AppImage / .deb) is built by the release workflow.
- Auto-reply prompts mark the chat transcript as untrusted data (prompt-injection hardening).
- Link previews are fetched only for public http(s) hosts and the preview cache is bounded.
- Chat bubbles are memoised; the session poll no longer re-renders every message.
- Media cache eviction runs on a background thread and only after a batch of new writes.

## 0.4.1 — 2026-09-14
- Fix WhatsApp Web never loading on Windows (WebView2 nested user-data folder) and the settings-page scroll freeze it caused.
- Forced exit fallback when quitting from the tray with a stuck event loop.

## 0.4.0 — 2026-09-14
- Multi-business: session picker for schedules and broadcasts, persona and quick replies per session.
- Auto-reply rules (fixed text or AI) with preview, cooldown, log and kill switch.
- WhatsApp Web split view: several accounts side by side.

## 0.3.0 — 2026-09-14
- Embedded WhatsApp Web sessions in the session picker with OS notifications, downloads and external links.

## 0.2.0 — 2026-09-13
- AI: translation, summaries and Q&A, writing assistant, smart replies, persona, image description / OCR, task extraction, label suggestions.
- Settings backup / restore, per-chat auto-translate.

## 0.1.0 — 2026-09-13
- Initial release: chats, groups, status, scheduler, broadcast, quick replies, labels, exports, webhooks.
