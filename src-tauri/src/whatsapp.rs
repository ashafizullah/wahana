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

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use whatsapp_rust::download::{Downloadable, MediaType};
use whatsapp_rust::features::{
    NewsletterMetadata, NewsletterRole, NewsletterVerification, ParticipantChangeResponse,
};
use whatsapp_rust::prelude::*;
use whatsapp_rust::send::{PinDuration, RevokeType};
use whatsapp_rust::sync_task::MajorSyncTask;
use whatsapp_rust::types::events::{Event, EventKind};
use whatsapp_rust::wacore::appstate::patch_decode::WAPatchName;
use whatsapp_rust::waproto::buffa::{self, Message as _};
use whatsapp_rust::waproto::whatsapp as wa;
use whatsapp_rust_sqlite_storage::SqliteStore;

use crate::whatsapp_db::{
    preview, ChatDb, IncomingMessage, MessageTarget, NameSource, QuoteRef, StoredMedia,
};

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
    /// Delivery state of my newest message in the chat (see `MessageView::ack`).
    pub last_ack: u8,
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
    /// Delivery state of a message I sent: 0 pending, 1 sent, 2 delivered, 3 read, 4 played.
    pub ack: u8,
    /// When it was deleted for everyone (unix ms). The content is kept to show what it was.
    pub revoked_at: Option<i64>,
    /// When it was last edited (unix ms).
    pub edited_at: Option<i64>,
    /// Earlier texts of an edited message, oldest first.
    pub edits: Vec<EditView>,
    /// Reaction totals on a channel message (the server reports counts, not who reacted).
    pub channel_reactions: Vec<ChannelReaction>,
    /// The message this one replies to.
    pub reply_to: Option<ReplyView>,
    /// The album this photo or video was sent in, shared by all its members.
    pub album_id: Option<String>,
}

/// A quoted message as shown above a reply.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyView {
    pub id: String,
    pub from_me: bool,
    pub sender_name: String,
    /// Its text, or a label for its attachment.
    pub text: String,
}

/// How many times one emoji was used on a channel message.
#[derive(Clone, Serialize)]
pub struct ChannelReaction {
    pub emoji: String,
    pub count: u64,
}

/// One earlier text of an edited message.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditView {
    pub body: String,
    /// When this text was replaced (unix ms).
    pub replaced_at: i64,
}

/// `MessageView::ack` values.
const ACK_SENT: u8 = 1;
const ACK_DELIVERED: u8 = 2;
const ACK_READ: u8 = 3;
const ACK_PLAYED: u8 = 4;

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

/// Emitted with just an account id when that account's non-chat data changed (statuses, labels).
#[derive(Clone, Serialize)]
struct IdPayload {
    id: String,
}

/// An incoming reaction, so the bubble can show who reacted with what.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReactionPayload {
    id: String,
    message_id: String,
    from: String,
    from_me: bool,
    participant: Option<String>,
    text: String,
}

/// A message deleted for everyone, so the chat can draw the "deleted" tombstone in place.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RevokedPayload {
    id: String,
    chat_id: String,
    message_id: String,
    from_me: bool,
    participant: Option<String>,
    timestamp: i64,
}

/// A message pinned or unpinned for everyone (from any device), so the chat can mark it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PinPayload {
    id: String,
    chat_id: String,
    message_id: String,
    on: bool,
    /// When the pin lapses (unix ms); 0 when unpinned.
    expires: i64,
}

/// Someone started or stopped typing (or recording) in a chat. `chat_ids` holds the chat
/// under both its phone-number and privacy id, since the open chat may run on either.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TypingPayload {
    id: String,
    chat_ids: Vec<String>,
    sender: String,
    /// Best known name (or phone number) of the sender, for "Budi is typing" in a group.
    sender_name: Option<String>,
    /// "typing", "recording" or "paused".
    state: &'static str,
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
    /// Open chats watching for typing. The account stays online while any is open, so a
    /// chat switch (old chat off, new chat on, in either order) never leaves it offline.
    typing_watchers: usize,
    syncing: Option<u32>,
    /// Profile picture URLs by chat id; `None` once looked up and found to have none.
    pictures: HashMap<String, Option<String>>,
    /// Channel ids whose metadata was already asked for this run, so a failed lookup is not
    /// retried on every chat poll. Reset when `channels_gen` falls behind `generation`.
    channels_probed: HashSet<String>,
    channels_gen: u64,
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

/// The bare JID that authored a stored message: our own id for our messages, otherwise
/// the recorded sender (or the chat itself for a direct message).
fn message_author(account: &WaAccount, chat_id: &str, target: &MessageTarget) -> String {
    if target.from_me {
        let me = account
            .inner
            .lock()
            .unwrap()
            .me
            .as_ref()
            .map(|me| me.id.clone())
            .unwrap_or_default();
        return bare_jid(&me);
    }
    if target.sender_id.is_empty() {
        return chat_id.to_string();
    }
    bare_jid(&target.sender_id)
}

/// The referential key of a stored message, for reactions and pins. Groups and status need
/// `participant` to attribute the action to the original sender.
fn target_key(
    account: &WaAccount,
    chat_id: &str,
    message_id: &str,
    target: &MessageTarget,
) -> wa::MessageKey {
    let participant = if chat_id.ends_with("@g.us") || chat_id == "status@broadcast" {
        Some(message_author(account, chat_id, target))
    } else {
        None
    };
    wa::MessageKey {
        remote_jid: Some(chat_id.to_string()),
        from_me: Some(target.from_me),
        id: Some(message_id.to_string()),
        participant,
    }
}

