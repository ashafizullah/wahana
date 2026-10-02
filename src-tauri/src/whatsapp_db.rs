//! Per-account chat history for the native WhatsApp client.
//!
//! The protocol store (`<id>.db`, owned by `whatsapp-rust`) keeps keys and sessions, not
//! messages: WhatsApp sends a linked device its history once, right after pairing, and
//! after that only new traffic. This database (`<id>.chats.db`) is where that history and
//! everything since is kept, so chats survive restarts.

use std::collections::HashMap;
use std::path::Path;

use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension};

use crate::whatsapp::{ChatInfo, MediaInfo, MessageKind, MessageView};

/// Bumped with every schema change; `open` migrates older files up to it.
const SCHEMA_VERSION: i64 = 2;

/// How much a name source is trusted. A name only replaces one from an equal or lower
/// source, so a push name never overwrites a contact's saved name.
#[derive(Clone, Copy)]
pub enum NameSource {
    PushName = 1,
    History = 2,
    Contact = 3,
    GroupSubject = 4,
}

pub struct ChatDb {
    conn: Connection,
}

/// A media attachment as stored: what the bubble needs to draw it, plus the encoded
/// media message, which holds the keys to download and decrypt it later.
pub struct StoredMedia {
    pub kind: &'static str,
    pub mimetype: String,
    pub file_name: Option<String>,
    pub size: Option<u64>,
    pub seconds: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub thumbnail: Option<Vec<u8>>,
    pub proto: Vec<u8>,
}

impl StoredMedia {
    pub fn info(&self) -> MediaInfo {
        MediaInfo {
            kind: self.kind.to_string(),
            mimetype: self.mimetype.clone(),
            file_name: self.file_name.clone(),
            size: self.size,
            seconds: self.seconds,
            width: self.width,
            height: self.height,
            thumbnail: self.thumbnail.as_deref().map(thumbnail_url),
        }
    }
}

/// A message plus the bare id of its sender (empty for your own), whose push name it
/// also records.
pub struct IncomingMessage {
    pub view: MessageView,
    pub sender_id: String,
    pub media: Option<StoredMedia>,
}

/// Who someone is, for the contact and group info panels.
pub struct Who {
    /// Their name from your contacts, or failing that the name they gave themselves.
    pub name: Option<String>,
    /// Whether `name` is from your contacts.
    pub saved: bool,
    pub phone: Option<String>,
}

/// Who an id is, as far as this account knows.
#[derive(Default)]
struct Resolved {
    name: Option<(String, i64)>,
    phone: Option<String>,
}

impl ChatDb {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS chats (
                 id TEXT PRIMARY KEY,
                 fallback_name TEXT NOT NULL,
                 last_text TEXT NOT NULL DEFAULT '',
                 last_timestamp INTEGER NOT NULL DEFAULT 0,
                 last_from_me INTEGER NOT NULL DEFAULT 0,
                 last_sender_id TEXT NOT NULL DEFAULT '',
                 last_sender TEXT NOT NULL DEFAULT '',
                 unread INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS messages (
                 chat_id TEXT NOT NULL,
                 id TEXT NOT NULL,
                 from_me INTEGER NOT NULL,
                 sender_id TEXT NOT NULL,
                 sender_name TEXT NOT NULL,
                 kind TEXT NOT NULL,
                 body TEXT NOT NULL,
                 timestamp INTEGER NOT NULL,
                 PRIMARY KEY (chat_id, id)
             );
             CREATE INDEX IF NOT EXISTS messages_by_time ON messages (chat_id, timestamp);
             CREATE TABLE IF NOT EXISTS names (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 source INTEGER NOT NULL
             );",
        )?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 2 {
            conn.execute_batch(
                "ALTER TABLE messages ADD COLUMN media_kind TEXT;
                 ALTER TABLE messages ADD COLUMN mimetype TEXT;
                 ALTER TABLE messages ADD COLUMN file_name TEXT;
                 ALTER TABLE messages ADD COLUMN file_size INTEGER;
                 ALTER TABLE messages ADD COLUMN seconds INTEGER;
                 ALTER TABLE messages ADD COLUMN width INTEGER;
                 ALTER TABLE messages ADD COLUMN height INTEGER;
                 ALTER TABLE messages ADD COLUMN thumbnail BLOB;
                 ALTER TABLE messages ADD COLUMN media_proto BLOB;
                 CREATE TABLE IF NOT EXISTS lid_pn (
                     lid TEXT PRIMARY KEY,
                     pn TEXT NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS lid_pn_by_pn ON lid_pn (pn);",
            )?;
        }
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
        // Statuses are stored as messages under `status@broadcast`, not as a chat; drop any
        // row an earlier build created for it.
        conn.execute("DELETE FROM chats WHERE id = 'status@broadcast'", [])?;
        Ok(Self { conn })
    }

