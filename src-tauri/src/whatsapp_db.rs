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

use crate::whatsapp::{
    ChannelReaction, ChatInfo, EditView, MediaInfo, MessageKind, MessageView, PreviewInfo,
    ReplyView,
};

/// Bumped with every schema change; `open` migrates older files up to it.
const SCHEMA_VERSION: i64 = 12;

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
    pub quote: Option<QuoteRef>,
    pub album: Option<String>,
}

/// The message a reply quotes. `sender` and `text` are what the reply itself carried, used
/// when the quoted message isn't stored here.
pub struct QuoteRef {
    pub id: String,
    pub sender: String,
    pub text: String,
}

impl QuoteRef {
    /// A quote of one of my own stored messages, resolved from the database when read.
    pub fn by_id(id: &str) -> Self {
        Self {
            id: id.to_string(),
            sender: String::new(),
            text: String::new(),
        }
    }
}

/// What a message action (react, pin, quote, forward) needs about its target.
pub struct MessageTarget {
    pub from_me: bool,
    pub sender_id: String,
    pub body: String,
    /// The encoded media message, when the target has an attachment.
    pub media_proto: Option<Vec<u8>>,
    /// The server-assigned id of a channel message, when it was seen live.
    pub server_id: Option<i64>,
}

/// A chat label (WhatsApp "etiqueta"), as cached from app-state sync.
pub struct LabelRow {
    pub id: String,
    pub name: String,
    /// WhatsApp color index, not a hex value.
    pub color: i64,
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
        if version < 3 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS labels (
                     id TEXT PRIMARY KEY,
                     name TEXT NOT NULL,
                     color INTEGER NOT NULL DEFAULT 0,
                     deleted INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE TABLE IF NOT EXISTS chat_labels (
                     label_id TEXT NOT NULL,
                     chat_id TEXT NOT NULL,
                     labeled INTEGER NOT NULL,
                     PRIMARY KEY (label_id, chat_id)
                 );
                 CREATE INDEX IF NOT EXISTS chat_labels_by_chat ON chat_labels (chat_id);",
            )?;
        }
        if version < 4 {
            // Messages stored before receipts were tracked count as sent.
            conn.execute_batch(
                "ALTER TABLE messages ADD COLUMN ack INTEGER NOT NULL DEFAULT 1;
                 CREATE INDEX IF NOT EXISTS messages_by_id ON messages (id);",
            )?;
        }
        if version < 5 {
            // A message deleted for everyone keeps its content, marked with when it went;
            // an edited one keeps every earlier text in `message_edits`.
            conn.execute_batch(
                "ALTER TABLE messages ADD COLUMN revoked_at INTEGER;
                 ALTER TABLE messages ADD COLUMN edited_at INTEGER;
                 CREATE TABLE IF NOT EXISTS message_edits (
                     chat_id TEXT NOT NULL,
                     id TEXT NOT NULL,
                     body TEXT NOT NULL,
                     replaced_at INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS message_edits_by_msg ON message_edits (chat_id, id);",
            )?;
        }
        if version < 6 {
            // When each recipient got, read or played a message of mine (one row per
            // recipient and level). Only receipts seen from now on are recorded.
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS receipts (
                     message_id TEXT NOT NULL,
                     recipient TEXT NOT NULL,
                     ack INTEGER NOT NULL,
                     at INTEGER NOT NULL,
                     PRIMARY KEY (message_id, recipient, ack)
                 );",
            )?;
        }
        if version < 7 {
            // A channel message is reacted to by the id the server gave it, not its message id.
            conn.execute_batch("ALTER TABLE messages ADD COLUMN server_id INTEGER;")?;
        }
        if version < 8 {
            // Reaction totals on channel messages, as the server last reported them.
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS channel_reactions (
                     chat_id TEXT NOT NULL,
                     id TEXT NOT NULL,
                     emoji TEXT NOT NULL,
                     count INTEGER NOT NULL,
                     PRIMARY KEY (chat_id, id, emoji)
                 );",
            )?;
        }
        if version < 9 {
            conn.execute_batch(
                "ALTER TABLE messages ADD COLUMN quote_id TEXT;
                 ALTER TABLE messages ADD COLUMN quote_sender TEXT;
                 ALTER TABLE messages ADD COLUMN quote_text TEXT;",
            )?;
        }
        if version < 10 {
            conn.execute_batch("ALTER TABLE messages ADD COLUMN album_id TEXT;")?;
        }
        if version < 11 {
            // The link preview WhatsApp embedded in a message: the first URL plus the title,
            // description and a small JPEG thumbnail, all copied from the message proto.
            conn.execute_batch(
                "ALTER TABLE messages ADD COLUMN preview_url TEXT;
                 ALTER TABLE messages ADD COLUMN preview_title TEXT;
                 ALTER TABLE messages ADD COLUMN preview_description TEXT;
                 ALTER TABLE messages ADD COLUMN preview_image TEXT;",
            )?;
        }
        if version < 12 {
            // Chat mutes mirrored from the phone: `until` is epoch ms, -1 for good, 0 unmuted.
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS mutes (id TEXT PRIMARY KEY, until INTEGER NOT NULL);",
            )?;
        }
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
        // Statuses are stored as messages under `status@broadcast`, not as a chat; drop any
        // row an earlier build created for it.
        conn.execute("DELETE FROM chats WHERE id = 'status@broadcast'", [])?;
        Self::repair_implausible_chats(&conn)?;
        Ok(Self { conn })
    }

    /// Rebuilds chats whose position a bad history timestamp corrupted. The phone can
    /// report a conversation time far in the future, which pins the chat to the top and —
    /// since a preview only moves forward — freezes its last message for good. Recompute
    /// the summary from the messages actually stored; a chat with none drops back to 0.
    fn repair_implausible_chats(conn: &Connection) -> rusqlite::Result<()> {
        let cap = now_millis() + FUTURE_SLACK_MS;
        let mut stmt = conn.prepare("SELECT id FROM chats WHERE last_timestamp > ?1")?;
        let ids: Vec<String> = stmt
            .query_map(params![cap], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        for id in ids {
            let newest = conn
                .query_row(
                    "SELECT kind, body, media_kind, timestamp, from_me, sender_id, sender_name,
                            revoked_at IS NOT NULL
                     FROM messages WHERE chat_id = ?1 AND timestamp <= ?2
                     ORDER BY timestamp DESC LIMIT 1",
                    params![id, cap],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, Option<String>>(2)?,
                            r.get::<_, i64>(3)?,
                            r.get::<_, bool>(4)?,
                            r.get::<_, String>(5)?,
                            r.get::<_, String>(6)?,
                            r.get::<_, bool>(7)?,
                        ))
                    },
                )
                .optional()?;
            match newest {
                Some((
                    kind,
                    body,
                    media_kind,
                    timestamp,
                    from_me,
                    sender_id,
                    sender_name,
                    revoked,
                )) => {
                    let text = if revoked {
                        "🚫 This message was deleted".to_string()
                    } else {
                        preview(kind_from(&kind), &body, media_kind.as_deref())
                    };
                    conn.execute(
                        "UPDATE chats SET last_text = ?2, last_timestamp = ?3, last_from_me = ?4,
                             last_sender_id = ?5, last_sender = ?6 WHERE id = ?1",
                        params![id, text, timestamp, from_me, sender_id, sender_name],
                    )?;
                }
                None => {
                    conn.execute(
                        "UPDATE chats SET last_timestamp = 0 WHERE id = ?1",
                        params![id],
                    )?;
                }
            }
        }
        Ok(())
    }

    /// Forgets everything, for a device that was logged out and will pair afresh.
    pub fn clear(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "DELETE FROM chats; DELETE FROM messages; DELETE FROM message_edits; DELETE FROM names; DELETE FROM lid_pn; DELETE FROM mutes;",
        )
    }

    /// Records a chat's mute state (see the `mutes` table).
    pub fn set_mute(&self, id: &str, until: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO mutes (id, until) VALUES (?1, ?2) ON CONFLICT (id) DO UPDATE SET until = excluded.until",
            params![id, until],
        )?;
        Ok(())
    }

    /// The recorded mute of a chat, found under its phone-number or privacy id alike.
    fn mute_for(&self, id: &str) -> rusqlite::Result<Option<i64>> {
        let pn = self.pn_for(id)?;
        let lid = self.lid_for(id)?;
        for candidate in [Some(id), pn.as_deref(), lid.as_deref()]
            .into_iter()
            .flatten()
        {
            let found = self
                .conn
                .query_row(
                    "SELECT until FROM mutes WHERE id = ?1",
                    params![candidate],
                    |r| r.get::<_, i64>(0),
                )
                .optional()?;
            if found.is_some() {
                return Ok(found);
            }
        }
        Ok(None)
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
                 media_kind, mimetype, file_name, file_size, seconds, width, height, thumbnail, media_proto, ack,
                 quote_id, quote_sender, quote_text, album_id,
                 preview_url, preview_title, preview_description, preview_image)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)",
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
                v.ack,
                msg.quote.as_ref().map(|q| q.id.as_str()),
                msg.quote.as_ref().map(|q| q.sender.as_str()),
                msg.quote.as_ref().map(|q| q.text.as_str()),
                msg.album,
                v.preview.as_ref().map(|p| p.url.as_str()),
                v.preview.as_ref().and_then(|p| p.title.as_deref()),
                v.preview.as_ref().and_then(|p| p.description.as_deref()),
                v.preview.as_ref().and_then(|p| p.image.as_deref()),
            ],
        )? > 0;
        if !inserted {
            // A history resend may know a later delivery state than what was stored.
            if v.from_me {
                self.conn.execute(
                    "UPDATE messages SET ack = ?3 WHERE chat_id = ?1 AND id = ?2 AND ack < ?3",
                    params![v.chat_id, v.id, v.ack],
                )?;
            }
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
            // Likewise fill in a link preview when a later copy of the message carries one.
            if let Some(p) = &v.preview {
                self.conn.execute(
                    "UPDATE messages SET preview_url = ?3, preview_title = ?4, preview_description = ?5, preview_image = ?6
                     WHERE chat_id = ?1 AND id = ?2 AND preview_url IS NULL",
                    params![
                        v.chat_id,
                        v.id,
                        p.url.as_str(),
                        p.title.as_deref(),
                        p.description.as_deref(),
                        p.image.as_deref(),
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
        // A corrupt future message time must not pin the chat to the top (see
        // `repair_implausible_chats`); the message itself is still stored as received.
        let chat_ts = v.timestamp.min(now_millis() + FUTURE_SLACK_MS);
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
                chat_ts,
                v.from_me,
                msg.sender_id,
                v.sender_name,
                if count_unread && !v.from_me { 1 } else { 0 }
            ],
        )?;
        Ok(true)
    }

    /// Moves my messages with these ids forward to `ack` (never back). Matched by id alone:
    /// a receipt may name the chat by phone number or privacy id, whichever the chat isn't
    /// stored under. Returns whether any message changed.
    pub fn raise_ack(&self, ids: &[String], ack: u8) -> rusqlite::Result<bool> {
        let mut stmt = self
            .conn
            .prepare("UPDATE messages SET ack = ?2 WHERE id = ?1 AND from_me = 1 AND ack < ?2")?;
        let mut changed = false;
        for id in ids {
            changed |= stmt.execute(params![id, ack])? > 0;
        }
        Ok(changed)
    }

    /// Records when `recipient` reached `ack` (2 delivered, 3 read, 4 played) for each id.
    /// A later level implies the earlier ones, so those are filled in when missing.
    pub fn add_receipts(
        &self,
        ids: &[String],
        recipient: &str,
        ack: u8,
        at: i64,
    ) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare(
            "INSERT OR IGNORE INTO receipts (message_id, recipient, ack, at) VALUES (?1, ?2, ?3, ?4)",
        )?;
        for id in ids {
            for level in 2..=ack {
                stmt.execute(params![id, recipient, level, at])?;
            }
        }
        Ok(())
    }

    /// Per recipient: (recipient, ack, unix ms), ordered by time.
    pub fn receipts_for(&self, id: &str) -> rusqlite::Result<Vec<(String, u8, i64)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT recipient, ack, at FROM receipts WHERE message_id = ?1 ORDER BY at")?;
        let rows = stmt.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect()
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

    /// Applies a read state another device synced for a chat. The chat may be stored under
    /// its phone-number or privacy id, so every alias is updated; "unread" only flags a chat
    /// that has no count yet. Returns whether anything changed.
    pub fn set_read_from_device(&self, id: &str, read: bool) -> rusqlite::Result<bool> {
        let ids = [Some(id.to_string()), self.pn_for(id)?, self.lid_for(id)?];
        let sql = if read {
            "UPDATE chats SET unread = 0 WHERE id = ?1 AND unread > 0"
        } else {
            "UPDATE chats SET unread = 1 WHERE id = ?1 AND unread = 0"
        };
        let mut changed = false;
        for id in ids.iter().flatten() {
            changed |= self.conn.execute(sql, params![id])? > 0;
        }
        Ok(changed)
    }

    pub fn mark_all_read(&self) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE chats SET unread = 0 WHERE unread > 0", [])?;
        Ok(())
    }

    /// Removes a chat with its messages, edit history and label links from this device.
    pub fn delete_chat(&self, chat_id: &str) -> rusqlite::Result<()> {
        for sql in [
            "DELETE FROM messages WHERE chat_id = ?1",
            "DELETE FROM message_edits WHERE chat_id = ?1",
            "DELETE FROM chat_labels WHERE chat_id = ?1",
            "DELETE FROM chats WHERE id = ?1",
        ] {
            self.conn.execute(sql, params![chat_id])?;
        }
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

    /// The privacy id of a user, if known: itself, or what its phone number maps to.
    pub fn lid_for(&self, id: &str) -> rusqlite::Result<Option<String>> {
        if id.ends_with("@lid") {
            return Ok(Some(id.to_string()));
        }
        self.conn
            .query_row(
                "SELECT lid FROM lid_pn WHERE pn = ?1 LIMIT 1",
                params![id],
                |r| r.get(0),
            )
            .optional()
    }

    pub fn chats(&self) -> rusqlite::Result<Vec<ChatInfo>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, fallback_name, last_text, last_timestamp, last_from_me, last_sender_id, last_sender, unread,
                    (SELECT ack FROM messages m WHERE m.chat_id = chats.id AND m.from_me = 1
                     ORDER BY m.timestamp DESC LIMIT 1)
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
                r.get::<_, Option<u8>>(8)?,
            ))
        })?;
        let mut senders: HashMap<String, Resolved> = HashMap::new();
        let mut chats = Vec::new();
        for row in rows {
            let (
                id,
                fallback,
                last_text,
                last_timestamp,
                last_from_me,
                sender_id,
                sender,
                unread,
                last_ack,
            ) = row?;
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
            let muted_until = self.mute_for(&id)?;
            chats.push(ChatInfo {
                muted_until,
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
                last_ack: last_ack.unwrap_or(1),
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

    /// Labels that are not deleted, by name.
    pub fn labels(&self) -> rusqlite::Result<Vec<LabelRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, color FROM labels WHERE deleted = 0 ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(LabelRow {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
            })
        })?;
        rows.collect()
    }

    /// Every (chat id, label id) association that is active.
    pub fn all_chat_labels(&self) -> rusqlite::Result<Vec<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT chat_id, label_id FROM chat_labels WHERE labeled = 1")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        rows.collect()
    }

    /// Ids of the labels currently on a chat.
    pub fn chat_labels(&self, chat_id: &str) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT label_id FROM chat_labels WHERE chat_id = ?1 AND labeled = 1")?;
        let rows = stmt.query_map(params![chat_id], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    /// Records a label from app-state sync (create, rename, recolor, or delete).
    pub fn upsert_label(
        &self,
        id: &str,
        name: &str,
        color: i64,
        deleted: bool,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO labels (id, name, color, deleted) VALUES (?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, deleted=excluded.deleted",
            params![id, name, color, deleted],
        )?;
        Ok(())
    }

    /// Drops a label and its chat associations.
    pub fn delete_label(&self, id: &str) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM chat_labels WHERE label_id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM labels WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Associates or dissociates a label and a chat.
    pub fn set_chat_label(
        &self,
        label_id: &str,
        chat_id: &str,
        labeled: bool,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO chat_labels (label_id, chat_id, labeled) VALUES (?1,?2,?3)
             ON CONFLICT(label_id, chat_id) DO UPDATE SET labeled=excluded.labeled",
            params![label_id, chat_id, labeled],
        )?;
        Ok(())
    }

    /// Ids of channel (newsletter) chats, newest first — so their names can be fetched.
    pub fn newsletter_ids(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM chats WHERE id LIKE '%@newsletter' ORDER BY last_timestamp DESC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    /// Sender and id of the newest incoming messages, newest first: what a read receipt covers.
    pub fn incoming_ids(
        &self,
        chat_id: &str,
        limit: u32,
    ) -> rusqlite::Result<Vec<(String, String)>> {
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
                    ack: 0,
                    revoked_at: None,
                    edited_at: None,
                    edits: Vec::new(),
                    channel_reactions: Vec::new(),
                    reply_to: None,
                    album_id: None,
                    preview: None,
                },
            ))
        })?;
        let mut statuses: Vec<(String, MessageView)> = rows.collect::<rusqlite::Result<_>>()?;
        // Prefer the name saved for the poster over the push name the status carried.
        let mut seen: HashMap<String, Resolved> = HashMap::new();
        for (sender, view) in &mut statuses {
            if view.from_me || sender.is_empty() {
                continue;
            }
            if !seen.contains_key(sender.as_str()) {
                seen.insert(sender.clone(), self.resolve(sender)?);
            }
            let who = &seen[sender.as_str()];
            if let Some((name, _)) = &who.name {
                view.sender_name = name.clone();
            }
            if view.sender_name.is_empty() {
                view.sender_name = who.phone.clone().unwrap_or_default();
            }
            view.sender_phone = who.phone.clone();
        }
        Ok(statuses)
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
                        media_kind, mimetype, file_name, file_size, seconds, width, height, thumbnail, ack,
                        revoked_at, edited_at, quote_id, quote_sender, quote_text, album_id,
                        preview_url, preview_title, preview_description, preview_image
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
            let quote = r
                .get::<_, Option<String>>(19)?
                .map(|id| -> rusqlite::Result<QuoteRef> {
                    Ok(QuoteRef {
                        id,
                        sender: r.get::<_, Option<String>>(20)?.unwrap_or_default(),
                        text: r.get::<_, Option<String>>(21)?.unwrap_or_default(),
                    })
                })
                .transpose()?;
            let preview = match r.get::<_, Option<String>>(23)? {
                Some(url) => Some(PreviewInfo {
                    url,
                    title: r.get(24)?,
                    description: r.get(25)?,
                    image: r.get(26)?,
                }),
                None => None,
            };
            Ok((
                r.get::<_, String>(3)?,
                quote,
                r.get::<_, Option<String>>(22)?,
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
                    ack: r.get(16)?,
                    revoked_at: r.get(17)?,
                    edited_at: r.get(18)?,
                    edits: Vec::new(),
                    channel_reactions: Vec::new(),
                    reply_to: None,
                    album_id: None,
                    preview,
                },
            ))
        })?;
        let mut senders: HashMap<String, Resolved> = HashMap::new();
        let mut messages = Vec::new();
        let mut edits = self.edits(chat_id)?;
        let mut channel_reactions = if chat_id.ends_with("@newsletter") {
            self.channel_reactions(chat_id)?
        } else {
            HashMap::new()
        };
        for row in rows {
            let (sender_id, quote, album_id, mut view) = row?;
            view.album_id = album_id;
            view.reply_to = quote.map(|q| self.reply_view(chat_id, q)).transpose()?;
            if let Some(reactions) = channel_reactions.remove(&view.id) {
                view.channel_reactions = reactions;
            }
            if view.edited_at.is_some() {
                view.edits = edits.remove(&view.id).unwrap_or_default();
            }
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

    /// What to show for a quoted message: the stored copy when there is one, else what
    /// the reply itself carried.
    fn reply_view(&self, chat_id: &str, quote: QuoteRef) -> rusqlite::Result<ReplyView> {
        let stored = self
            .conn
            .query_row(
                "SELECT from_me, sender_id, sender_name, kind, body, media_kind
                 FROM messages WHERE chat_id = ?1 AND id = ?2",
                params![chat_id, quote.id],
                |r| {
                    Ok((
                        r.get::<_, bool>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .optional()?;
        let (from_me, sender_id, push_name, text) = match stored {
            Some((from_me, sender_id, push_name, kind, body, media_kind)) => (
                from_me,
                sender_id,
                push_name,
                preview(kind_from(&kind), &body, media_kind.as_deref()),
            ),
            None => (false, quote.sender, String::new(), quote.text),
        };
        let sender_name = if from_me {
            String::new()
        } else if sender_id.is_empty() {
            push_name
        } else {
            let who = self.resolve(&sender_id)?;
            match who.name {
                Some((name, _)) => name,
                None if !push_name.is_empty() => push_name,
                // Unnamed: show the phone number a privacy id maps to, not the id itself.
                None => who.phone.unwrap_or_else(|| fallback_name(&sender_id)),
            }
        };
        Ok(ReplyView {
            id: quote.id,
            from_me,
            sender_name,
            text,
        })
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

    /// Remembers a channel message's server id, which reactions are keyed by.
    pub fn set_server_id(&self, chat_id: &str, id: &str, server_id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE messages SET server_id = ?3 WHERE chat_id = ?1 AND id = ?2",
            params![chat_id, id, server_id],
        )?;
        Ok(())
    }

    /// The lowest server id stored for a channel: where the next older page starts.
    pub fn oldest_server_id(&self, chat_id: &str) -> rusqlite::Result<Option<i64>> {
        self.conn.query_row(
            "SELECT MIN(server_id) FROM messages WHERE chat_id = ?1",
            params![chat_id],
            |r| r.get(0),
        )
    }

    /// Replaces the reaction totals of one channel message.
    pub fn set_channel_reactions(
        &self,
        chat_id: &str,
        id: &str,
        reactions: &[(String, u64)],
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM channel_reactions WHERE chat_id = ?1 AND id = ?2",
            params![chat_id, id],
        )?;
        for (emoji, count) in reactions {
            self.conn.execute(
                "INSERT OR REPLACE INTO channel_reactions (chat_id, id, emoji, count) VALUES (?1, ?2, ?3, ?4)",
                params![chat_id, id, emoji, *count as i64],
            )?;
        }
        Ok(())
    }

    /// Reaction totals of a channel's messages, by message id.
    fn channel_reactions(
        &self,
        chat_id: &str,
    ) -> rusqlite::Result<HashMap<String, Vec<ChannelReaction>>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, emoji, count FROM channel_reactions WHERE chat_id = ?1 ORDER BY count DESC",
        )?;
        let rows = stmt.query_map(params![chat_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                ChannelReaction {
                    emoji: r.get(1)?,
                    count: r.get::<_, i64>(2)? as u64,
                },
            ))
        })?;
        let mut map: HashMap<String, Vec<ChannelReaction>> = HashMap::new();
        for row in rows {
            let (id, reaction) = row?;
            map.entry(id).or_default().push(reaction);
        }
        Ok(map)
    }

    /// What a message action needs about one stored message.
    pub fn message_target(
        &self,
        chat_id: &str,
        id: &str,
    ) -> rusqlite::Result<Option<MessageTarget>> {
        self.conn
            .query_row(
                "SELECT from_me, sender_id, body, media_proto, server_id FROM messages WHERE chat_id = ?1 AND id = ?2",
                params![chat_id, id],
                |r| {
                    Ok(MessageTarget {
                        from_me: r.get(0)?,
                        sender_id: r.get(1)?,
                        body: r.get(2)?,
                        media_proto: r.get(3)?,
                        server_id: r.get(4)?,
                    })
                },
            )
            .optional()
    }

    /// Replaces a stored message's text after an edit, keeping the text it had before.
    /// Returns the chat the message is stored under, if it is stored. An edit may name the
    /// chat by the other id (phone number or privacy id), so it falls back to the id alone.
    pub fn edit_message(
        &self,
        chat_id: &str,
        id: &str,
        body: &str,
        at: i64,
    ) -> rusqlite::Result<Option<String>> {
        let Some((chat_id, old)) = self.locate(chat_id, id)? else {
            return Ok(None);
        };
        if old != body {
            self.conn.execute(
                "INSERT INTO message_edits (chat_id, id, body, replaced_at) VALUES (?1, ?2, ?3, ?4)",
                params![chat_id, id, old, at],
            )?;
            self.conn.execute(
                "UPDATE messages SET body = ?3, edited_at = ?4 WHERE chat_id = ?1 AND id = ?2",
                params![chat_id, id, body, at],
            )?;
            self.refresh_preview(&chat_id, id)?;
        }
        Ok(Some(chat_id))
    }

    /// Marks a message deleted for everyone, keeping what it said. Returns the chat it is
    /// stored under, if it is stored.
    pub fn revoke_message(
        &self,
        chat_id: &str,
        id: &str,
        at: i64,
    ) -> rusqlite::Result<Option<String>> {
        let Some((chat_id, _)) = self.locate(chat_id, id)? else {
            return Ok(None);
        };
        self.conn.execute(
            "UPDATE messages SET revoked_at = ?3 WHERE chat_id = ?1 AND id = ?2 AND revoked_at IS NULL",
            params![chat_id, id, at],
        )?;
        self.refresh_preview(&chat_id, id)?;
        Ok(Some(chat_id))
    }

    /// The chat a message is stored under, and its text.
    fn locate(&self, chat_id: &str, id: &str) -> rusqlite::Result<Option<(String, String)>> {
        let exact = self
            .conn
            .query_row(
                "SELECT chat_id, body FROM messages WHERE chat_id = ?1 AND id = ?2",
                params![chat_id, id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if exact.is_some() {
            return Ok(exact);
        }
        self.conn
            .query_row(
                "SELECT chat_id, body FROM messages WHERE id = ?1 LIMIT 1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
    }

    /// Rewrites the chat-list line when the message it shows was edited or deleted.
    fn refresh_preview(&self, chat_id: &str, id: &str) -> rusqlite::Result<()> {
        let row = self
            .conn
            .query_row(
                "SELECT kind, body, media_kind, timestamp, revoked_at IS NOT NULL FROM messages
                 WHERE chat_id = ?1 AND id = ?2",
                params![chat_id, id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, bool>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((kind, body, media_kind, timestamp, revoked)) = row else {
            return Ok(());
        };
        let text = if revoked {
            "🚫 This message was deleted".to_string()
        } else {
            preview(kind_from(&kind), &body, media_kind.as_deref())
        };
        self.conn.execute(
            "UPDATE chats SET last_text = ?2 WHERE id = ?1 AND last_timestamp = ?3",
            params![chat_id, text, timestamp],
        )?;
        Ok(())
    }

    /// Earlier texts of a chat's edited messages, by message id, oldest first.
    fn edits(&self, chat_id: &str) -> rusqlite::Result<HashMap<String, Vec<EditView>>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, body, replaced_at FROM message_edits WHERE chat_id = ?1 ORDER BY replaced_at ASC",
        )?;
        let rows = stmt.query_map(params![chat_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                EditView {
                    body: r.get(1)?,
                    replaced_at: r.get(2)?,
                },
            ))
        })?;
        let mut out: HashMap<String, Vec<EditView>> = HashMap::new();
        for row in rows {
            let (id, edit) = row?;
            out.entry(id).or_default().push(edit);
        }
        Ok(out)
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

/// A conversation timestamp this far past the local clock is the phone's corruption, not a
/// real time (see `ChatDb::repair_implausible_chats`).
const FUTURE_SLACK_MS: i64 = 24 * 60 * 60 * 1000;

/// Epoch milliseconds.
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(name: &str) -> (ChatDb, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("wahana-{name}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        (ChatDb::open(&path).unwrap(), path)
    }

    fn add_message(db: &ChatDb, chat: &str, id: &str, body: &str, timestamp: i64) {
        db.conn
            .execute(
                "INSERT INTO messages (chat_id, id, from_me, sender_id, sender_name, kind, body, timestamp)
                 VALUES (?1, ?2, 0, 'a@c.us', 'A', 'text', ?3, ?4)",
                params![chat, id, body, timestamp],
            )
            .unwrap();
    }

    fn last(db: &ChatDb, chat: &str) -> (String, i64) {
        db.conn
            .query_row(
                "SELECT last_text, last_timestamp FROM chats WHERE id = ?1",
                params![chat],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
    }

    #[test]
    fn repair_rebuilds_future_chat_from_real_messages() {
        let (db, path) = temp_db("repair");
        let now = now_millis();
        let future = now + 30 * 24 * 60 * 60 * 1000;
        db.ensure_chat("x@c.us", future, 0).unwrap();
        add_message(&db, "x@c.us", "1", "old", now - 5000);
        add_message(&db, "x@c.us", "2", "newest real", now - 1000);
        add_message(&db, "x@c.us", "3", "corrupt", future);
        db.ensure_chat("empty@c.us", future, 0).unwrap();
        drop(db);

        let db = ChatDb::open(&path).unwrap();
        assert_eq!(last(&db, "x@c.us"), ("newest real".to_string(), now - 1000));
        assert_eq!(last(&db, "empty@c.us").1, 0);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn device_read_state_clears_and_flags_unread() {
        let (db, path) = temp_db("read");
        db.ensure_chat("g@g.us", 1, 4).unwrap();
        assert!(db.set_read_from_device("g@g.us", true).unwrap());
        assert!(!db.set_read_from_device("g@g.us", true).unwrap());
        assert!(db.set_read_from_device("g@g.us", false).unwrap());
        assert_eq!(db.unread_chats(), 1);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn repair_leaves_plausible_chats_alone() {
        let (db, path) = temp_db("keep");
        let now = now_millis();
        db.ensure_chat("ok@c.us", now, 0).unwrap();
        drop(db);
        let db = ChatDb::open(&path).unwrap();
        assert_eq!(last(&db, "ok@c.us").1, now);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