/// The message body (or, for media, the encoded media message) of a stored message, for
/// quoting and forwarding.
fn stored_message(target: &MessageTarget) -> Result<wa::Message, String> {
    match &target.media_proto {
        Some(bytes) => {
            let mut slice = bytes.as_slice();
            wa::Message::decode(&mut slice).map_err(|e| e.to_string())
        }
        None => Ok(wa::Message::text(target.body.clone())),
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
    // An album member can arrive wrapped; the wrapper holds the photo or video itself.
    if let Some(child) = message
        .associated_child_message
        .as_option()
        .and_then(|f| f.message.as_option())
    {
        return message_content(child);
    }
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
        || base.album_message.is_set()
    {
        return None;
    }
    Some((MessageKind::Unsupported, String::new(), None))
}

/// The album a photo or video was sent in: the id of its album message, which every member
/// names as its parent.
fn album_of(message: &wa::Message) -> Option<String> {
    let association = message
        .message_context_info
        .as_option()
        .or_else(|| message.get_base_message().message_context_info.as_option())
        .and_then(|c| c.message_association.as_option())?;
    if association.association_type != Some(wa::message_association::AssociationType::MEDIA_ALBUM) {
        return None;
    }
    association
        .parent_message_key
        .as_option()
        .and_then(|k| k.id.clone())
}

/// The message a reply quotes, from the reply context any message type may carry.
fn quote_of(message: &wa::Message) -> Option<QuoteRef> {
    let base = message.get_base_message();
    let context = base
        .extended_text_message
        .as_option()
        .and_then(|m| m.context_info.as_option())
        .or_else(|| {
            base.image_message
                .as_option()
                .and_then(|m| m.context_info.as_option())
        })
        .or_else(|| {
            base.video_message
                .as_option()
                .and_then(|m| m.context_info.as_option())
        })
        .or_else(|| {
            base.audio_message
                .as_option()
                .and_then(|m| m.context_info.as_option())
        })
        .or_else(|| {
            base.document_message
                .as_option()
                .and_then(|m| m.context_info.as_option())
        })
        .or_else(|| {
            base.sticker_message
                .as_option()
                .and_then(|m| m.context_info.as_option())
        })?;
    let id = context.stanza_id.clone().filter(|id| !id.is_empty())?;
    let text = context
        .quoted_message
        .as_option()
        .and_then(message_content)
        .map(|(kind, body, media)| preview(kind, &body, media.as_ref().map(|m| m.kind)))
        .unwrap_or_default();
    Some(QuoteRef {
        id,
        sender: context
            .participant
            .as_deref()
            .map(bare_jid)
            .unwrap_or_default(),
        text,
    })
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
            IdPayload {
                id: account.id.clone(),
            },
        );
        emit_account(app, account);
        return;
    }
    let mut view = message.view;
    view.media = message.media.as_ref().map(StoredMedia::info);
    view.album_id = message.album.clone();
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

/// Names channel (newsletter) chats from the list of channels this account follows; the
/// server only sends their names on request, so this runs on every connect.
async fn load_channel_names(
    app: &AppHandle,
    account: &WaAccount,
    generation: u64,
    client: &Client,
) {
    let channels = match crate::channel_mex::subscribed(client).await {
        Ok(channels) => channels,
        Err(e) => {
            eprintln!("failed to list WhatsApp channels: {e}");
            return;
        }
    };
    if !account.is_current(generation) {
        return;
    }
    let result = account.db.lock().unwrap().batch(|db| {
        for meta in &channels {
            db.set_name(
                &bare_jid(&meta.jid.to_string()),
                &meta.name,
                NameSource::GroupSubject,
            )?;
        }
        Ok(())
    });
    if let Err(e) = result {
        eprintln!("failed to store WhatsApp channel names: {e}");
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

/// A history message's delivery state, as the phone last knew it.
fn history_ack(info: &wa::WebMessageInfo) -> u8 {
    use wa::web_message_info::Status;
    match info.status {
        Some(Status::DeliveryAck) => ACK_DELIVERED,
        Some(Status::Read) => ACK_READ,
        Some(Status::Played) => ACK_PLAYED,
        Some(Status::Error) | Some(Status::Pending) => 0,
        _ => ACK_SENT,
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
            ack: history_ack(info),
            revoked_at: None,
            edited_at: None,
            edits: Vec::new(),
            channel_reactions: Vec::new(),
            reply_to: None,
            album_id: None,
        },
        sender_id,
        media,
        quote: info.message.as_option().and_then(quote_of),
        album: info.message.as_option().and_then(album_of),
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
        // Delivery and read receipts for messages I sent. Receipts from my own other
        // devices (`is_from_me`) say nothing about the recipient. In a group, the first
        // participant to receive or read a message moves it on.
        Event::Receipt(receipt) => {
            use whatsapp_rust::types::presence::ReceiptType;
            if receipt.source.is_from_me {
                return;
            }
            let ack = match receipt.r#type {
                ReceiptType::Delivered => ACK_DELIVERED,
                ReceiptType::Read => ACK_READ,
                ReceiptType::Played => ACK_PLAYED,
                _ => return,
            };
            let ids: Vec<String> = receipt
                .message_ids
                .iter()
                .map(|id| id.to_string())
                .collect();
            let sender = bare_jid(&receipt.source.sender.to_string());
            let at = receipt.timestamp.timestamp_millis();
            let changed = {
                let db = account.db.lock().unwrap();
                let _ = db.add_receipts(&ids, &sender, ack, at);
                db.raise_ack(&ids, ack).unwrap_or(false)
            };
            if changed {
                emit_chats(&app, &account);
            }
        }
        Event::ChatPresence(update) => {
            use whatsapp_rust::types::presence::{ChatPresence, ChatPresenceMedia};
            if update.source.is_from_me {
                return;
            }
            let state = match (update.state, update.media) {
                (ChatPresence::Paused, _) => "paused",
                (ChatPresence::Composing, ChatPresenceMedia::Audio) => "recording",
                (ChatPresence::Composing, ChatPresenceMedia::Text) => "typing",
            };
            let chat = bare_jid(&update.source.chat.to_string());
            let sender = bare_jid(&update.source.sender.to_string());
            let mut chat_ids = vec![chat.clone()];
            let db = account.db.lock().unwrap();
            if !update.source.is_group {
                let alt = if chat.ends_with("@lid") {
                    db.pn_for(&chat)
                } else {
                    db.lid_for(&chat)
                };
                chat_ids.extend(alt.ok().flatten().filter(|a| *a != chat));
            }
            let sender_name = db.who(&sender).ok().and_then(|w| w.name.or(w.phone));
            drop(db);
            let _ = app.emit_to(
                "main",
                "wa_native:typing",
                TypingPayload {
                    id: account.id.clone(),
                    chat_ids,
                    sender,
                    sender_name,
                    state,
                },
            );
        }
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
        Event::LabelEditUpdate(update) => {
            let action = &update.action;
            if action.deleted.unwrap_or(false) {
                let _ = account.db.lock().unwrap().delete_label(&update.label_id);
            } else if let Some(name) = action.name.as_deref().filter(|n| !n.is_empty()) {
                let color = action.color.unwrap_or(0) as i64;
                let _ =
                    account
                        .db
                        .lock()
                        .unwrap()
                        .upsert_label(&update.label_id, name, color, false);
            }
            emit_labels(&app, &account);
        }
        Event::LabelAssociationUpdate(update) => {
            let labeled = update.action.labeled.unwrap_or(false);
            let _ = account.db.lock().unwrap().set_chat_label(
                &update.label_id,
                &bare_jid(&update.chat_jid.to_string()),
                labeled,
            );
            emit_labels(&app, &account);
        }
        _ => {}
    }
}

