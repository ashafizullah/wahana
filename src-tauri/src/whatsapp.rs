//! Native WhatsApp accounts, backed by the `whatsapp-rust` multi-device client.
//!
//! This replaces the embedded WhatsApp Web child webviews: instead of rendering
//! `web.whatsapp.com` in a browser, the app speaks the protocol directly. Each account has
//! two SQLite files under the app's local data directory: `<id>.db`, the protocol session
//! owned by `whatsapp-rust`, and `<id>.chats.db`, the chat history (see `whatsapp_db`).
//!
//! History arrives from the phone right after pairing; older messages of a chat can be
//! asked for on demand. Media is downloaded on request and decrypted here; read receipts
//! and presence are not wired up yet.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use whatsapp_rust::download::{Downloadable, MediaType};
use whatsapp_rust::features::ParticipantChangeResponse;
use whatsapp_rust::prelude::*;
use whatsapp_rust::types::events::{Event, EventKind};
use whatsapp_rust::waproto::buffa::{self, Message as _};
use whatsapp_rust::waproto::whatsapp as wa;
use whatsapp_rust_sqlite_storage::SqliteStore;

use crate::whatsapp_db::{ChatDb, IncomingMessage, NameSource, StoredMedia};

/// The account list, next to the per-account session databases. The databases alone
/// cannot rebuild it: they hold no display name, and a half-written one is
/// indistinguishable from a paired one by its file name.
const ACCOUNTS_FILE: &str = "accounts.json";

