import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  ChatOverview,
  Contact,
  GowsGroup,
  GroupInfo,
  JoinRequest,
  MeInfo,
  PresenceInfo,
  ServerVersion,
  SessionInfo,
  WAMessage,
} from "./types";

export class WahaError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "WahaError";
  }
}

export interface WahaConfig {
  baseUrl: string;
  apiKey: string;
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

function qs(params?: Query) {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/**
 * Thin typed client over the WAHA HTTP API.
 * Uses the Tauri HTTP plugin so requests bypass webview CORS restrictions.
 */
export class WahaClient {
  constructor(private cfg: WahaConfig) {}

  get baseUrl() {
    return this.cfg.baseUrl.replace(/\/+$/, "");
  }

  get wsUrl() {
    return this.baseUrl.replace(/^http/, "ws") + "/ws";
  }

  get apiKey() {
    return this.cfg.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; raw?: boolean } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}${qs(opts.query)}`;
    const res = await tauriFetch(url, {
      method,
      headers: {
        "X-Api-Key": this.cfg.apiKey,
        Accept: opts.raw ? "*/*" : "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let body: unknown;
      let msg = `${res.status} ${res.statusText}`;
      try {
        body = await res.json();
        const m = (body as { message?: string | string[] })?.message;
        if (m) msg = Array.isArray(m) ? m.join(", ") : m;
      } catch {
        /* non-JSON error */
      }
      throw new WahaError(res.status, msg, body);
    }
    if (opts.raw) return (await res.arrayBuffer()) as unknown as T;
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T; // a few endpoints answer with plain text (e.g. invite links)
    }
  }

  private get<T>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }
  private post<T>(path: string, body?: unknown, query?: Query) {
    return this.request<T>("POST", path, { body, query });
  }
  private put<T>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body });
  }
  private del<T>(path: string) {
    return this.request<T>("DELETE", path);
  }

  // ── Server ────────────────────────────────────────────────────────────
  serverVersion() {
    return this.get<ServerVersion>("/api/server/version");
  }

  // ── Sessions ──────────────────────────────────────────────────────────
  listSessions(all = true) {
    return this.get<SessionInfo[]>("/api/sessions", { all });
  }
  getSession(name: string) {
    return this.get<SessionInfo>(`/api/sessions/${enc(name)}`);
  }
  createSession(name: string, start = true) {
    return this.post<SessionInfo>("/api/sessions", { name, start });
  }
  startSession(name: string) {
    return this.post<SessionInfo>(`/api/sessions/${enc(name)}/start`);
  }
  stopSession(name: string) {
    return this.post<SessionInfo>(`/api/sessions/${enc(name)}/stop`);
  }
  restartSession(name: string) {
    return this.post<SessionInfo>(`/api/sessions/${enc(name)}/restart`);
  }
  logoutSession(name: string) {
    return this.post<SessionInfo>(`/api/sessions/${enc(name)}/logout`);
  }
  deleteSession(name: string) {
    return this.del<void>(`/api/sessions/${enc(name)}`);
  }
  me(session: string) {
    return this.get<MeInfo>(`/api/sessions/${enc(session)}/me`);
  }

  // ── My profile ────────────────────────────────────────────────────────
  myProfile(session: string) {
    return this.get<{ id: string; name: string; picture: string | null; status?: string | null }>(`/api/${enc(session)}/profile`);
  }
  setProfileName(session: string, name: string) {
    return this.put<void>(`/api/${enc(session)}/profile/name`, { name });
  }
  setProfileStatus(session: string, status: string) {
    return this.put<void>(`/api/${enc(session)}/profile/status`, { status });
  }
  setProfilePicture(session: string, file: { mimetype: string; filename: string; data: string }) {
    return this.put<void>(`/api/${enc(session)}/profile/picture`, { file });
  }
  deleteProfilePicture(session: string) {
    return this.del<void>(`/api/${enc(session)}/profile/picture`);
  }

  // ── Status (stories) ──────────────────────────────────────────────────
  statusMessages(session: string, limit = 300) {
    return this.messages(session, "status@broadcast", { limit, downloadMedia: false });
  }
  postTextStatus(session: string, text: string, backgroundColor = "#128c7e", font = 0) {
    return this.post<unknown>(`/api/${enc(session)}/status/text`, { text, backgroundColor, font });
  }
  postImageStatus(session: string, file: { mimetype: string; filename: string; data: string }, caption?: string) {
    return this.post<unknown>(`/api/${enc(session)}/status/image`, { file, caption });
  }
  postVideoStatus(session: string, file: { mimetype: string; filename: string; data: string }, caption?: string) {
    return this.post<unknown>(`/api/${enc(session)}/status/video`, { file, caption, convert: true });
  }
  deleteStatus(session: string, id: string) {
    return this.post<unknown>(`/api/${enc(session)}/status/delete`, { id });
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  /** Returns PNG bytes of the QR code. */
  qrImage(session: string) {
    return this.request<ArrayBuffer>("GET", `/api/${enc(session)}/auth/qr`, {
      query: { format: "image" },
      raw: true,
    });
  }
  requestPairingCode(session: string, phoneNumber: string) {
    return this.post<{ code: string }>(`/api/${enc(session)}/auth/request-code`, {
      phoneNumber,
    });
  }

  // ── Chats ─────────────────────────────────────────────────────────────
  chatsOverview(session: string, limit = 50, offset = 0) {
    return this.get<ChatOverview[]>(`/api/${enc(session)}/chats/overview`, {
      limit,
      offset,
    });
  }
  chatPicture(session: string, chatId: string) {
    return this.get<{ url: string | null }>(
      `/api/${enc(session)}/chats/${enc(chatId)}/picture`,
    );
  }
  messages(
    session: string,
    chatId: string,
    opts: {
      limit?: number;
      offset?: number;
      before?: number;
      /** Unix seconds; with `sortOrder: "asc"` this pages forward in time. */
      after?: number;
      sortOrder?: "asc" | "desc";
      downloadMedia?: boolean;
      /** Only pre-download media whose mimetype starts with one of these. */
      downloadMediaMimetypes?: string[];
    } = {},
  ) {
    return this.get<WAMessage[]>(`/api/${enc(session)}/chats/${enc(chatId)}/messages`, {
      limit: opts.limit ?? 50,
      offset: opts.offset,
      downloadMedia: opts.downloadMedia ?? true,
      downloadMediaMimetypes: opts.downloadMediaMimetypes?.length ? opts.downloadMediaMimetypes : undefined,
      "filter.timestamp.lte": opts.before,
      "filter.timestamp.gte": opts.after,
      sortBy: opts.sortOrder ? "timestamp" : undefined,
      sortOrder: opts.sortOrder,
    });
  }
  /** Single message; with downloadMedia the server fetches the media and fills `media.url`. */
  getMessage(session: string, chatId: string, messageId: string, downloadMedia = true) {
    return this.get<WAMessage>(
      `/api/${enc(session)}/chats/${enc(chatId)}/messages/${enc(messageId)}`,
      { downloadMedia },
    );
  }
  markRead(session: string, chatId: string) {
    return this.post<{ ids?: string[] }>(
      `/api/${enc(session)}/chats/${enc(chatId)}/messages/read`,
    );
  }
  deleteMessage(session: string, chatId: string, messageId: string) {
    return this.del<void>(
      `/api/${enc(session)}/chats/${enc(chatId)}/messages/${enc(messageId)}`,
    );
  }
  editMessage(session: string, chatId: string, messageId: string, text: string) {
    return this.put<void>(
      `/api/${enc(session)}/chats/${enc(chatId)}/messages/${enc(messageId)}`,
      { text },
    );
  }
  pinMessage(session: string, chatId: string, messageId: string, durationSeconds = 604_800) {
    return this.post<void>(
      `/api/${enc(session)}/chats/${enc(chatId)}/messages/${enc(messageId)}/pin`,
      { duration: durationSeconds },
    );
  }
  unpinMessage(session: string, chatId: string, messageId: string) {
    return this.post<void>(`/api/${enc(session)}/chats/${enc(chatId)}/messages/${enc(messageId)}/unpin`);
  }
  forwardMessage(session: string, toChatId: string, messageId: string) {
    return this.post<WAMessage>("/api/forwardMessage", { session, chatId: toChatId, messageId });
  }
  deleteChat(session: string, chatId: string) {
    return this.del<void>(`/api/${enc(session)}/chats/${enc(chatId)}`);
  }
  markUnread(session: string, chatId: string) {
    return this.post<void>(`/api/${enc(session)}/chats/${enc(chatId)}/unread`);
  }
  archiveChat(session: string, chatId: string) {
    return this.post<void>(`/api/${enc(session)}/chats/${enc(chatId)}/archive`);
  }

  // ── Sending ───────────────────────────────────────────────────────────
  sendText(session: string, chatId: string, text: string, replyTo?: string) {
    return this.post<WAMessage>("/api/sendText", {
      session,
      chatId,
      text,
      reply_to: replyTo,
      linkPreview: true,
    });
  }
  sendImage(
    session: string,
    chatId: string,
    file: { mimetype: string; filename: string; data: string },
    caption?: string,
  ) {
    return this.post<WAMessage>("/api/sendImage", { session, chatId, file, caption });
  }
  sendFile(
    session: string,
    chatId: string,
    file: { mimetype: string; filename: string; data: string },
    caption?: string,
  ) {
    return this.post<WAMessage>("/api/sendFile", { session, chatId, file, caption });
  }
  /** `convert` lets the server transcode (ffmpeg) to the opus/ogg WhatsApp expects. */
  sendVoice(session: string, chatId: string, file: { mimetype: string; data: string; filename?: string }, convert = true) {
    return this.post<WAMessage>("/api/sendVoice", { session, chatId, file, convert });
  }
  sendVideo(
    session: string,
    chatId: string,
    file: { mimetype: string; filename: string; data: string },
    caption?: string,
    convert = true,
  ) {
    return this.post<WAMessage>("/api/sendVideo", { session, chatId, file, caption, convert, asNote: false });
  }
  sendLocation(session: string, chatId: string, latitude: number, longitude: number, title: string) {
    return this.post<WAMessage>("/api/sendLocation", { session, chatId, latitude, longitude, title });
  }
  sendContactVcard(session: string, chatId: string, contacts: { fullName: string; phoneNumber: string; organization?: string }[]) {
    const vcards = contacts.map((c) => ({
      vcard: [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${c.fullName}`,
        c.organization ? `ORG:${c.organization};` : null,
        `TEL;type=CELL;type=VOICE;waid=${c.phoneNumber.replace(/\D/g, "")}:+${c.phoneNumber.replace(/\D/g, "")}`,
        "END:VCARD",
      ]
        .filter(Boolean)
        .join("\n"),
    }));
    return this.post<WAMessage>("/api/sendContactVcard", { session, chatId, contacts: vcards });
  }
  sendPoll(session: string, chatId: string, name: string, options: string[], multipleAnswers = false) {
    return this.post<WAMessage>("/api/sendPoll", { session, chatId, poll: { name, options, multipleAnswers } });
  }
  sendSeen(session: string, chatId: string, messageIds?: string[], participant?: string) {
    return this.post<void>("/api/sendSeen", { session, chatId, messageIds, participant });
  }
  react(session: string, messageId: string, reaction: string) {
    return this.put<void>("/api/reaction", { session, messageId, reaction });
  }
  startTyping(session: string, chatId: string) {
    return this.post<void>("/api/startTyping", { session, chatId });
  }
  stopTyping(session: string, chatId: string) {
    return this.post<void>("/api/stopTyping", { session, chatId });
  }

  // ── Contacts & groups ─────────────────────────────────────────────────
  contacts(session: string, limit = 3000, offset = 0) {
    return this.get<Contact[]>("/api/contacts/all", {
      session,
      limit,
      offset,
      sortBy: "name",
    });
  }
  checkExists(session: string, phone: string) {
    return this.get<{ numberExists: boolean; chatId?: string }>(
      "/api/contacts/check-exists",
      { session, phone },
    );
  }
  groups(session: string) {
    return this.get<GroupInfo[]>(`/api/${enc(session)}/groups`);
  }
  groupInfo(session: string, id: string) {
    return this.get<GowsGroup>(`/api/${enc(session)}/groups/${enc(id)}`);
  }
  // ── Group management ──────────────────────────────────────────────────
  private groupParticipants(session: string, id: string, action: string, ids: string[]) {
    return this.post<unknown>(`/api/${enc(session)}/groups/${enc(id)}/${action}`, {
      participants: ids.map((pid) => ({ id: pid })),
    });
  }
  addParticipants(session: string, id: string, ids: string[]) {
    return this.groupParticipants(session, id, "participants/add", ids);
  }
  removeParticipants(session: string, id: string, ids: string[]) {
    return this.groupParticipants(session, id, "participants/remove", ids);
  }
  promoteAdmins(session: string, id: string, ids: string[]) {
    return this.groupParticipants(session, id, "admin/promote", ids);
  }
  demoteAdmins(session: string, id: string, ids: string[]) {
    return this.groupParticipants(session, id, "admin/demote", ids);
  }
  joinRequests(session: string, id: string) {
    return this.get<JoinRequest[]>(`/api/${enc(session)}/groups/${enc(id)}/participants/join-requests`);
  }
  approveJoinRequests(session: string, id: string, ids: string[]) {
    return this.groupParticipants(session, id, "participants/join-requests/approve", ids);
  }
  rejectJoinRequests(session: string, id: string, ids: string[]) {
    return this.groupParticipants(session, id, "participants/join-requests/reject", ids);
  }
  setGroupSubject(session: string, id: string, subject: string) {
    return this.put<void>(`/api/${enc(session)}/groups/${enc(id)}/subject`, { subject });
  }
  setGroupDescription(session: string, id: string, description: string) {
    return this.put<void>(`/api/${enc(session)}/groups/${enc(id)}/description`, { description });
  }
  groupInviteCode(session: string, id: string) {
    return this.get<string>(`/api/${enc(session)}/groups/${enc(id)}/invite-code`);
  }
  revokeGroupInviteCode(session: string, id: string) {
    return this.post<string>(`/api/${enc(session)}/groups/${enc(id)}/invite-code/revoke`);
  }
  leaveGroup(session: string, id: string) {
    return this.post<void>(`/api/${enc(session)}/groups/${enc(id)}/leave`);
  }
  /** All known LID → phone mappings (paged). */
  lids(session: string, limit = 5000, offset = 0) {
    return this.get<{ lid: string; pn: string | null }[]>(`/api/${enc(session)}/lids`, { limit, offset });
  }
  /** Map a LID (linked id) to the phone-number id. */
  lidToPhone(session: string, lid: string) {
    return this.get<{ lid: string; pn: string | null }>(`/api/${enc(session)}/lids/${enc(lid)}`);
  }
  profilePicture(session: string, contactId: string) {
    return this.get<{ profilePictureURL: string | null }>("/api/contacts/profile-picture", { session, contactId });
  }
  contactInfo(session: string, contactId: string) {
    return this.get<Contact>("/api/contacts", { session, contactId });
  }

  // ── Presence ──────────────────────────────────────────────────────────
  presence(session: string, chatId: string) {
    return this.get<PresenceInfo>(`/api/${enc(session)}/presence/${enc(chatId)}`);
  }
  subscribePresence(session: string, chatId: string) {
    return this.post<void>(`/api/${enc(session)}/presence/${enc(chatId)}/subscribe`);
  }

  // ── Media ─────────────────────────────────────────────────────────────
  /** Fetch a media URL served by WAHA (needs API key) and return raw bytes. */
  async fetchMedia(url: string): Promise<Blob> {
    const res = await tauriFetch(url, { headers: { "X-Api-Key": this.cfg.apiKey } });
    if (!res.ok) throw new WahaError(res.status, `Media ${res.status}`);
    return await res.blob();
  }
}

function enc(s: string) {
  return encodeURIComponent(s);
}