/// Tells the frontend an account's labels changed, so the screens refetch them.
fn emit_labels(app: &AppHandle, account: &WaAccount) {
    let _ = app.emit_to(
        "main",
        "wa_native:labels",
        IdPayload {
            id: account.id.clone(),
        },
    );
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
                load_channel_names(&app, &account, generation, &client).await;
                // Labels live in the "regular" app-state collection; a full sync populates
                // them for accounts whose state predates the local label cache.
                let _ = client
                    .clone()
                    .process_sync_task(MajorSyncTask::AppStateSync {
                        name: WAPatchName::Regular,
                        full_sync: true,
                    })
                    .await;
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
            let source = &ctx.info.source;
            let chat_id = source.chat.to_string();
            let is_group = source.is_group || chat_id.ends_with("@g.us");
            let base = ctx.message.get_base_message();

            // A reaction rides the message channel but is not a message of its own.
            if let Some(rm) = base.reaction_message.as_option() {
                if let Some(target_id) = rm.key.as_option().and_then(|k| k.id.clone()) {
                    let from_me = source.is_from_me;
                    let participant = (is_group || chat_id == "status@broadcast")
                        .then(|| source.sender.to_string());
                    let _ = app.emit_to(
                        "main",
                        "wa_native:reaction",
                        ReactionPayload {
                            id: account.id.clone(),
                            message_id: target_id,
                            from: if from_me {
                                String::new()
                            } else {
                                bare_jid(&source.sender.to_string())
                            },
                            from_me,
                            participant,
                            text: rm.text.clone().unwrap_or_default(),
                        },
                    );
                }
                return;
            }

            // A pin or unpin for everyone, from another member or our own phone.
            if let Some(pin) = base.pin_in_chat_message.as_option() {
                if let Some(target_id) = pin.key.as_option().and_then(|k| k.id.clone()) {
                    let on = pin.r#type == Some(wa::message::pin_in_chat_message::Type::PinForAll);
                    let secs = base
                        .message_context_info
                        .as_option()
                        .and_then(|c| c.message_add_on_duration_in_secs)
                        .filter(|s| *s > 0)
                        .unwrap_or(7 * 24 * 3600);
                    let at = pin
                        .sender_timestamp_ms
                        .unwrap_or_else(|| ctx.info.timestamp.timestamp_millis());
                    let _ = app.emit_to(
                        "main",
                        "wa_native:pin",
                        PinPayload {
                            id: account.id.clone(),
                            chat_id: chat_id.clone(),
                            message_id: target_id,
                            on,
                            expires: if on { at + i64::from(secs) * 1000 } else { 0 },
                        },
                    );
                }
                return;
            }

            // Revokes and edits arrive as protocol messages.
            if let Some(pm) = base.protocol_message.as_option() {
                if pm.r#type == Some(wa::message::protocol_message::Type::Revoke) {
                    if let Some(target_id) = pm.key.as_option().and_then(|k| k.id.clone()) {
                        let stored = account
                            .db
                            .lock()
                            .unwrap()
                            .revoke_message(
                                &chat_id,
                                &target_id,
                                ctx.info.timestamp.timestamp_millis(),
                            )
                            .unwrap_or(None);
                        if stored.is_some() {
                            emit_chats(&app, &account);
                        }
                        let from_me = source.is_from_me;
                        let participant = (is_group || chat_id == "status@broadcast")
                            .then(|| source.sender.to_string());
                        let _ = app.emit_to(
                            "main",
                            "wa_native:revoked",
                            RevokedPayload {
                                id: account.id.clone(),
                                chat_id: chat_id.clone(),
                                message_id: target_id,
                                from_me,
                                participant,
                                timestamp: ctx.info.timestamp.timestamp_millis(),
                            },
                        );
                    }
                    return;
                }
                if let Some(edited) = pm.edited_message.as_option() {
                    if let Some(target_id) = pm.key.as_option().and_then(|k| k.id.clone()) {
                        let body = edited.text_content().unwrap_or_default().to_string();
                        let updated = account
                            .db
                            .lock()
                            .unwrap()
                            .edit_message(
                                &chat_id,
                                &target_id,
                                &body,
                                ctx.info.timestamp.timestamp_millis(),
                            )
                            .unwrap_or(None);
                        if updated.is_some() {
                            emit_chats(&app, &account);
                        }
                    }
                    return;
                }
            }

            let Some((kind, body, media)) = message_content(&ctx.message) else {
                return;
            };
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
                    ack: ACK_SENT,
                    revoked_at: None,
                    edited_at: None,
                    edits: Vec::new(),
                    channel_reactions: Vec::new(),
                    reply_to: None,
                    album_id: None,
                },
                sender_id: if from_me { String::new() } else { sender },
                media,
                quote: quote_of(&ctx.message),
                album: album_of(&ctx.message),
            };
            let channel_ref = (message.view.chat_id.ends_with("@newsletter")
                && ctx.info.server_id > 0)
                .then(|| (message.view.chat_id.clone(), message.view.id.clone()));
            record_message(&app, &account, generation, message);
            if let Some((chat, id)) = channel_ref {
                let _ =
                    account
                        .db
                        .lock()
                        .unwrap()
                        .set_server_id(&chat, &id, ctx.info.server_id as i64);
            }
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
                EventKind::Receipt,
                EventKind::HistorySync,
                EventKind::ContactUpdate,
                EventKind::PushNameUpdate,
                EventKind::LabelEditUpdate,
                EventKind::LabelAssociationUpdate,
                EventKind::ChatPresence,
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