/// Messages asked of the phone per "load older" request.
const OLDER_PAGE: i32 = 50;

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WaStatus {
    #[default]
    Stopped,
    Starting,
    Qr,
    Working,
    LoggedOut,
    Failed,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountMe {
    pub id: String,
    pub push_name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    pub name: String,
    pub status: WaStatus,
    pub me: Option<AccountMe>,
    pub error: Option<String>,
    /// Chats with unread messages, counted like WhatsApp's own badge.
    pub unread: u32,
    /// Percent of the history transfer from the phone, while one is running.
    pub syncing: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInfo {
    pub id: String,
    pub name: String,
    pub last_text: String,
    pub last_timestamp: i64,
    pub last_from_me: bool,
    /// Name of whoever sent the last message, for "Name: text" group previews.
    pub last_sender: String,
    pub unread: u32,
    /// "+62…" for a direct chat whose number is known.
    pub phone: Option<String>,
    /// Named from your contacts (or a group); otherwise `name` is only what the other side
    /// calls themselves, and the number is what identifies them.
    pub saved: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    pub id: String,
    pub chat_id: String,
    pub from_me: bool,
    pub sender_name: String,
    pub sender_phone: Option<String>,
    pub kind: MessageKind,
    /// The text, or a media message's caption.
    pub body: String,
    pub timestamp: i64,
    pub media: Option<MediaInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    /// image, video, audio, ptt (voice note), document, or sticker.
    pub kind: String,
    pub mimetype: String,
    pub file_name: Option<String>,
    pub size: Option<u64>,
    pub seconds: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// The blurry inline preview, as a data URL.
    pub thumbnail: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    Text,
    Media,
    /// A real message this client cannot show yet (location, contact, poll, …).
    Unsupported,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QrPayload {
    id: String,
    code: String,
    timeout_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatsPayload {
    id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessagesPayload {
    id: String,
    messages: Vec<MessageView>,
}

/// Emitted when a status (story) arrives, so the status screen can refetch without a chat event.
#[derive(Clone, Serialize)]
struct StatusPayload {
    id: String,
}

#[derive(Serialize, Deserialize)]
struct StoredAccount {
    id: String,
    name: String,
}

#[derive(Default)]
struct AccountInner {
    status: WaStatus,
    me: Option<AccountMe>,
    error: Option<String>,
    /// Claimed by `wa_native_start` before the client exists, so a second start is refused
    /// even while the first is still building. Released by stop, failure, or once a logged
    /// out client has finished shutting down.
    running: bool,
    /// Bumped by every start, stop, and logout. Each client's callbacks carry the
    /// generation they were started with and drop anything once it is no longer current,
    /// so a client that is still winding down cannot overwrite its successor's state.
    generation: u64,
    /// Set when the server logged this device out. The store still holds the revoked
    /// credentials, which would only be rejected again, so the next start pairs afresh.
    reset_session: bool,
    handle: Option<BotHandle>,
    client: Option<Arc<Client>>,
    syncing: Option<u32>,
    /// Profile picture URLs by chat id; `None` once looked up and found to have none.
    pictures: HashMap<String, Option<String>>,
}

pub struct WaAccount {
    id: String,
    name: Mutex<String>,
    inner: Mutex<AccountInner>,
    /// Locked after `inner` whenever both are needed, never the other way round.
    db: Mutex<ChatDb>,
}

impl WaAccount {
    fn open(app: &AppHandle, id: String, name: String) -> Result<Self, String> {
        let db = ChatDb::open(&chats_path(app, &id)?)
            .map_err(|e| format!("failed to open WhatsApp chat history: {e}"))?;
        Ok(Self {
            id,
            name: Mutex::new(name),
            inner: Mutex::new(AccountInner::default()),
            db: Mutex::new(db),
        })
    }

    fn info(&self) -> AccountInfo {
        let inner = self.inner.lock().unwrap();
        AccountInfo {
            id: self.id.clone(),
            name: self.name.lock().unwrap().clone(),
            status: inner.status,
            me: inner.me.clone(),
            error: inner.error.clone(),
            unread: self.db.lock().unwrap().unread_chats(),
            syncing: inner.syncing,
        }
    }

    fn is_current(&self, generation: u64) -> bool {
        self.inner.lock().unwrap().generation == generation
    }
}

/// Accounts live in Tauri-managed state rather than a module static: unlike the webview
/// registry, this holds live connections that the commands must reach by name.
#[derive(Default)]
pub struct WaState {
    accounts: Mutex<HashMap<String, Arc<WaAccount>>>,
}

impl WaState {
    fn get(&self, id: &str) -> Result<Arc<WaAccount>, String> {
        self.accounts
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("unknown WhatsApp account: {id}"))
    }
}

/// Account ids name the session's own database file, so they are validated rather than
/// trusted: 32 hex characters, exactly as the frontend generates them.
fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn whatsapp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("whatsapp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn session_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(whatsapp_dir(app)?.join(format!("{id}.db")))
}

fn chats_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(whatsapp_dir(app)?.join(format!("{id}.chats.db")))
}

fn remove_sqlite_files(db_path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let path = PathBuf::from(format!("{}{suffix}", db_path.to_string_lossy()));
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Writes the account list. Called with the accounts lock held so two concurrent changes
/// cannot land on disk in the opposite order from memory.
fn save_accounts(
    app: &AppHandle,
    accounts: &HashMap<String, Arc<WaAccount>>,
) -> Result<(), String> {
    let list: Vec<StoredAccount> = accounts
        .values()
        .map(|a| StoredAccount {
            id: a.id.clone(),
            name: a.name.lock().unwrap().clone(),
        })
        .collect();
    let json = serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?;
    let dir = whatsapp_dir(app)?;
    // Write-then-rename, so a crash mid-write cannot leave a truncated list that would
    // orphan every session on the next launch.
    let tmp = dir.join(format!("{ACCOUNTS_FILE}.tmp"));
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(ACCOUNTS_FILE)).map_err(|e| e.to_string())
}

/// Loads the saved account list and starts every account, the way the WhatsApp Web panes
/// used to load on launch. A paired account reconnects from its session database without
/// a new QR.
pub fn restore(app: &AppHandle) {
    let Ok(dir) = whatsapp_dir(app) else { return };
    let Ok(bytes) = std::fs::read(dir.join(ACCOUNTS_FILE)) else {
        return;
    };
    let list: Vec<StoredAccount> = match serde_json::from_slice(&bytes) {
        Ok(list) => list,
        Err(e) => {
            eprintln!("ignoring unreadable WhatsApp account list: {e}");
            return;
        }
    };
    let state = app.state::<WaState>();
    let restored: Vec<Arc<WaAccount>> = {
        let mut accounts = state.accounts.lock().unwrap();
        list.into_iter()
            .filter(|a| valid_id(&a.id))
            .filter_map(
                |stored| match WaAccount::open(app, stored.id, stored.name) {
                    Ok(account) => {
                        let account = Arc::new(account);
                        accounts.insert(account.id.clone(), account.clone());
                        Some(account)
                    }
                    Err(e) => {
                        eprintln!("{e}");
                        None
                    }
                },
            )
            .collect()
    };
    for account in restored {
        if let Err(e) = start_account(app, account) {
            eprintln!("failed to start WhatsApp account: {e}");
        }
    }
}

fn emit_account(app: &AppHandle, account: &WaAccount) {
    let _ = app.emit_to("main", "wa_native:account", account.info());
}

fn emit_chats(app: &AppHandle, account: &WaAccount) {
    let _ = app.emit_to(
        "main",
        "wa_native:chats",
        ChatsPayload {
            id: account.id.clone(),
        },
    );
}

fn set_error(app: &AppHandle, account: &WaAccount, generation: u64, message: String) {
    {
        let mut inner = account.inner.lock().unwrap();
        if inner.generation != generation {
            return;
        }
        inner.running = false;
        inner.status = WaStatus::Failed;
        inner.error = Some(message);
    }
    emit_account(app, account);
}

/// A user or group id without the device part ("628…:12@s.whatsapp.net" → "628…@s.whatsapp.net"),
/// so a sender's messages from different devices share one name.
fn bare_jid(id: &str) -> String {
    match id.split_once('@') {
        Some((user, server)) => format!("{}@{server}", user.split(':').next().unwrap_or(user)),
        None => id.to_string(),
    }
}

/// The attachment of a message, if it has one: display details plus a message holding
/// only the media part, encoded, which keeps the keys needed to download it.
fn extract_media(message: &wa::Message) -> Option<StoredMedia> {
    let base = message.get_base_message();
    let mut only = wa::Message::default();
    let mut media = if let Some(m) = base.image_message.as_option() {
        only.image_message = buffa::MessageField::some(m.clone());
        StoredMedia {
            kind: "image",
            mimetype: m.mimetype.clone().unwrap_or_else(|| "image/jpeg".into()),
            file_name: None,
            size: m.file_length,
            seconds: None,
            width: m.width,
            height: m.height,
            thumbnail: m.jpeg_thumbnail.clone(),
            proto: Vec::new(),
        }
    } else if let Some(m) = base
        .video_message
        .as_option()
        .or(base.ptv_message.as_option())
    {
        only.video_message = buffa::MessageField::some(m.clone());
        StoredMedia {
            kind: "video",
            mimetype: m.mimetype.clone().unwrap_or_else(|| "video/mp4".into()),
            file_name: None,
            size: m.file_length,
            seconds: m.seconds,
            width: m.width,
            height: m.height,
            thumbnail: m.jpeg_thumbnail.clone(),
            proto: Vec::new(),
        }
    } else if let Some(m) = base.audio_message.as_option() {
        only.audio_message = buffa::MessageField::some(m.clone());
        StoredMedia {
            kind: if m.ptt == Some(true) { "ptt" } else { "audio" },
            mimetype: m.mimetype.clone().unwrap_or_else(|| "audio/ogg".into()),
            file_name: None,
            size: m.file_length,
            seconds: m.seconds,
            width: None,
            height: None,
            thumbnail: None,
            proto: Vec::new(),
        }
    } else if let Some(m) = base.document_message.as_option().or_else(|| {
        base.document_with_caption_message
            .as_option()
            .and_then(|f| f.message.as_option())
            .and_then(|inner| inner.document_message.as_option())
    }) {
        only.document_message = buffa::MessageField::some(m.clone());
        StoredMedia {
            kind: "document",
            mimetype: m
                .mimetype
                .clone()
                .unwrap_or_else(|| "application/octet-stream".into()),
            file_name: m.file_name.clone().or_else(|| m.title.clone()),
            size: m.file_length,
            seconds: None,
            width: None,
            height: None,
            thumbnail: m.jpeg_thumbnail.clone(),
            proto: Vec::new(),
        }
    } else {
        let m = base.sticker_message.as_option()?;
        only.sticker_message = buffa::MessageField::some(m.clone());
        StoredMedia {
            kind: "sticker",
            mimetype: m.mimetype.clone().unwrap_or_else(|| "image/webp".into()),
            file_name: None,
            size: m.file_length,
            seconds: None,
            width: m.width,
            height: m.height,
            thumbnail: None,
            proto: Vec::new(),
        }
    };
    media.proto = only.encode_to_vec();
    Some(media)
}

/// The text of a message plus its attachment, or `None` for protocol traffic (reactions,
/// revokes, key distribution) that rides on the message channel but is not a message of
/// its own.
fn message_content(message: &wa::Message) -> Option<(MessageKind, String, Option<StoredMedia>)> {
    if let Some(media) = extract_media(message) {
        let caption = message.get_caption().unwrap_or_default().to_string();
        return Some((MessageKind::Media, caption, Some(media)));
    }
    if let Some(text) = message.text_content() {
        return Some((MessageKind::Text, text.to_string(), None));
    }
    let base = message.get_base_message();
    if base.protocol_message.is_set()
        || base.reaction_message.is_set()
        || base.sender_key_distribution_message.is_set()
    {
        return None;
    }
    Some((MessageKind::Unsupported, String::new(), None))
}

/// Stores a live message, sent or received, and notifies the frontend.
fn record_message(
    app: &AppHandle,
    account: &Arc<WaAccount>,
    generation: u64,
    message: IncomingMessage,
) {
    if !account.is_current(generation) {
        return;
    }
    let inserted = match account.db.lock().unwrap().insert_message(&message, true) {
        Ok(inserted) => inserted,
        Err(e) => {
            eprintln!("failed to store WhatsApp message: {e}");
            return;
        }
    };
    if !inserted {
        return;
    }
    // Stories are stored but are not chat traffic: they get their own event and no notification.
    if message.view.chat_id == "status@broadcast" {
        let _ = app.emit_to(
            "main",
            "wa_native:status",
            StatusPayload {
                id: account.id.clone(),
            },
        );
        emit_account(app, account);
        return;
    }
    let mut view = message.view;
    view.media = message.media.as_ref().map(StoredMedia::info);
    let _ = app.emit_to(
        "main",
        "wa_native:messages",
        MessagesPayload {
            id: account.id.clone(),
            messages: vec![view],
        },
    );
    emit_account(app, account);
}

/// Names group chats by their subject. Groups are only listed by the server on request,
/// so this runs on every connect; a failure just leaves groups named by their id.
async fn load_group_names(app: &AppHandle, account: &WaAccount, generation: u64, client: &Client) {
    let groups = match client.groups().get_participating().await {
        Ok(groups) => groups,
        Err(e) => {
            eprintln!("failed to list WhatsApp groups: {e}");
            return;
        }
    };
    if !account.is_current(generation) {
        return;
    }
    let result = account.db.lock().unwrap().batch(|db| {
        for (jid, meta) in &groups {
            db.set_name(&jid.to_string(), &meta.subject, NameSource::GroupSubject)?;
        }
        Ok(())
    });
    if let Err(e) = result {
        eprintln!("failed to store WhatsApp group names: {e}");
    }
    emit_chats(app, account);
}

/// Fills in phone numbers for direct chats that run on a privacy id, from the mappings
/// the protocol layer has learned.
async fn map_lids(app: &AppHandle, account: &WaAccount, generation: u64, client: &Client) {
    let lids = account
        .db
        .lock()
        .unwrap()
        .unmapped_lids()
        .unwrap_or_default();
    let mut found = false;
    for lid in lids {
        let Ok(jid) = lid.parse::<Jid>() else {
            continue;
        };
        if let Ok(Some(entry)) = client.get_lid_pn_entry(&jid).await {
            if !account.is_current(generation) {
                return;
            }
            let pn = format!("{}@s.whatsapp.net", entry.phone_number);
            let _ = account.db.lock().unwrap().set_lid_pn(&lid, &pn);
            found = true;
        }
    }
    if found {
        emit_chats(app, account);
    }
}

/// Converts one message from a history transfer.
fn history_message(chat_id: &str, info: &wa::WebMessageInfo) -> Option<IncomingMessage> {
    let key = info.key.as_option()?;
    let id = key.id.clone()?;
    let (kind, body, media) = message_content(info.message.as_option()?)?;
    let from_me = key.from_me.unwrap_or(false);
    let sender_id = if from_me {
        String::new()
    } else {
        bare_jid(
            key.participant
                .as_deref()
                .or(info.participant.as_deref())
                .unwrap_or(chat_id),
        )
    };
    Some(IncomingMessage {
        view: MessageView {
            id,
            chat_id: chat_id.to_string(),
            from_me,
            sender_name: info.push_name.clone().unwrap_or_default(),
            sender_phone: None,
            kind,
            body,
            timestamp: info.message_timestamp.unwrap_or_default() as i64 * 1000,
            media: None,
        },
        sender_id,
        media,
    })
}

/// Writes a decoded history chunk: conversations with their unread counts, their
/// messages, and the push names that came with them.
fn store_history(db: &ChatDb, sync: &wa::HistorySync) -> rusqlite::Result<()> {
    for mapping in &sync.phone_number_to_lid_mappings {
        if let (Some(pn), Some(lid)) = (&mapping.pn_jid, &mapping.lid_jid) {
            db.set_lid_pn(&bare_jid(lid), &bare_jid(pn))?;
        }
    }
    for pushname in &sync.pushnames {
        if let (Some(id), Some(name)) = (&pushname.id, &pushname.pushname) {
            db.set_name(&bare_jid(id), name, NameSource::PushName)?;
        }
    }
    for conversation in &sync.conversations {
        let chat_id = conversation.id.as_str();
        if chat_id.is_empty() || chat_id == "status@broadcast" {
            continue;
        }
        let name = conversation
            .name
            .as_deref()
            .or(conversation.display_name.as_deref())
            .unwrap_or_default();
        db.set_name(chat_id, name, NameSource::History)?;
        if let (Some(pn), Some(lid)) = (&conversation.pn_jid, &conversation.lid_jid) {
            db.set_lid_pn(&bare_jid(lid), &bare_jid(pn))?;
        } else if let Some(pn) = &conversation.pn_jid {
            db.set_lid_pn(chat_id, &bare_jid(pn))?;
        }
        let timestamp = conversation
            .conversation_timestamp
            .or(conversation.last_msg_timestamp)
            .unwrap_or_default() as i64
            * 1000;
        db.ensure_chat(chat_id, timestamp, conversation.unread_count.unwrap_or(0))?;
        for entry in &conversation.messages {
            let Some(info) = entry.message.as_option() else {
                continue;
            };
            if let Some(message) = history_message(chat_id, info) {
                db.insert_message(&message, false)?;
            }
        }
    }
    Ok(())
}

/// Handles the events the per-kind `Bot` callbacks do not cover: history transfers and
/// contact names from the phone's address book.
async fn handle_event(app: AppHandle, account: Arc<WaAccount>, generation: u64, event: Arc<Event>) {
    if !account.is_current(generation) {
        return;
    }
    match &*event {
        Event::HistorySync(sync) => {
            let progress = sync.progress();
            let sync = (**sync).clone();
            let db_account = account.clone();
            // A chunk can be megabytes of compressed protobuf: inflate and write it off
            // the async runtime.
            let result = tauri::async_runtime::spawn_blocking(move || {
                let Some(decoded) = sync.get() else {
                    return Ok(());
                };
                db_account
                    .db
                    .lock()
                    .unwrap()
                    .batch(|db| store_history(db, decoded))
            })
            .await;
            match result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => eprintln!("failed to store WhatsApp history: {e}"),
                Err(e) => eprintln!("WhatsApp history task failed: {e}"),
            }
            account.inner.lock().unwrap().syncing = progress.filter(|p| *p < 100);
            emit_chats(&app, &account);
            emit_account(&app, &account);
        }
        Event::ContactUpdate(update) => {
            let action = &update.action;
            let Some(name) = action.full_name.as_deref().or(action.first_name.as_deref()) else {
                return;
            };
            let ids = [
                Some(update.jid.to_string()),
                action.pn_jid.clone(),
                action.lid_jid.clone(),
            ];
            let db = account.db.lock().unwrap();
            if let (Some(pn), Some(lid)) = (&action.pn_jid, &action.lid_jid) {
                let _ = db.set_lid_pn(&bare_jid(lid), &bare_jid(pn));
            }
            for id in ids.into_iter().flatten() {
                let _ = db.set_name(&bare_jid(&id), name, NameSource::Contact);
            }
            drop(db);
            emit_chats(&app, &account);
        }
        Event::PushNameUpdate(update) => {
            let _ = account.db.lock().unwrap().set_name(
                &bare_jid(&update.jid.to_string()),
                &update.new_push_name,
                NameSource::PushName,
            );
            emit_chats(&app, &account);
        }
        _ => {}
    }
}

/// Builds and starts the client for one account. Runs on the async runtime so the Tauri
/// command returns immediately and the QR code can arrive whenever the server sends it.
async fn run_account(
    app: AppHandle,
    account: Arc<WaAccount>,
    db_path: PathBuf,
    generation: u64,
    reset_session: bool,
) -> Result<(), String> {
    if reset_session {
        remove_sqlite_files(&db_path);
        // The next pairing may be a different phone; it sends its own history anyway.
        if let Err(e) = account.db.lock().unwrap().clear() {
            eprintln!("failed to clear WhatsApp chat history: {e}");
        }
        emit_chats(&app, &account);
    }
    let database_url = db_path.to_string_lossy().to_string();
    let store = SqliteStore::new(&database_url)
        .await
        .map_err(|e| format!("failed to open WhatsApp session store: {e}"))?;

    let qr_app = app.clone();
    let qr_account = account.clone();
    let on_qr = move |code: String, timeout: std::time::Duration| {
        let app = qr_app.clone();
        let account = qr_account.clone();
        async move {
            {
                let mut inner = account.inner.lock().unwrap();
                if inner.generation != generation {
                    return;
                }
                inner.status = WaStatus::Qr;
                inner.error = None;
            }
            let _ = app.emit_to(
                "main",
                "wa_native:qr",
                QrPayload {
                    id: account.id.clone(),
                    code,
                    timeout_ms: timeout.as_millis() as u64,
                },
            );
            emit_account(&app, &account);
        }
    };

    let connected_app = app.clone();
    let connected_account = account.clone();
    let on_connected = move |client: Arc<Client>| {
        let app = connected_app.clone();
        let account = connected_account.clone();
        async move {
            let device = client.persistence_manager().get_device_snapshot();
            {
                let mut inner = account.inner.lock().unwrap();
                if inner.generation != generation {
                    return;
                }
                inner.status = WaStatus::Working;
                inner.error = None;
                inner.me = Some(AccountMe {
                    id: device
                        .pn
                        .as_ref()
                        .map(|jid| jid.to_string())
                        .unwrap_or_default(),
                    push_name: device.push_name.clone(),
                });
            }
            emit_account(&app, &account);
            // Off the event handler: it waits on a server round trip.
            tauri::async_runtime::spawn(async move {
                load_group_names(&app, &account, generation, &client).await;
                map_lids(&app, &account, generation, &client).await;
            });
        }
    };

    let message_app = app.clone();
    let message_account = account.clone();
    let on_message = move |ctx: MessageContext| {
        let app = message_app.clone();
        let account = message_account.clone();
        async move {
            let Some((kind, body, media)) = message_content(&ctx.message) else {
                return;
            };
            let source = &ctx.info.source;
            let from_me = source.is_from_me;
            let sender = bare_jid(&source.sender.to_string());
            // A message from a privacy id usually carries the sender's phone number too.
            if let Some(alt) = &source.sender_alt {
                let alt = bare_jid(&alt.to_string());
                let _ = account.db.lock().unwrap().set_lid_pn(&sender, &alt);
                let _ = account.db.lock().unwrap().set_lid_pn(&alt, &sender);
            }
            let message = IncomingMessage {
                view: MessageView {
                    id: ctx.info.id.to_string(),
                    chat_id: source.chat.to_string(),
                    from_me,
                    sender_name: ctx.info.push_name.clone(),
                    sender_phone: None,
                    kind,
                    body,
                    timestamp: ctx.info.timestamp.timestamp_millis(),
                    media: None,
                },
                sender_id: if from_me { String::new() } else { sender },
                media,
            };
            record_message(&app, &account, generation, message);
        }
    };

    let event_app = app.clone();
    let event_account = account.clone();
    let on_event = move |event: Arc<Event>, _client: Arc<Client>| {
        handle_event(event_app.clone(), event_account.clone(), generation, event)
    };

    let logout_app = app.clone();
    let logout_account = account.clone();
    let on_logged_out = move |_info: whatsapp_rust::types::events::LoggedOut| {
        let app = logout_app.clone();
        let account = logout_account.clone();
        async move {
            let (handle, retired) = {
                let mut inner = account.inner.lock().unwrap();
                if inner.generation != generation {
                    return;
                }
                inner.generation += 1;
                inner.status = WaStatus::LoggedOut;
                inner.me = None;
                inner.client = None;
                inner.syncing = None;
                inner.reset_session = true;
                (inner.handle.take(), inner.generation)
            };
            emit_account(&app, &account);
            // This handler runs on the client's own event dispatch, so the shutdown it
            // waits on is moved off it.
            tauri::async_runtime::spawn(async move {
                if let Some(handle) = handle {
                    handle.shutdown().await;
                }
                let mut inner = account.inner.lock().unwrap();
                if inner.generation == retired {
                    inner.running = false;
                }
            });
        }
    };

    let bot = Bot::builder()
        .with_backend(store)
        .on_qr_code(on_qr)
        .on_connected(on_connected)
        .on_message(on_message)
        .on_event_for(
            &[
                EventKind::HistorySync,
                EventKind::ContactUpdate,
                EventKind::PushNameUpdate,
            ],
            on_event,
        )
        .on_logged_out(on_logged_out)
        .build()
        .await
        .map_err(|e| format!("failed to start WhatsApp client: {e}"))?;

    let handle = bot.spawn();
    let client = handle.client();
    let orphaned = {
        let mut inner = account.inner.lock().unwrap();
        if inner.generation == generation {
            inner.handle = Some(handle);
            inner.client = Some(client);
            None
        } else {
            Some(handle)
        }
    };
    // Stopped while the client was being built: nothing else will ever reach this handle,
    // so shut it down here instead of leaving a live connection behind.
    if let Some(handle) = orphaned {
        handle.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
pub fn wa_native_accounts(state: State<'_, WaState>) -> Vec<AccountInfo> {
    let accounts = state.accounts.lock().unwrap();
    let mut list: Vec<AccountInfo> = accounts.values().map(|a| a.info()).collect();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

#[tauri::command]
pub fn wa_native_add(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    name: String,
) -> Result<AccountInfo, String> {
    if !valid_id(&id) {
        return Err("invalid WhatsApp account id".into());
    }
    let account = Arc::new(WaAccount::open(&app, id.clone(), name)?);
    {
        let mut accounts = state.accounts.lock().unwrap();
        if accounts.contains_key(&id) {
            return Err(format!("WhatsApp account already exists: {id}"));
        }
        accounts.insert(id.clone(), account.clone());
        if let Err(e) = save_accounts(&app, &accounts) {
            accounts.remove(&id);
            return Err(format!("failed to save WhatsApp accounts: {e}"));
        }
    }
    emit_account(&app, &account);
    Ok(account.info())
}

#[tauri::command]
pub async fn wa_native_start(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
) -> Result<(), String> {
    start_account(&app, state.get(&id)?)
}

fn start_account(app: &AppHandle, account: Arc<WaAccount>) -> Result<(), String> {
    let app = app.clone();
    let db_path = session_path(&app, &account.id)?;
    let (generation, reset_session) = {
        let mut inner = account.inner.lock().unwrap();
        // A second client on the same session would displace the first (the server closes
        // the older stream), so refuse rather than let the two fight.
        if inner.running {
            return Err("WhatsApp account is already running".into());
        }
        inner.running = true;
        inner.generation += 1;
        inner.status = WaStatus::Starting;
        inner.error = None;
        (inner.generation, std::mem::take(&mut inner.reset_session))
    };
    emit_account(&app, &account);
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_account(
            app.clone(),
            account.clone(),
            db_path,
            generation,
            reset_session,
        )
        .await
        {
            set_error(&app, &account, generation, error);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn wa_native_rename(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("account name cannot be empty".into());
    }
    let account = {
        let accounts = state.accounts.lock().unwrap();
        let account = accounts
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown WhatsApp account: {id}"))?;
        let previous = std::mem::replace(&mut *account.name.lock().unwrap(), name.to_string());
        if let Err(e) = save_accounts(&app, &accounts) {
            *account.name.lock().unwrap() = previous;
            return Err(format!("failed to save WhatsApp accounts: {e}"));
        }
        account
    };
    emit_account(&app, &account);
    Ok(())
}

#[tauri::command]
pub async fn wa_native_stop(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let handle = {
        let mut inner = account.inner.lock().unwrap();
        inner.generation += 1;
        inner.running = false;
        inner.client = None;
        inner.status = WaStatus::Stopped;
        inner.me = None;
        inner.syncing = None;
        inner.handle.take()
    };
    if let Some(handle) = handle {
        tauri::async_runtime::spawn(async move {
            handle.shutdown().await;
        });
    }
    emit_account(&app, &account);
    Ok(())
}

/// Unlinks this device from the phone. The resulting `LoggedOut` event does the cleanup.
#[tauri::command]
pub async fn wa_native_logout(state: State<'_, WaState>, id: String) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("start the WhatsApp account before logging it out")?;
    client.logout().await;
    Ok(())
}

#[tauri::command]
pub async fn wa_native_remove(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
) -> Result<(), String> {
    let account = {
        let mut accounts = state.accounts.lock().unwrap();
        let account = accounts
            .remove(&id)
            .ok_or_else(|| format!("unknown WhatsApp account: {id}"))?;
        save_accounts(&app, &accounts)?;
        account
    };
    let handle = {
        let mut inner = account.inner.lock().unwrap();
        inner.generation += 1;
        inner.running = false;
        inner.client = None;
        inner.handle.take()
    };
    if let Some(handle) = handle {
        handle.shutdown().await;
    }
    remove_sqlite_files(&session_path(&app, &id)?);
    remove_sqlite_files(&chats_path(&app, &id)?);
    Ok(())
}

/// Sends a text message and records it in the chat, since the server does not echo a
/// device's own sends back to it.
#[tauri::command]
pub async fn wa_native_send_text(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    text: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let (client, generation, sender_name) = {
        let inner = account.inner.lock().unwrap();
        let client = inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?;
        let sender_name = inner
            .me
            .as_ref()
            .map(|me| me.push_name.clone())
            .unwrap_or_default();
        (client, inner.generation, sender_name)
    };
    let to: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let sent = client
        .send_text(to, text.clone())
        .await
        .map_err(|e| e.to_string())?;
    let message = IncomingMessage {
        view: MessageView {
            id: sent.message_id,
            chat_id,
            from_me: true,
            sender_name,
            sender_phone: None,
            kind: MessageKind::Text,
            body: text,
            timestamp: now_millis(),
            media: None,
        },
        sender_id: String::new(),
        media: None,
    };
    record_message(&app, &account, generation, message);
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

#[tauri::command]
pub fn wa_native_chats(state: State<'_, WaState>, id: String) -> Result<Vec<ChatInfo>, String> {
    let account = state.get(&id)?;
    let chats = account.db.lock().unwrap().chats();
    chats.map_err(|e| e.to_string())
}

/// The newest `limit` stored messages of a chat, oldest first.
#[tauri::command]
pub fn wa_native_messages(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    limit: u32,
) -> Result<Vec<MessageView>, String> {
    let account = state.get(&id)?;
    let messages = account.db.lock().unwrap().messages(&chat_id, limit);
    messages.map_err(|e| e.to_string())
}

/// Asks the phone for messages older than the oldest one stored. They arrive later as an
/// on-demand history transfer, announced with `wa_native:chats`.
#[tauri::command]
pub async fn wa_native_load_older(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let oldest = account.db.lock().unwrap().oldest_message(&chat_id);
    let (oldest_id, from_me, timestamp) = oldest
        .map_err(|e| e.to_string())?
        .ok_or("this chat has no messages to continue from")?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    client
        .fetch_message_history(&jid, &oldest_id, from_me, timestamp, OLDER_PAGE)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Clears the local unread count (its own command; see `wa_native_send_receipt` for blue ticks).
#[tauri::command]
pub fn wa_native_mark_read(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let result = account.db.lock().unwrap().mark_read(&chat_id);
    result.map_err(|e| e.to_string())?;
    emit_account(&app, &account);
    Ok(())
}

/// Tells WhatsApp the chat's newest incoming messages were read (blue ticks). Unlike
/// `wa_native_mark_read`, which only clears the local unread count. Best-effort.
#[tauri::command]
pub async fn wa_native_send_receipt(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let incoming = account
        .db
        .lock()
        .unwrap()
        .incoming_ids(&chat_id, 100)
        .unwrap_or_default();
    if incoming.is_empty() {
        return Ok(());
    }
    if chat_id.ends_with("@g.us") {
        // A group receipt carries the original sender, so one call per participant.
        let mut by_sender: HashMap<String, Vec<String>> = HashMap::new();
        for (sender, message) in incoming {
            if !sender.is_empty() {
                by_sender.entry(sender).or_default().push(message);
            }
        }
        for (sender, messages) in by_sender {
            let Ok(sender) = sender.parse::<Jid>() else {
                continue;
            };
            let ids: Vec<&str> = messages.iter().map(String::as_str).collect();
            let _ = client.mark_as_read(&jid, Some(&sender), &ids).await;
        }
    } else {
        let ids: Vec<&str> = incoming.iter().map(|(_, m)| m.as_str()).collect();
        client
            .mark_as_read(&jid, None, &ids)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Sends (or stops) the "typing…" chat state. Best-effort: a dropped update is harmless.
#[tauri::command]
pub async fn wa_native_set_typing(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    on: bool,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let result = if on {
        client.chatstate().send_composing(&jid).await
    } else {
        client.chatstate().send_paused(&jid).await
    };
    result.map_err(|e| e.to_string())
}

/// Looks up a chat's profile picture (the small preview), once per chat per run.
#[tauri::command]
pub async fn wa_native_picture(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<Option<String>, String> {
    let account = state.get(&id)?;
    let client = {
        let inner = account.inner.lock().unwrap();
        if let Some(cached) = inner.pictures.get(&chat_id) {
            return Ok(cached.clone());
        }
        inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?
    };
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let url = client
        .contacts()
        .get_profile_picture(&jid, true)
        .await
        .map_err(|e| e.to_string())?
        .map(|picture| picture.url);
    account
        .inner
        .lock()
        .unwrap()
        .pictures
        .insert(chat_id, url.clone());
    Ok(url)
}

/// Downloads and decrypts a message's attachment. Returned as raw bytes; the frontend
/// keeps them in the shared media cache.
#[tauri::command]
pub async fn wa_native_media(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    message_id: String,
) -> Result<Response, String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let proto = account
        .db
        .lock()
        .unwrap()
        .media_proto(&chat_id, &message_id)
        .map_err(|e| e.to_string())?
        .ok_or("this message has no media")?;
    let message = wa::Message::decode(&mut proto.as_slice()).map_err(|e| e.to_string())?;
    let downloadable: &dyn Downloadable = if let Some(m) = message.image_message.as_option() {
        m
    } else if let Some(m) = message.video_message.as_option() {
        m
    } else if let Some(m) = message.audio_message.as_option() {
        m
    } else if let Some(m) = message.document_message.as_option() {
        m
    } else if let Some(m) = message.sticker_message.as_option() {
        m
    } else {
        return Err("unsupported media".into());
    };
    let bytes = client
        .download(downloadable)
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    Ok(Response::new(bytes))
}

/// Header values are ASCII; the frontend percent-encodes file names and captions.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Sends a file. The body is the raw file; headers name the account (`x-account`), chat
/// (`x-chat`), mimetype (`x-mime`), and percent-encoded file name and caption (`x-name`,
/// `x-caption`). Returns the sent message so the frontend can cache the bytes under it.
#[tauri::command]
pub async fn wa_native_send_media(
    app: AppHandle,
    state: State<'_, WaState>,
    request: Request<'_>,
) -> Result<MessageView, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(percent_decode)
    };
    let id = header("x-account").ok_or("missing x-account")?;
    let chat_id = header("x-chat").ok_or("missing x-chat")?;
    let mimetype = header("x-mime").unwrap_or_else(|| "application/octet-stream".into());
    let file_name = header("x-name").filter(|n| !n.is_empty());
    let caption = header("x-caption").filter(|c| !c.trim().is_empty());
    let data = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err("expected raw body".into()),
    };

    let account = state.get(&id)?;
    let (client, generation, sender_name) = {
        let inner = account.inner.lock().unwrap();
        let client = inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?;
        let sender_name = inner
            .me
            .as_ref()
            .map(|me| me.push_name.clone())
            .unwrap_or_default();
        (client, inner.generation, sender_name)
    };
    let to: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;

    let media_type = if mimetype.starts_with("image/") && mimetype != "image/gif" {
        MediaType::Image
    } else if mimetype.starts_with("video/") {
        MediaType::Video
    } else if mimetype.starts_with("audio/") {
        MediaType::Audio
    } else {
        MediaType::Document
    };
    let upload = client
        .upload(data, media_type, whatsapp_rust::UploadOptions::new())
        .await
        .map_err(|e| format!("upload failed: {e}"))?;
    let message = match media_type {
        MediaType::Image => whatsapp_rust::media::image_message(
            upload,
            whatsapp_rust::media::ImageOptions {
                caption: caption.clone(),
                mimetype: Some(mimetype.clone()),
                ..Default::default()
            },
        ),
        MediaType::Video => whatsapp_rust::media::video_message(
            upload,
            whatsapp_rust::media::VideoOptions {
                caption: caption.clone(),
                mimetype: Some(mimetype.clone()),
                ..Default::default()
            },
        ),
        MediaType::Audio => whatsapp_rust::media::audio_message(
            upload,
            whatsapp_rust::media::AudioOptions {
                mimetype: Some(mimetype.clone()),
                ..Default::default()
            },
        ),
        _ => whatsapp_rust::media::document_message(
            upload,
            whatsapp_rust::media::DocumentOptions {
                mimetype: Some(mimetype.clone()),
                file_name: file_name.clone(),
                title: file_name.clone(),
                caption: caption.clone(),
                ..Default::default()
            },
        ),
    };
    let media = extract_media(&message);
    let sent = client
        .send_message(to, message)
        .await
        .map_err(|e| e.to_string())?;
    let body = caption.unwrap_or_default();
    let message = IncomingMessage {
        view: MessageView {
            id: sent.message_id,
            chat_id,
            from_me: true,
            sender_name,
            sender_phone: None,
            kind: MessageKind::Media,
            body,
            timestamp: now_millis(),
            media: None,
        },
        sender_id: String::new(),
        media,
    };
    let mut view = message.view.clone();
    view.media = message.media.as_ref().map(StoredMedia::info);
    record_message(&app, &account, generation, message);
    Ok(view)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactDetails {
    pub id: String,
    pub name: Option<String>,
    pub saved: bool,
    pub phone: Option<String>,
    /// Their "About" text, unless their privacy settings hide it.
    pub about: Option<String>,
    pub business: bool,
    pub verified_name: Option<String>,
    /// Full-size profile picture URL.
    pub picture: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    pub id: String,
    pub name: Option<String>,
    pub saved: bool,
    pub phone: Option<String>,
    pub admin: bool,
    pub super_admin: bool,
    pub is_me: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetails {
    pub id: String,
    pub subject: String,
    pub description: Option<String>,
    /// Unix milliseconds.
    pub created_at: Option<i64>,
    pub creator: Option<GroupMember>,
    /// Only admins can send messages.
    pub announce: bool,
    /// Only admins can edit the group info.
    pub locked: bool,
    /// New members need an admin's approval.
    pub approval: bool,
    pub members: Vec<GroupMember>,
    pub picture: Option<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatDetails {
    Contact(ContactDetails),
    Group(GroupDetails),
}

/// Full-size profile picture; `None` when there is none or it is hidden.
async fn full_picture(client: &Client, jid: &Jid) -> Option<String> {
    client
        .contacts()
        .get_profile_picture(jid, false)
        .await
        .ok()
        .flatten()
        .map(|p| p.url)
}

/// Contact or group details for the info panel, fetched live from the server and named
/// from this account's contacts.
#[tauri::command]
pub async fn wa_native_chat_info(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<ChatDetails, String> {
    let account = state.get(&id)?;
    let (client, me) = {
        let inner = account.inner.lock().unwrap();
        let client = inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?;
        (client, inner.me.as_ref().map(|me| bare_jid(&me.id)))
    };
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;

    if chat_id.ends_with("@g.us") {
        let meta = client
            .groups()
            .get_metadata(&jid)
            .await
            .map_err(|e| e.to_string())?;
        // Participant lists carry both ids of each member; keep the mapping for names.
        {
            let db = account.db.lock().unwrap();
            for p in &meta.participants {
                if let (Some(pn), Some(lid)) = (&p.phone_number, &p.lid) {
                    let _ = db.set_lid_pn(&bare_jid(&lid.to_string()), &bare_jid(&pn.to_string()));
                }
            }
            let _ = db.set_name(&chat_id, &meta.subject, NameSource::GroupSubject);
        }
        let member = |id: String, admin: bool, super_admin: bool| -> GroupMember {
            let db = account.db.lock().unwrap();
            let who = db.who(&id).ok();
            let pn = db.pn_for(&id).ok().flatten();
            GroupMember {
                is_me: me.is_some() && (me.as_deref() == Some(id.as_str()) || me == pn),
                name: who.as_ref().and_then(|w| w.name.clone()),
                saved: who.as_ref().is_some_and(|w| w.saved),
                phone: who.and_then(|w| w.phone),
                id,
                admin,
                super_admin,
            }
        };
        let mut members: Vec<GroupMember> = meta
            .participants
            .iter()
            .map(|p| {
                member(
                    bare_jid(&p.jid.to_string()),
                    p.is_admin(),
                    p.is_super_admin(),
                )
            })
            .collect();
        // You first, then admins, then everyone by name — the order WhatsApp uses.
        members.sort_by(|a, b| {
            b.is_me
                .cmp(&a.is_me)
                .then(b.admin.cmp(&a.admin))
                .then(b.saved.cmp(&a.saved))
                .then(
                    a.name
                        .as_deref()
                        .unwrap_or("~")
                        .to_lowercase()
                        .cmp(&b.name.as_deref().unwrap_or("~").to_lowercase()),
                )
        });
        let creator = meta
            .creator
            .as_ref()
            .map(|c| member(bare_jid(&c.to_string()), false, false));
        emit_chats(&app, &account);
        return Ok(ChatDetails::Group(GroupDetails {
            id: chat_id,
            subject: meta.subject,
            description: meta.description.filter(|d| !d.trim().is_empty()),
            created_at: meta.creation_time.map(|t| t as i64 * 1000),
            creator,
            announce: meta.is_announcement,
            locked: meta.is_locked,
            approval: meta.membership_approval,
            members,
            picture: full_picture(&client, &jid).await,
        }));
    }

    let (who, pn) = {
        let db = account.db.lock().unwrap();
        (
            db.who(&chat_id).map_err(|e| e.to_string())?,
            db.pn_for(&chat_id).map_err(|e| e.to_string())?,
        )
    };
    // Profile queries answer for phone-number ids most reliably.
    let query_jid: Jid = pn
        .as_deref()
        .and_then(|pn| pn.parse().ok())
        .unwrap_or_else(|| jid.clone());
    let info = client
        .contacts()
        .get_user_info(std::slice::from_ref(&query_jid))
        .await
        .ok()
        .and_then(|mut found| {
            found
                .remove(&query_jid)
                .or_else(|| found.into_values().next())
        });
    Ok(ChatDetails::Contact(ContactDetails {
        id: chat_id,
        name: who.name,
        saved: who.saved,
        phone: who.phone,
        about: info
            .as_ref()
            .and_then(|i| i.status.clone())
            .filter(|s| !s.trim().is_empty()),
        business: info.as_ref().is_some_and(|i| i.is_business),
        verified_name: info
            .as_ref()
            .and_then(|i| i.verified_name.as_ref())
            .and_then(|v| v.name.clone()),
        picture: full_picture(&client, &query_jid).await,
    }))
}

/// The newest attachments of a chat, for the "Media, links and docs" view.
#[tauri::command]
pub fn wa_native_chat_media(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<Vec<MessageView>, String> {
    let account = state.get(&id)?;
    let media = account.db.lock().unwrap().media_messages(&chat_id, 300);
    media.map_err(|e| e.to_string())
}

/// A change to a group, as sent by the info panel.
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GroupAction {
    SetSubject {
        subject: String,
    },
    SetDescription {
        description: String,
    },
    /// Only admins can send messages.
    SetAnnounce {
        on: bool,
    },
    /// Only admins can edit the group info.
    SetLocked {
        on: bool,
    },
    /// New members need an admin's approval.
    SetApproval {
        on: bool,
    },
    /// JPEG bytes, base64; the frontend crops and encodes it.
    SetPicture {
        jpeg: String,
    },
    RemovePicture,
    /// Phone numbers, any formatting.
    Add {
        phones: Vec<String>,
    },
    Remove {
        members: Vec<String>,
    },
    Promote {
        members: Vec<String>,
    },
    Demote {
        members: Vec<String>,
    },
    Approve {
        members: Vec<String>,
    },
    Reject {
        members: Vec<String>,
    },
    InviteLink {
        reset: bool,
    },
    Leave,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupActionResult {
    pub invite_link: Option<String>,
    /// People the change did not apply to, with the server's reason.
    pub failed: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequest {
    pub id: String,
    pub name: Option<String>,
    /// Whether `name` is from your contacts.
    pub saved: bool,
    pub phone: Option<String>,
    /// Unix milliseconds.
    pub requested_at: Option<i64>,
}

fn parse_jids(ids: &[String]) -> Result<Vec<Jid>, String> {
    ids.iter()
        .map(|id| id.parse().map_err(|_| format!("invalid member id: {id}")))
        .collect()
}

/// Why a participant change did not go through, in words, or `None` when it did.
fn participant_failure(r: &ParticipantChangeResponse) -> Option<String> {
    let status = r.status.as_deref().unwrap_or("200");
    if status == "200" && r.error.is_none() {
        return None;
    }
    let reason = match status {
        "403" => "their privacy settings don't allow it; send them an invite link instead",
        "408" => "they recently left the group",
        "409" => "already in the group",
        "404" => "not on WhatsApp",
        "401" => "you are not an admin",
        _ => r.error.as_deref().unwrap_or(status),
    };
    let who = r
        .phone_number
        .as_ref()
        .map(|pn| format!("+{}", pn.user))
        .unwrap_or_else(|| r.jid.user.to_string());
    Some(format!("{who}: {reason}"))
}

fn failures(responses: &[ParticipantChangeResponse]) -> Vec<String> {
    responses.iter().filter_map(participant_failure).collect()
}

/// Applies a change to a group. Errors come back as text for the panel to show.
#[tauri::command]
pub async fn wa_native_group_action(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    action: GroupAction,
) -> Result<GroupActionResult, String> {
    use whatsapp_rust::features::{
        GroupDescription, GroupSubject, MembershipApprovalMode, PreviousDescription,
    };

    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let groups = client.groups();
    let err = |e: whatsapp_rust::features::GroupError| e.to_string();
    let mut result = GroupActionResult::default();
    match action {
        GroupAction::SetSubject { subject } => {
            let subject = GroupSubject::new(subject.trim()).map_err(|e| e.to_string())?;
            groups.set_subject(jid, subject).await.map_err(err)?;
        }
        GroupAction::SetDescription { description } => {
            let description = description.trim();
            let description = if description.is_empty() {
                None
            } else {
                Some(GroupDescription::new(description).map_err(|e| e.to_string())?)
            };
            groups
                .set_description(jid, description, PreviousDescription::Resolve)
                .await
                .map_err(err)?;
        }
        GroupAction::SetAnnounce { on } => groups.set_announce(jid, on).await.map_err(err)?,
        GroupAction::SetLocked { on } => groups.set_locked(jid, on).await.map_err(err)?,
        GroupAction::SetApproval { on } => {
            let mode = if on {
                MembershipApprovalMode::On
            } else {
                MembershipApprovalMode::Off
            };
            groups
                .set_membership_approval(jid, mode)
                .await
                .map_err(err)?;
        }
        GroupAction::SetPicture { jpeg } => {
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(jpeg)
                .map_err(|e| e.to_string())?;
            groups.set_profile_picture(jid, bytes).await.map_err(err)?;
        }
        GroupAction::RemovePicture => {
            groups.remove_profile_picture(jid).await.map_err(err)?;
        }
        GroupAction::Add { phones } => {
            let jids: Vec<Jid> = phones
                .iter()
                .map(|p| p.chars().filter(|c| c.is_ascii_digit()).collect::<String>())
                .filter(|digits| digits.len() >= 8)
                .filter_map(|digits| format!("{digits}@s.whatsapp.net").parse().ok())
                .collect();
            if jids.is_empty() {
                return Err("enter a phone number with country code".into());
            }
            result.failed = failures(&groups.add_participants(jid, &jids).await.map_err(err)?);
        }
        GroupAction::Remove { members } => {
            let jids = parse_jids(&members)?;
            result.failed = failures(&groups.remove_participants(jid, &jids).await.map_err(err)?);
        }
        GroupAction::Promote { members } => {
            let jids = parse_jids(&members)?;
            result.failed = failures(&groups.promote_participants(jid, &jids).await.map_err(err)?);
        }
        GroupAction::Demote { members } => {
            let jids = parse_jids(&members)?;
            result.failed = failures(&groups.demote_participants(jid, &jids).await.map_err(err)?);
        }
        GroupAction::Approve { members } => {
            let jids = parse_jids(&members)?;
            result.failed = failures(
                &groups
                    .approve_membership_requests(jid, &jids)
                    .await
                    .map_err(err)?,
            );
        }
        GroupAction::Reject { members } => {
            let jids = parse_jids(&members)?;
            result.failed = failures(
                &groups
                    .reject_membership_requests(jid, &jids)
                    .await
                    .map_err(err)?,
            );
        }
        GroupAction::InviteLink { reset } => {
            result.invite_link = Some(groups.get_invite_link(jid, reset).await.map_err(err)?);
        }
        GroupAction::Leave => groups.leave(jid).await.map_err(err)?,
    }
    emit_chats(&app, &account);
    Ok(result)
}

/// People waiting for an admin to let them into a group.
#[tauri::command]
pub async fn wa_native_group_requests(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<Vec<JoinRequest>, String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let requests = client
        .groups()
        .get_membership_requests(jid)
        .await
        .map_err(|e| e.to_string())?;

    // Requests arrive as privacy ids, which alone carry neither a phone number nor a
    // name. Resolve the ones not mapped yet to phone-number ids in one batch so the panel
    // can show who is asking; the mapping is remembered, so later calls skip the lookup.
    let unmapped: Vec<Jid> = {
        let db = account.db.lock().unwrap();
        requests
            .iter()
            .filter(|r| {
                let id = bare_jid(&r.jid.to_string());
                id.ends_with("@lid") && db.pn_for(&id).ok().flatten().is_none()
            })
            .map(|r| r.jid.to_non_ad())
            .collect()
    };
    if !unmapped.is_empty() {
        if let Ok(found) = client.contacts().is_on_whatsapp(&unmapped).await {
            let db = account.db.lock().unwrap();
            for r in &found {
                if let Some(pn) = &r.pn_jid {
                    let _ = db.set_lid_pn(&bare_jid(&r.jid.to_string()), &bare_jid(&pn.to_string()));
                }
            }
        }
    }

    let db = account.db.lock().unwrap();
    Ok(requests
        .into_iter()
        .map(|r| {
            let id = bare_jid(&r.jid.to_string());
            let who = db.who(&id).ok();
            JoinRequest {
                name: who.as_ref().and_then(|w| w.name.clone()),
                saved: who.as_ref().is_some_and(|w| w.saved),
                phone: who.and_then(|w| w.phone),
                requested_at: r.request_time.map(|t| t as i64 * 1000),
                id,
            }
        })
        .collect())
}

// ── Status (stories) ─────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusView {
    /// The poster's bare id (empty for your own status).
    pub sender: String,
    #[serde(flatten)]
    pub message: MessageView,
}

/// The newest statuses, newest first; the screen keeps the last 24 hours.
#[tauri::command]
pub fn wa_native_statuses(state: State<'_, WaState>, id: String) -> Result<Vec<StatusView>, String> {
    let account = state.get(&id)?;
    let list = account
        .db
        .lock()
        .unwrap()
        .statuses(500)
        .map_err(|e| e.to_string())?;
    Ok(list
        .into_iter()
        .map(|(sender, message)| StatusView { sender, message })
        .collect())
}

/// Tells WhatsApp a status was viewed (the poster sees you in "viewed by").
#[tauri::command]
pub async fn wa_native_status_viewed(
    state: State<'_, WaState>,
    id: String,
    sender: String,
    message_id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let sender: Jid = sender
        .parse()
        .map_err(|_| format!("invalid sender: {sender}"))?;
    client
        .mark_as_read(
            &Jid::status_broadcast(),
            Some(&sender),
            &[message_id.as_str()],
        )
        .await
        .map_err(|e| e.to_string())
}

/// Everyone a status is posted to: the saved contacts (phone-number ids).
fn status_audience(account: &WaAccount) -> Result<Vec<Jid>, String> {
    let me = account
        .inner
        .lock()
        .unwrap()
        .me
        .as_ref()
        .map(|me| bare_jid(&me.id));
    let pns = account
        .db
        .lock()
        .unwrap()
        .status_recipients(me.as_deref())
        .map_err(|e| e.to_string())?;
    let jids: Vec<Jid> = pns.iter().filter_map(|p| p.parse::<Jid>().ok()).collect();
    if jids.is_empty() {
        return Err("no saved contacts to send the status to".into());
    }
    Ok(jids)
}

/// Posts a text status to every saved contact. `background_argb` is 0xAARRGGBB.
#[tauri::command]
pub async fn wa_native_post_status_text(
    state: State<'_, WaState>,
    id: String,
    text: String,
    background_argb: u32,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("status text is empty".into());
    }
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let recipients = status_audience(&account)?;
    client
        .status()
        .send_text(
            text,
            background_argb,
            wa::message::extended_text_message::FontType::SYSTEM,
            &recipients,
            Default::default(),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Posts a photo or video status to every saved contact. Raw body, with the same headers as
/// `wa_native_send_media` plus an optional base64 JPEG thumbnail (`x-thumb`).
#[tauri::command]
pub async fn wa_native_post_status_media(
    state: State<'_, WaState>,
    request: Request<'_>,
) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(percent_decode)
    };
    let id = header("x-account").ok_or("missing x-account")?;
    let mimetype = header("x-mime").unwrap_or_else(|| "application/octet-stream".into());
    let caption = header("x-caption").filter(|c| !c.trim().is_empty());
    let thumbnail = header("x-thumb").and_then(|t| {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.decode(t).ok()
    });
    let data = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err("expected raw body".into()),
    };

    let media_type = if mimetype.starts_with("image/") && mimetype != "image/gif" {
        MediaType::Image
    } else if mimetype.starts_with("video/") {
        MediaType::Video
    } else {
        return Err("a status can only be a photo or a video".into());
    };
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let recipients = status_audience(&account)?;
    let upload = client
        .upload(data, media_type, whatsapp_rust::UploadOptions::new())
        .await
        .map_err(|e| format!("upload failed: {e}"))?;
    let message = match media_type {
        MediaType::Image => whatsapp_rust::media::image_message(
            upload,
            whatsapp_rust::media::ImageOptions {
                caption,
                mimetype: Some(mimetype),
                jpeg_thumbnail: thumbnail,
                ..Default::default()
            },
        ),
        _ => whatsapp_rust::media::video_message(
            upload,
            whatsapp_rust::media::VideoOptions {
                caption,
                mimetype: Some(mimetype),
                jpeg_thumbnail: thumbnail,
                ..Default::default()
            },
        ),
    };
    client
        .status()
        .send_raw(message, &recipients, Default::default())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes one of my statuses (for everyone), and the local copy.
#[tauri::command]
pub async fn wa_native_delete_status(
    state: State<'_, WaState>,
    id: String,
    message_id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let recipients = status_audience(&account)?;
    client
        .status()
        .revoke(message_id.clone(), &recipients, Default::default())
        .await
        .map_err(|e| e.to_string())?;
    let _ = account
        .db
        .lock()
        .unwrap()
        .delete_message("status@broadcast", &message_id);
    Ok(())
}