    /// Forgets everything, for a device that was logged out and will pair afresh.
    pub fn clear(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "DELETE FROM chats; DELETE FROM messages; DELETE FROM names; DELETE FROM lid_pn;",
        )
    }

    pub fn set_name(&self, id: &str, name: &str, source: NameSource) -> rusqlite::Result<()> {
        if id.is_empty() || name.trim().is_empty() {
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO names (id, name, source) VALUES (?1, ?2, ?3)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, source = excluded.source
             WHERE excluded.source >= names.source",
            params![id, name.trim(), source as i64],
        )?;
        Ok(())
    }

    /// Records that a privacy id (`…@lid`) belongs to a phone number (`…@s.whatsapp.net`).
    pub fn set_lid_pn(&self, lid: &str, pn: &str) -> rusqlite::Result<()> {
        if !lid.ends_with("@lid") || !pn.ends_with("@s.whatsapp.net") {
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO lid_pn (lid, pn) VALUES (?1, ?2) ON CONFLICT (lid) DO UPDATE SET pn = excluded.pn",
            params![lid, pn],
        )?;
        Ok(())
    }

    /// Direct chats on a privacy id whose phone number is not known yet.
    pub fn unmapped_lids(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM chats WHERE id LIKE '%@lid' AND id NOT IN (SELECT lid FROM lid_pn)",
        )?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    }

    /// Makes sure a chat row exists, e.g. for a conversation history listed without
    /// messages. Its preview and unread count come from `unread` and later messages.
    pub fn ensure_chat(&self, id: &str, timestamp: i64, unread: u32) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO chats (id, fallback_name, last_timestamp, unread) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (id) DO UPDATE SET
                 last_timestamp = MAX(chats.last_timestamp, excluded.last_timestamp),
                 unread = excluded.unread",
            params![id, fallback_name(id), timestamp, unread],
        )?;
        Ok(())
    }

    /// Stores a message and updates its chat. Returns false when it was already known, so
    /// a redelivery neither notifies nor counts as unread twice. `count_unread` is off for
    /// history, whose unread counts come from the conversation itself.
    pub fn insert_message(
        &self,
        msg: &IncomingMessage,
        count_unread: bool,
    ) -> rusqlite::Result<bool> {
        let v = &msg.view;
        let m = msg.media.as_ref();
        let inserted = self.conn.execute(
            "INSERT OR IGNORE INTO messages (chat_id, id, from_me, sender_id, sender_name, kind, body, timestamp,
                 media_kind, mimetype, file_name, file_size, seconds, width, height, thumbnail, media_proto)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                v.chat_id,
                v.id,
                v.from_me,
                msg.sender_id,
                v.sender_name,
                kind_str(v.kind),
                v.body,
                v.timestamp,
                m.map(|m| m.kind),
                m.map(|m| m.mimetype.as_str()),
                m.and_then(|m| m.file_name.as_deref()),
                m.and_then(|m| m.size).map(|s| s as i64),
                m.and_then(|m| m.seconds),
                m.and_then(|m| m.width),
                m.and_then(|m| m.height),
                m.and_then(|m| m.thumbnail.as_deref()),
                m.map(|m| m.proto.as_slice()),
            ],
        )? > 0;
        if !inserted {
            // Messages stored before attachments were kept have no media columns; fill
            // them in when the same message comes round again (e.g. "load older").
            if let Some(m) = m {
                self.conn.execute(
                    "UPDATE messages SET media_kind = ?3, mimetype = ?4, file_name = ?5, file_size = ?6,
                         seconds = ?7, width = ?8, height = ?9, thumbnail = ?10, media_proto = ?11
                     WHERE chat_id = ?1 AND id = ?2 AND media_proto IS NULL",
                    params![
                        v.chat_id,
                        v.id,
                        m.kind,
                        m.mimetype,
                        m.file_name,
                        m.size.map(|s| s as i64),
                        m.seconds,
                        m.width,
                        m.height,
                        m.thumbnail,
                        m.proto,
                    ],
                )?;
            }
            return Ok(false);
        }
        if !v.from_me && !v.sender_name.is_empty() {
            self.set_name(&msg.sender_id, &v.sender_name, NameSource::PushName)?;
        }
        // Statuses live under `status@broadcast` but are not a chat: no row, no unread.
        if v.chat_id == "status@broadcast" {
            return Ok(true);
        }
        // Replying from another device means the chat was read there.
        let unread_sql = match (count_unread, v.from_me) {
            (_, true) => "0",
            (true, false) => "chats.unread + 1",
            (false, false) => "chats.unread",
        };
        self.conn.execute(
            &format!(
                "INSERT INTO chats (id, fallback_name, last_text, last_timestamp, last_from_me, last_sender_id, last_sender, unread)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT (id) DO UPDATE SET
                     last_text = CASE WHEN excluded.last_timestamp >= chats.last_timestamp THEN excluded.last_text ELSE chats.last_text END,
                     last_from_me = CASE WHEN excluded.last_timestamp >= chats.last_timestamp THEN excluded.last_from_me ELSE chats.last_from_me END,
                     last_sender_id = CASE WHEN excluded.last_timestamp >= chats.last_timestamp THEN excluded.last_sender_id ELSE chats.last_sender_id END,
                     last_sender = CASE WHEN excluded.last_timestamp >= chats.last_timestamp THEN excluded.last_sender ELSE chats.last_sender END,
                     last_timestamp = MAX(chats.last_timestamp, excluded.last_timestamp),
                     unread = {unread_sql}"
            ),
            params![
                v.chat_id,
                fallback_name(&v.chat_id),
                preview(v.kind, &v.body, m.map(|m| m.kind)),
                v.timestamp,
                v.from_me,
                msg.sender_id,
                v.sender_name,
                if count_unread && !v.from_me { 1 } else { 0 }
            ],
        )?;
        Ok(true)
    }

    /// Removes one stored message (e.g. a status I deleted).
    pub fn delete_message(&self, chat_id: &str, id: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM messages WHERE chat_id = ?1 AND id = ?2",
            params![chat_id, id],
        )?;
        Ok(())
    }

    pub fn mark_read(&self, chat_id: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE chats SET unread = 0 WHERE id = ?1",
            params![chat_id],
        )?;
        Ok(())
    }

    pub fn unread_chats(&self) -> u32 {
        self.conn
            .query_row("SELECT COUNT(*) FROM chats WHERE unread > 0", [], |r| {
                r.get(0)
            })
            .unwrap_or(0)
    }

    /// The best known name and the phone number of a user or group id. A contact may be
    /// known under its phone number while its chat runs on its privacy id, or the other
    /// way round, so both sides of the mapping are consulted.
    fn resolve(&self, id: &str) -> rusqlite::Result<Resolved> {
        let pn = if id.ends_with("@s.whatsapp.net") {
            Some(id.to_string())
        } else if id.ends_with("@lid") {
            self.conn
                .query_row("SELECT pn FROM lid_pn WHERE lid = ?1", params![id], |r| {
                    r.get::<_, String>(0)
                })
                .optional()?
        } else {
            None
        };
        let lid = if id.ends_with("@lid") {
            Some(id.to_string())
        } else if let Some(pn) = &pn {
            self.conn
                .query_row(
                    "SELECT lid FROM lid_pn WHERE pn = ?1 LIMIT 1",
                    params![pn],
                    |r| r.get::<_, String>(0),
                )
                .optional()?
        } else {
            None
        };
        let mut best: Option<(String, i64)> = None;
        for candidate in [Some(id), pn.as_deref(), lid.as_deref()]
            .into_iter()
            .flatten()
        {
            let found = self
                .conn
                .query_row(
                    "SELECT name, source FROM names WHERE id = ?1",
                    params![candidate],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
                )
                .optional()?;
            if let Some(found) = found {
                if best.as_ref().is_none_or(|b| found.1 > b.1) {
                    best = Some(found);
                }
            }
        }
        Ok(Resolved {
            name: best,
            phone: pn.as_deref().map(phone_of),
        })
    }

    pub fn who(&self, id: &str) -> rusqlite::Result<Who> {
        let r = self.resolve(id)?;
        Ok(Who {
            saved: r
                .name
                .as_ref()
                .is_some_and(|(_, source)| *source >= NameSource::Contact as i64),
            name: r.name.map(|(n, _)| n),
            phone: r.phone,
        })
    }

    /// The phone-number id of a user, if known: itself, or what its privacy id maps to.
    pub fn pn_for(&self, id: &str) -> rusqlite::Result<Option<String>> {
        if id.ends_with("@s.whatsapp.net") {
            return Ok(Some(id.to_string()));
        }
        self.conn
            .query_row("SELECT pn FROM lid_pn WHERE lid = ?1", params![id], |r| {
                r.get(0)
            })
            .optional()
    }

    pub fn chats(&self) -> rusqlite::Result<Vec<ChatInfo>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, fallback_name, last_text, last_timestamp, last_from_me, last_sender_id, last_sender, unread
             FROM chats WHERE id != 'status@broadcast' ORDER BY last_timestamp DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, bool>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, u32>(7)?,
            ))
        })?;
        let mut senders: HashMap<String, Resolved> = HashMap::new();
        let mut chats = Vec::new();
        for row in rows {
            let (id, fallback, last_text, last_timestamp, last_from_me, sender_id, sender, unread) =
                row?;
            let who = self.resolve(&id)?;
            let last_sender = if sender_id.is_empty() {
                sender
            } else {
                if !senders.contains_key(&sender_id) {
                    senders.insert(sender_id.clone(), self.resolve(&sender_id)?);
                }
                let s = &senders[&sender_id];
                s.name
                    .as_ref()
                    .map(|(n, _)| n.clone())
                    .or_else(|| s.phone.clone())
                    .unwrap_or(sender)
            };
            let group = id.ends_with("@g.us");
            chats.push(ChatInfo {
                saved: group
                    || who
                        .name
                        .as_ref()
                        .is_some_and(|(_, source)| *source >= NameSource::Contact as i64),
                name: who
                    .name
                    .map(|(n, _)| n)
                    .or_else(|| who.phone.clone())
                    .unwrap_or(fallback),
                phone: if group { None } else { who.phone },
                id,
                last_text,
                last_timestamp,
                last_from_me,
                last_sender,
                unread,
            });
        }
        Ok(chats)
    }

    /// The newest `limit` messages of a chat, oldest first.
    pub fn messages(&self, chat_id: &str, limit: u32) -> rusqlite::Result<Vec<MessageView>> {
        self.query_messages(chat_id, limit, false)
    }

    /// The newest `limit` messages with an attachment, oldest first: the chat's gallery.
    pub fn media_messages(&self, chat_id: &str, limit: u32) -> rusqlite::Result<Vec<MessageView>> {
        self.query_messages(chat_id, limit, true)
    }

    /// Sender and id of the newest incoming messages, newest first: what a read receipt covers.
    pub fn incoming_ids(&self, chat_id: &str, limit: u32) -> rusqlite::Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT sender_id, id FROM messages WHERE chat_id = ?1 AND from_me = 0 ORDER BY timestamp DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![chat_id, limit], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        rows.collect()
    }

    /// The newest `limit` statuses, newest first, each with the poster's bare id.
    pub fn statuses(&self, limit: u32) -> rusqlite::Result<Vec<(String, MessageView)>> {
        let mut stmt = self.conn.prepare(
            "SELECT sender_id, id, chat_id, from_me, sender_name, kind, body, timestamp,
                    media_kind, mimetype, file_name, file_size, seconds, width, height, thumbnail
             FROM messages WHERE chat_id = 'status@broadcast' ORDER BY timestamp DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            let media_kind: Option<String> = r.get(8)?;
            let media = media_kind.map(|kind| -> rusqlite::Result<MediaInfo> {
                Ok(MediaInfo {
                    kind,
                    mimetype: r.get::<_, Option<String>>(9)?.unwrap_or_default(),
                    file_name: r.get(10)?,
                    size: r.get::<_, Option<i64>>(11)?.map(|s| s as u64),
                    seconds: r.get(12)?,
                    width: r.get(13)?,
                    height: r.get(14)?,
                    thumbnail: r
                        .get::<_, Option<Vec<u8>>>(15)?
                        .as_deref()
                        .map(thumbnail_url),
                })
            });
            Ok((
                r.get::<_, String>(0)?,
                MessageView {
                    id: r.get(1)?,
                    chat_id: r.get(2)?,
                    from_me: r.get(3)?,
                    sender_name: r.get(4)?,
                    sender_phone: None,
                    kind: kind_from(&r.get::<_, String>(5)?),
                    body: r.get(6)?,
                    timestamp: r.get(7)?,
                    media: media.transpose()?,
                },
            ))
        })?;
        rows.collect()
    }

    /// Phone-number ids of saved contacts, deduped and without `me`: who a status is posted to.
    pub fn status_recipients(&self, me: Option<&str>) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM names WHERE source >= ?1")?;
        let rows = stmt.query_map(params![NameSource::Contact as i64], |r| {
            r.get::<_, String>(0)
        })?;
        let mut out: Vec<String> = Vec::new();
        for id in rows {
            let id = id?;
            let pn = if id.ends_with("@s.whatsapp.net") {
                Some(id)
            } else if id.ends_with("@lid") {
                self.pn_for(&id)?
            } else {
                None
            };
            if let Some(pn) = pn {
                if Some(pn.as_str()) != me {
                    out.push(pn);
                }
            }
        }
        out.sort();
        out.dedup();
        Ok(out)
    }

    fn query_messages(
        &self,
        chat_id: &str,
        limit: u32,
        media_only: bool,
    ) -> rusqlite::Result<Vec<MessageView>> {
        let filter = if media_only {
            "AND media_proto IS NOT NULL"
        } else {
            ""
        };
        let mut stmt = self.conn.prepare(&format!(
            "SELECT * FROM (
                 SELECT id, chat_id, from_me, sender_id, sender_name, kind, body, timestamp,
                        media_kind, mimetype, file_name, file_size, seconds, width, height, thumbnail
                 FROM messages
                 WHERE chat_id = ?1 {filter}
                 ORDER BY timestamp DESC
                 LIMIT ?2
             ) ORDER BY timestamp ASC"
        ))?;
        let rows = stmt.query_map(params![chat_id, limit], |r| {
            let media_kind: Option<String> = r.get(8)?;
            let media = media_kind.map(|kind| -> rusqlite::Result<MediaInfo> {
                Ok(MediaInfo {
                    kind,
                    mimetype: r.get::<_, Option<String>>(9)?.unwrap_or_default(),
                    file_name: r.get(10)?,
                    size: r.get::<_, Option<i64>>(11)?.map(|s| s as u64),
                    seconds: r.get(12)?,
                    width: r.get(13)?,
                    height: r.get(14)?,
                    thumbnail: r
                        .get::<_, Option<Vec<u8>>>(15)?
                        .as_deref()
                        .map(thumbnail_url),
                })
            });
            Ok((
                r.get::<_, String>(3)?,
                MessageView {
                    id: r.get(0)?,
                    chat_id: r.get(1)?,
                    from_me: r.get(2)?,
                    sender_name: r.get(4)?,
                    sender_phone: None,
                    kind: kind_from(&r.get::<_, String>(5)?),
                    body: r.get(6)?,
                    timestamp: r.get(7)?,
                    media: media.transpose()?,
                },
            ))
        })?;
        let mut senders: HashMap<String, Resolved> = HashMap::new();
        let mut messages = Vec::new();
        for row in rows {
            let (sender_id, mut view) = row?;
            if !sender_id.is_empty() {
                if !senders.contains_key(&sender_id) {
                    senders.insert(sender_id.clone(), self.resolve(&sender_id)?);
                }
                let who = &senders[&sender_id];
                if let Some((name, _)) = &who.name {
                    view.sender_name = name.clone();
                }
                view.sender_phone = who.phone.clone();
            }
            messages.push(view);
        }
        Ok(messages)
    }

    /// The encoded media message of one message, for downloading its attachment.
    pub fn media_proto(&self, chat_id: &str, id: &str) -> rusqlite::Result<Option<Vec<u8>>> {
        Ok(self
            .conn
            .query_row(
                "SELECT media_proto FROM messages WHERE chat_id = ?1 AND id = ?2",
                params![chat_id, id],
                |r| r.get::<_, Option<Vec<u8>>>(0),
            )
            .optional()?
            .flatten())
    }

    /// The oldest stored message of a chat: the anchor for asking the phone for more.
    pub fn oldest_message(&self, chat_id: &str) -> rusqlite::Result<Option<(String, bool, i64)>> {
        self.conn
            .query_row(
                "SELECT id, from_me, timestamp FROM messages WHERE chat_id = ?1 ORDER BY timestamp ASC LIMIT 1",
                params![chat_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
    }

    /// Runs `f` in one transaction: a history chunk holds thousands of rows.
    pub fn batch<T>(
        &mut self,
        f: impl FnOnce(&ChatDb) -> rusqlite::Result<T>,
    ) -> rusqlite::Result<T> {
        self.conn.execute_batch("BEGIN")?;
        match f(self) {
            Ok(value) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
}

/// The chat-list line for a message.
pub fn preview(kind: MessageKind, body: &str, media_kind: Option<&str>) -> String {
    let label = match media_kind {
        Some("image") => "📷 Photo",
        Some("video") => "🎥 Video",
        Some("ptt") => "🎤 Voice message",
        Some("audio") => "🎵 Audio",
        Some("document") => "📄 Document",
        Some("sticker") => "Sticker",
        _ => "📎 Media",
    };
    match kind {
        MessageKind::Text => body.to_string(),
        MessageKind::Media if body.is_empty() => label.to_string(),
        MessageKind::Media => format!("{} {body}", label.split(' ').next().unwrap_or("")),
        MessageKind::Unsupported => "Unsupported message".to_string(),
    }
}

fn thumbnail_url(bytes: &[u8]) -> String {
    format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// "+62…" from a phone-number id.
fn phone_of(pn: &str) -> String {
    let user = pn.split('@').next().unwrap_or(pn);
    format!("+{}", user.split(':').next().unwrap_or(user))
}

/// What a chat is called until a name is known.
fn fallback_name(id: &str) -> String {
    if id.ends_with("@s.whatsapp.net") {
        phone_of(id)
    } else {
        id.split('@').next().unwrap_or(id).to_string()
    }
}

fn kind_str(kind: MessageKind) -> &'static str {
    match kind {
        MessageKind::Text => "text",
        MessageKind::Media => "media",
        MessageKind::Unsupported => "unsupported",
    }
}

fn kind_from(kind: &str) -> MessageKind {
    match kind {
        "text" => MessageKind::Text,
        "media" => MessageKind::Media,
        _ => MessageKind::Unsupported,
    }
}