/// The reply context quoting stored message `quote_id` of `chat_id`.
fn quote_context(
    account: &WaAccount,
    chat_id: &str,
    to: &Jid,
    quote_id: &str,
) -> Result<wa::ContextInfo, String> {
    let target = account
        .db
        .lock()
        .unwrap()
        .message_target(chat_id, quote_id)
        .map_err(|e| e.to_string())?
        .ok_or("quoted message not found")?;
    let sender = message_author(account, chat_id, &target)
        .parse::<Jid>()
        .map_err(|_| "invalid quoted sender".to_string())?;
    let quoted = stored_message(&target)?;
    Ok(
        whatsapp_rust::wacore::proto_helpers::build_quote_context_with_info(
            quote_id, &sender, to, to, &quoted,
        ),
    )
}

/// Sends a text message and records it in the chat, since the server does not echo a
/// device's own sends back to it. When `quote_id` is set, the text quotes that stored
/// message (Reply).
#[tauri::command]
pub async fn wa_native_send_text(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    text: String,
    quote_id: Option<String>,
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
    let outgoing = match &quote_id {
        Some(qid) => wa::Message::text_with_context(
            text.clone(),
            quote_context(&account, &chat_id, &to, qid)?,
        ),
        None => wa::Message::text(text.clone()),
    };
    let sent = client
        .send_message(to, outgoing)
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
            ack: ACK_SENT,
            revoked_at: None,
            edited_at: None,
            edits: Vec::new(),
            channel_reactions: Vec::new(),
            reply_to: None,
            album_id: None,
        },
        sender_id: String::new(),
        media: None,
        quote: quote_id.as_deref().map(QuoteRef::by_id),
        album: None,
    };
    record_message(&app, &account, generation, message);
    Ok(())
}

