# Changelog

## Unreleased

### Changed

- Internal: `SettingsScreen.tsx` (1,180 lines) split into one module per section under `src/screens/settings/`; no behaviour change.

## 0.4.6 — 2026-09-17

### Added

- WhatsApp Web split view: drag the divider between two panes to resize them (double-click to reset to equal widths). Sizes are remembered.
- WhatsApp Web split view: drag a pane's title bar onto another pane to reorder them.
- WhatsApp Web split view: choose how many rows the panes are laid out in (Auto / 1–4).

### Changed

- WhatsApp Web split view is responsive: panes never shrink below 400px; when the window can't fit them all in one row they wrap onto additional rows instead of squeezing.

### Fixed

- Windows: dropping a file onto the composer did nothing (Tauri's native drag-drop handler swallowed the drop).

## 0.4.5 — 2026-09-17

### Changed

- Windows: the setup wizard (NSIS `.exe` header/sidebar and MSI banner/dialog) now shows the Wahana logo instead of the default installer artwork.

## 0.4.4 — 2026-09-17

### Fixed

- Windows: options in native dropdowns (session picker, language selects) were white-on-white in dark mode.

### Changed

- New installs default the AI provider to "OpenAI-compatible" with an empty model; a saved Anthropic setup is unchanged.

## 0.4.3 — 2026-09-17

### Fixed

- A message bubble that changed state in place (e.g. deleted for everyone while on screen) could crash with a hook-order error.

### Changed

- ESLint (typescript-eslint + react-hooks) and Prettier run in `npm run check` and in CI; the whole tree is formatted once.
- The conversation view is split into a header, a search bar and two hooks (`useOrderedMessages`, `useMessageList` for scrolling / paging / virtualisation); `ChatScreen.tsx` is now the glue only.
- Shared helpers replace repeated snippets: `errMsg`, `convKey`, `ViewMessage`, `mediaOpts`, `useLatest`/`useEvent`/`useDismiss`, and a `Popover`/`MenuItem` dropdown that closes on outside click and Escape.

## 0.4.2 — 2026-09-15

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