/// Reacts to (or, with an empty `emoji`, un-reacts from) a stored message.
#[tauri::command]
pub async fn wa_native_react(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    message_id: String,
    emoji: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = {
        let inner = account.inner.lock().unwrap();
        inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?
    };
    let target = account
        .db
        .lock()
        .unwrap()
        .message_target(&chat_id, &message_id)
        .map_err(|e| e.to_string())?
        .ok_or("message not found")?;
    let to: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    if chat_id.ends_with("@newsletter") {
        let server_id = target
            .server_id
            .ok_or("this channel message can't be reacted to (no server id; only messages received while connected can)")?;
        return client
            .newsletter()
            .send_reaction(&to, server_id as u64, &emoji)
            .await
            .map_err(|e| e.to_string());
    }
    let key = target_key(&account, &chat_id, &message_id, &target);
    client
        .send_reaction(to, key, &emoji)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Edits one of our own messages and updates the stored copy.
#[tauri::command]
pub async fn wa_native_edit(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    message_id: String,
    text: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = {
        let inner = account.inner.lock().unwrap();
        inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?
    };
    let to: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    if chat_id.ends_with("@newsletter") {
        client
            .newsletter()
            .edit_message(&to, message_id.clone(), wa::Message::text(text.clone()))
            .await
            .map_err(|e| e.to_string())?;
    } else {
        client
            .edit_message(to, message_id.clone(), wa::Message::text(text.clone()))
            .await
            .map_err(|e| e.to_string())?;
    }
    let updated = account
        .db
        .lock()
        .unwrap()
        .edit_message(&chat_id, &message_id, &text, now_millis())
        .map_err(|e| e.to_string())?;
    if updated.is_some() {
        emit_chats(&app, &account);
    }
    Ok(())
}

/// Deletes one of our own messages for everyone (revoke).
#[tauri::command]
pub async fn wa_native_delete(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    message_id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = {
        let inner = account.inner.lock().unwrap();
        inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?
    };
    let to: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    if chat_id.ends_with("@newsletter") {
        client
            .newsletter()
            .revoke_message(&to, message_id.clone())
            .await
            .map_err(|e| e.to_string())?;
    } else {
        client
            .revoke_message(to, message_id.clone(), RevokeType::Sender)
            .await
            .map_err(|e| e.to_string())?;
    }
    let stored = account
        .db
        .lock()
        .unwrap()
        .revoke_message(&chat_id, &message_id, now_millis())
        .map_err(|e| e.to_string())?;
    if stored.is_some() {
        emit_chats(&app, &account);
    }
    Ok(())
}

/// Pins a message for everyone (7 days) or unpins it.
#[tauri::command]
pub async fn wa_native_pin_message(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    message_id: String,
    on: bool,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = {
        let inner = account.inner.lock().unwrap();
        inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?
    };
    let target = account
        .db
        .lock()
        .unwrap()
        .message_target(&chat_id, &message_id)
        .map_err(|e| e.to_string())?
        .ok_or("message not found")?;
    let key = target_key(&account, &chat_id, &message_id, &target);
    let to: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let result = if on {
        client.pin_message(to, key, PinDuration::Days7).await
    } else {
        client.unpin_message(to, key).await
    };
    result.map_err(|e| e.to_string())?;
    Ok(())
}

/// Forwards a stored message to another chat and records the copy in the target chat.
#[tauri::command]
pub async fn wa_native_forward(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    from_chat_id: String,
    message_id: String,
    to_chat_id: String,
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
    let target = account
        .db
        .lock()
        .unwrap()
        .message_target(&from_chat_id, &message_id)
        .map_err(|e| e.to_string())?
        .ok_or("message not found")?;
    let message = stored_message(&target)?;
    let media = extract_media(&message);
    let to: Jid = to_chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {to_chat_id}"))?;
    let sent = client
        .forward_message(to, &message)
        .await
        .map_err(|e| e.to_string())?;
    let view = MessageView {
        id: sent.message_id,
        chat_id: to_chat_id,
        from_me: true,
        sender_name,
        sender_phone: None,
        kind: if media.is_some() {
            MessageKind::Media
        } else {
            MessageKind::Text
        },
        body: target.body,
        timestamp: now_millis(),
        media: None,
        ack: ACK_SENT,
        revoked_at: None,
        edited_at: None,
        edits: Vec::new(),
        channel_reactions: Vec::new(),
        reply_to: None,
        album_id: None,
    };
    record_message(
        &app,
        &account,
        generation,
        IncomingMessage {
            view,
            sender_id: String::new(),
            media,
            quote: None,
            album: None,
        },
    );
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn wa_native_chats(
    state: State<'_, WaState>,
    id: String,
) -> Result<Vec<ChatInfo>, String> {
    let account = state.get(&id)?;
    // Channels only carry their name in their metadata, so fetch it once per channel we
    // don't have a name for yet (list_subscribed on connect covers most of them already).
    let (client, generation) = {
        let inner = account.inner.lock().unwrap();
        (inner.client.clone(), inner.generation)
    };
    if let Some(client) = client {
        let ids = account
            .db
            .lock()
            .unwrap()
            .newsletter_ids()
            .unwrap_or_default();
        for chat_id in ids {
            // Ask for each channel's metadata once per run, however it turns out.
            {
                let mut inner = account.inner.lock().unwrap();
                if inner.channels_gen != generation {
                    inner.channels_gen = generation;
                    inner.channels_probed.clear();
                }
                if inner.channels_probed.contains(&chat_id) {
                    continue;
                }
                inner.channels_probed.insert(chat_id.clone());
            }
            let missing = account
                .db
                .lock()
                .unwrap()
                .who(&chat_id)
                .map(|w| w.name.is_none())
                .unwrap_or(false);
            if !missing {
                continue;
            }
            let Ok(jid) = chat_id.parse::<Jid>() else {
                continue;
            };
            if let Ok(meta) = crate::channel_mex::get(&client, &jid).await {
                if !account.is_current(generation) {
                    break;
                }
                let _ = account.db.lock().unwrap().set_name(
                    &chat_id,
                    &meta.name,
                    NameSource::GroupSubject,
                );
            }
        }
    }
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

/// Fetches a page of a channel's own history from the server: the latest messages, or with
/// `older` the page before the oldest one stored. Stores them with their server ids and
/// reaction totals, and returns how many the server sent (0 means the start of the channel).
#[tauri::command]
pub async fn wa_native_channel_sync(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    older: bool,
) -> Result<usize, String> {
    let account = state.get(&id)?;
    let (client, generation) = {
        let inner = account.inner.lock().unwrap();
        (
            inner
                .client
                .clone()
                .ok_or("WhatsApp account is not running")?,
            inner.generation,
        )
    };
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let before = if older {
        account
            .db
            .lock()
            .unwrap()
            .oldest_server_id(&chat_id)
            .map_err(|e| e.to_string())?
            .map(|id| id as u64)
    } else {
        None
    };
    let page = client
        .newsletter()
        .get_messages(jid, OLDER_PAGE as u32, before)
        .await
        .map_err(|e| e.to_string())?;
    if !account.is_current(generation) {
        return Ok(0);
    }
    let count = page.len();
    let result = account.db.lock().unwrap().batch(|db| {
        for m in &page {
            if m.message_id.is_empty() {
                continue;
            }
            let reactions: Vec<(String, u64)> = m
                .reactions
                .iter()
                .map(|r| (r.code.clone(), r.count))
                .collect();
            if let Some((kind, body, media)) = m.message.as_ref().and_then(message_content) {
                let message = IncomingMessage {
                    view: MessageView {
                        id: m.message_id.clone(),
                        chat_id: chat_id.clone(),
                        from_me: m.is_sender,
                        sender_name: String::new(),
                        sender_phone: None,
                        kind,
                        body,
                        timestamp: m.timestamp as i64 * 1000,
                        media: None,
                        ack: ACK_SENT,
                        revoked_at: None,
                        edited_at: None,
                        edits: Vec::new(),
                        channel_reactions: Vec::new(),
                        reply_to: None,
                        album_id: None,
                    },
                    sender_id: String::new(),
                    media,
                    quote: None,
                    album: None,
                };
                db.insert_message(&message, false)?;
            }
            db.set_server_id(&chat_id, &m.message_id, m.server_id as i64)?;
            db.set_channel_reactions(&chat_id, &m.message_id, &reactions)?;
        }
        Ok(())
    });
    result.map_err(|e| e.to_string())?;
    emit_chats(&app, &account);
    Ok(count)
}

fn running_client(account: &WaAccount) -> Result<Arc<Client>, String> {
    account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or_else(|| "WhatsApp account is not running".to_string())
}

/// Follows a channel from its invite link (or bare code) and returns its chat id.
#[tauri::command]
pub async fn wa_native_channel_follow(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    invite: String,
) -> Result<String, String> {
    let account = state.get(&id)?;
    let client = running_client(&account)?;
    let code = invite
        .trim()
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string();
    if code.is_empty() {
        return Err("paste a channel link, like whatsapp.com/channel/…".into());
    }
    let found = crate::channel_mex::by_invite(&client, &code).await?;
    let meta = client
        .newsletter()
        .join(&found.jid)
        .await
        .map_err(|e| e.to_string())?;
    let chat_id = bare_jid(&meta.jid.to_string());
    {
        let db = account.db.lock().unwrap();
        db.set_name(&chat_id, &meta.name, NameSource::GroupSubject)
            .map_err(|e| e.to_string())?;
        db.ensure_chat(&chat_id, now_millis(), 0)
            .map_err(|e| e.to_string())?;
    }
    emit_account(&app, &account);
    emit_chats(&app, &account);
    Ok(chat_id)
}

/// Stops following a channel and drops its stored posts.
#[tauri::command]
pub async fn wa_native_channel_leave(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = running_client(&account)?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    client
        .newsletter()
        .leave(&jid)
        .await
        .map_err(|e| e.to_string())?;
    account
        .db
        .lock()
        .unwrap()
        .delete_chat(&chat_id)
        .map_err(|e| e.to_string())?;
    emit_account(&app, &account);
    emit_chats(&app, &account);
    Ok(())
}

/// Renames a channel or changes its description (owners and admins only).
#[tauri::command]
pub async fn wa_native_channel_update(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    name: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = running_client(&account)?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let meta = client
        .newsletter()
        .update(&jid, name.as_deref(), description.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    let _ = account
        .db
        .lock()
        .unwrap()
        .set_name(&chat_id, &meta.name, NameSource::GroupSubject);
    emit_chats(&app, &account);
    Ok(())
}

/// Mutes or unmutes a channel's notifications on the account.
#[tauri::command]
pub async fn wa_native_channel_mute(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    muted: bool,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = running_client(&account)?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    client
        .newsletter()
        .set_follower_mute(&jid, muted)
        .await
        .map_err(|e| e.to_string())
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageReceipt {
    pub id: String,
    pub name: String,
    pub delivered_at: Option<i64>,
    pub read_at: Option<i64>,
    pub played_at: Option<i64>,
}

/// Who got, read or played a message of mine, and when (as far as receipts were seen).
#[tauri::command]
pub fn wa_native_message_info(
    state: State<'_, WaState>,
    id: String,
    message_id: String,
) -> Result<Vec<MessageReceipt>, String> {
    let account = state.get(&id)?;
    let db = account.db.lock().unwrap();
    let rows = db.receipts_for(&message_id).map_err(|e| e.to_string())?;
    let mut out: Vec<MessageReceipt> = Vec::new();
    for (who, ack, at) in rows {
        let i = match out.iter().position(|r| r.id == who) {
            Some(i) => i,
            None => {
                let w = db.who(&who).ok();
                let name = w
                    .as_ref()
                    .and_then(|w| w.name.clone().or(w.phone.clone().map(|p| format!("+{p}"))))
                    .unwrap_or_else(|| format!("+{}", who.split('@').next().unwrap_or(&who)));
                out.push(MessageReceipt {
                    id: who.clone(),
                    name,
                    delivered_at: None,
                    read_at: None,
                    played_at: None,
                });
                out.len() - 1
            }
        };
        match ack {
            2 => out[i].delivered_at = Some(at),
            3 => out[i].read_at = Some(at),
            4 => out[i].played_at = Some(at),
            _ => {}
        }
    }
    Ok(out)
}

/// Clears the unread count of every chat, or only of `chat_ids` when given. Local only,
/// like `wa_native_mark_read`; the phone is told best-effort so its badges clear too.
#[tauri::command]
pub async fn wa_native_mark_all_read(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let targets: Vec<String> = match &chat_ids {
        Some(ids) => ids.clone(),
        None => account
            .db
            .lock()
            .unwrap()
            .chats()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|c| c.unread > 0)
            .map(|c| c.id)
            .collect(),
    };
    {
        let db = account.db.lock().unwrap();
        let result = match &chat_ids {
            Some(ids) => ids.iter().try_for_each(|c| db.mark_read(c)),
            None => db.mark_all_read(),
        };
        result.map_err(|e| e.to_string())?;
    }
    emit_account(&app, &account);
    emit_chats(&app, &account);
    let client = account.inner.lock().unwrap().client.clone();
    if let Some(client) = client {
        for chat in targets {
            if let Ok(jid) = chat.parse::<Jid>() {
                let _ = client
                    .chat_actions()
                    .mark_chat_as_read(&jid, true, None)
                    .await;
            }
        }
    }
    Ok(())
}

/// Deletes chats from this device and, when the account is online, from the linked phone.
#[tauri::command]
pub async fn wa_native_delete_chats(
    app: AppHandle,
    state: State<'_, WaState>,
    id: String,
    chat_ids: Vec<String>,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = account.inner.lock().unwrap().client.clone();
    if let Some(client) = client {
        for chat in &chat_ids {
            if let Ok(jid) = chat.parse::<Jid>() {
                let _ = client.chat_actions().delete_chat(&jid, true, None).await;
            }
        }
    }
    {
        let db = account.db.lock().unwrap();
        for chat in &chat_ids {
            db.delete_chat(chat).map_err(|e| e.to_string())?;
        }
    }
    emit_account(&app, &account);
    emit_chats(&app, &account);
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

/// Starts or stops listening for typing in the open chat. WhatsApp only forwards chat
/// states to a client that is online and, for a direct chat, subscribed to the contact's
/// presence, so this marks the account available while a chat is open.
#[tauri::command]
pub async fn wa_native_watch_typing(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
    on: bool,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let jid: Jid = chat_id
        .parse()
        .map_err(|_| format!("invalid chat id: {chat_id}"))?;
    let (client, toggle) = {
        let mut inner = account.inner.lock().unwrap();
        let client = inner
            .client
            .clone()
            .ok_or("WhatsApp account is not running")?;
        let before = inner.typing_watchers;
        inner.typing_watchers = if on {
            before + 1
        } else {
            before.saturating_sub(1)
        };
        (client, (before == 0) != (inner.typing_watchers == 0))
    };
    let direct = !chat_id.ends_with("@g.us");
    let presence = client.presence();
    if on {
        if toggle {
            presence.set_available().await.map_err(|e| e.to_string())?;
        }
        if direct {
            presence.subscribe(jid).await.map_err(|e| e.to_string())?;
        }
    } else {
        if direct {
            let _ = presence.unsubscribe(&jid).await;
        }
        if toggle {
            presence
                .set_unavailable()
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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
    // Channels carry their picture in their metadata; profile pictures are for contacts.
    let url = if chat_id.ends_with("@newsletter") {
        crate::channel_mex::get(&client, &jid)
            .await
            .ok()
            .and_then(|meta| meta.picture_url)
    } else {
        client
            .contacts()
            .get_profile_picture(&jid, true)
            .await
            .map_err(|e| e.to_string())?
            .map(|picture| picture.url)
    };
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
    let quote_id = header("x-quote").filter(|q| !q.is_empty());
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
    let context_info = match &quote_id {
        Some(qid) => Some(Box::new(quote_context(&account, &chat_id, &to, qid)?)),
        None => None,
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
                context_info: context_info.clone(),
                ..Default::default()
            },
        ),
        MediaType::Video => whatsapp_rust::media::video_message(
            upload,
            whatsapp_rust::media::VideoOptions {
                caption: caption.clone(),
                mimetype: Some(mimetype.clone()),
                context_info: context_info.clone(),
                ..Default::default()
            },
        ),
        MediaType::Audio => whatsapp_rust::media::audio_message(
            upload,
            whatsapp_rust::media::AudioOptions {
                mimetype: Some(mimetype.clone()),
                context_info: context_info.clone(),
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
                context_info: context_info.clone(),
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
            ack: ACK_SENT,
            revoked_at: None,
            edited_at: None,
            edits: Vec::new(),
            channel_reactions: Vec::new(),
            reply_to: None,
            album_id: None,
        },
        sender_id: String::new(),
        media,
        quote: quote_id.as_deref().map(QuoteRef::by_id),
        album: None,
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
#[serde(rename_all = "camelCase")]
pub struct ChannelDetails {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// `None` when the server would not give the details (see `warning`).
    pub subscribers: Option<u64>,
    pub verified: bool,
    /// Why the details are partial, with the underlying error.
    pub warning: Option<String>,
    pub invite_link: Option<String>,
    /// "owner", "admin", "subscriber" or "guest".
    pub role: Option<String>,
    /// Unix milliseconds.
    pub created_at: Option<i64>,
    pub picture: Option<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatDetails {
    Contact(ContactDetails),
    Group(GroupDetails),
    Channel(ChannelDetails),
}

fn channel_details(meta: &NewsletterMetadata) -> ChannelDetails {
    ChannelDetails {
        id: bare_jid(&meta.jid.to_string()),
        name: meta.name.clone(),
        description: meta.description.clone().filter(|d| !d.trim().is_empty()),
        subscribers: Some(meta.subscriber_count),
        verified: meta.verification == NewsletterVerification::Verified,
        warning: None,
        invite_link: meta
            .invite_code
            .as_ref()
            .map(|code| format!("https://whatsapp.com/channel/{code}")),
        role: meta.role.as_ref().map(|r| {
            match r {
                NewsletterRole::Owner => "owner",
                NewsletterRole::Admin => "admin",
                NewsletterRole::Subscriber => "subscriber",
                NewsletterRole::Guest => "guest",
                _ => "guest",
            }
            .to_string()
        }),
        created_at: meta.creation_time.map(|t| t as i64 * 1000),
        picture: meta
            .picture_url
            .clone()
            .or_else(|| meta.preview_url.clone()),
    }
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

    if chat_id.ends_with("@newsletter") {
        // The single-channel lookup is sometimes refused; the subscribed list carries the same
        // data. If both fail, still open the panel (unfollow and mute work) and say why.
        let meta = match crate::channel_mex::get(&client, &jid).await {
            Ok(meta) => Ok(meta),
            Err(first) => match crate::channel_mex::subscribed(&client).await {
                Ok(all) => all
                    .into_iter()
                    .find(|m| bare_jid(&m.jid.to_string()) == chat_id)
                    .ok_or(first),
                Err(second) => Err(format!("{first}; subscribed list: {second}")),
            },
        };
        let meta = match meta {
            Ok(meta) => meta,
            Err(why) => {
                let name = account
                    .db
                    .lock()
                    .unwrap()
                    .who(&chat_id)
                    .ok()
                    .and_then(|w| w.name)
                    .unwrap_or_else(|| chat_id.split('@').next().unwrap_or_default().to_string());
                return Ok(ChatDetails::Channel(ChannelDetails {
                    id: chat_id,
                    name,
                    description: None,
                    subscribers: None,
                    verified: false,
                    warning: Some(why),
                    invite_link: None,
                    role: None,
                    created_at: None,
                    picture: None,
                }));
            }
        };
        let _ = account
            .db
            .lock()
            .unwrap()
            .set_name(&chat_id, &meta.name, NameSource::GroupSubject);
        emit_chats(&app, &account);
        return Ok(ChatDetails::Channel(channel_details(&meta)));
    }

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
                    let _ =
                        db.set_lid_pn(&bare_jid(&r.jid.to_string()), &bare_jid(&pn.to_string()));
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
pub fn wa_native_statuses(
    state: State<'_, WaState>,
    id: String,
) -> Result<Vec<StatusView>, String> {
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

// ── Chat labels and pinning ──────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub name: String,
    /// WhatsApp color index, not a hex value.
    pub color: i64,
}

/// Labels cached from app-state sync, by name.
#[tauri::command]
pub fn wa_native_labels(state: State<'_, WaState>, id: String) -> Result<Vec<Label>, String> {
    let account = state.get(&id)?;
    let labels = account
        .db
        .lock()
        .unwrap()
        .labels()
        .map_err(|e| e.to_string())?;
    Ok(labels
        .into_iter()
        .map(|l| Label {
            id: l.id,
            name: l.name,
            color: l.color,
        })
        .collect())
}

/// Ids of the labels on one chat.
#[tauri::command]
pub fn wa_native_chat_labels(
    state: State<'_, WaState>,
    id: String,
    chat_id: String,
) -> Result<Vec<String>, String> {
    let account = state.get(&id)?;
    let labels = account
        .db
        .lock()
        .unwrap()
        .chat_labels(&chat_id)
        .map_err(|e| e.to_string())?;
    Ok(labels)
}

/// Every chat's label ids, for the label chips in the chat list.
#[tauri::command]
pub fn wa_native_label_map(
    state: State<'_, WaState>,
    id: String,
) -> Result<HashMap<String, Vec<String>>, String> {
    let account = state.get(&id)?;
    let pairs = account
        .db
        .lock()
        .unwrap()
        .all_chat_labels()
        .map_err(|e| e.to_string())?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for (chat_id, label_id) in pairs {
        map.entry(chat_id).or_default().push(label_id);
    }
    Ok(map)
}

/// A fresh label id (WhatsApp uses numeric strings).
fn new_label_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}", nanos)
}

/// Creates a label (or renames/recovers an existing one) and caches it.
#[tauri::command]
pub async fn wa_native_label_create(
    state: State<'_, WaState>,
    id: String,
    label_id: Option<String>,
    name: String,
    color: i64,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("label name is empty".into());
    }
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    let label_id = label_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(new_label_id);
    client
        .labels()
        .create_label(&label_id, name, color as i32)
        .await
        .map_err(|e| e.to_string())?;
    let _ = account
        .db
        .lock()
        .unwrap()
        .upsert_label(&label_id, name, color, false);
    Ok(label_id)
}

/// Deletes a label and its associations.
#[tauri::command]
pub async fn wa_native_label_delete(
    state: State<'_, WaState>,
    id: String,
    label_id: String,
) -> Result<(), String> {
    let account = state.get(&id)?;
    let client = account
        .inner
        .lock()
        .unwrap()
        .client
        .clone()
        .ok_or("WhatsApp account is not running")?;
    client
        .labels()
        .delete_label(&label_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = account.db.lock().unwrap().delete_label(&label_id);
    Ok(())
}

/// Adds or removes a label on a chat.
#[tauri::command]
pub async fn wa_native_label_link(
    state: State<'_, WaState>,
    id: String,
    label_id: String,
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
    let labels = client.labels();
    let result = if on {
        labels.add_chat_label(&label_id, &jid).await
    } else {
        labels.remove_chat_label(&label_id, &jid).await
    };
    result.map_err(|e| e.to_string())?;
    let _ = account
        .db
        .lock()
        .unwrap()
        .set_chat_label(&label_id, &bare_jid(&chat_id), on);
    Ok(())
}

/// Pins or unpins a chat (WhatsApp app state, so it syncs to the phone).
#[tauri::command]
pub async fn wa_native_pin_chat(
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
    let actions = client.chat_actions();
    let result = if on {
        actions.pin_chat(&jid).await
    } else {
        actions.unpin_chat(&jid).await
    };
    result.map_err(|e| e.to_string())
}
