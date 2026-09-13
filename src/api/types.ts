import type { components } from "./schema";

export type Schemas = components["schemas"];
export type SessionInfo = Schemas["SessionInfo"];
export type SessionStatus = SessionInfo["status"];
export type MeInfo = Schemas["MeInfo"];
export type WAMessage = Schemas["WAMessage"] & {
  /** Present in newer WAHA builds; used to route realtime events. */
  chatId?: string;
};
export type WAMedia = Schemas["WAMedia"];
/** Contact as returned by `/api/contacts` and `/api/contacts/all` (GOWS). */
export interface Contact {
  id: string;
  name?: string | null;
  pushname?: string | null;
  number?: string | null;
  isBusiness?: boolean;
  isMyContact?: boolean;
}
export type GroupInfo = Schemas["GroupInfo"];
export type Label = Schemas["Label"];
export type Channel = Schemas["Channel"];
export type SessionConfig = Schemas["SessionConfig"];
export type WebhookConfig = Schemas["WebhookConfig"];
export interface ServerVersion {
  version: string;
  engine: string;
  tier: "CORE" | "PLUS";
  browser: string | null;
  platform: string;
}

/** ChatSummary from /chats/overview with lastMessage typed. */
export interface ChatOverview {
  id: string;
  name: string | null;
  picture: string | null;
  lastMessage: WAMessage | null;
  _chat?: Record<string, unknown>;
}

export interface WahaEvent<T = unknown> {
  id: string;
  event: string;
  session: string;
  timestamp: number;
  payload: T;
  me?: MeInfo;
  environment?: Record<string, unknown>;
}

export interface SessionStatusPayload {
  name: string;
  status: SessionStatus;
}

export interface MessageAckPayload {
  id: string;
  from: string;
  to: string;
  participant?: string;
  fromMe: boolean;
  ack: number;
  ackName: string;
}

export interface ServerStatus {
  startTimestamp: number;
  uptime: number;
}

/** Group as returned by the GOWS engine (`GET /api/{session}/groups/{id}`). */
export interface GowsGroup {
  JID: string;
  Name: string;
  Topic?: string;
  OwnerJID?: string;
  OwnerPN?: string;
  GroupCreated?: string;
  IsAnnounce?: boolean;
  IsLocked?: boolean;
  IsJoinApprovalRequired?: boolean;
  ParticipantCount?: number;
  Participants?: {
    JID: string;
    PhoneNumber?: string;
    LID?: string;
    IsAdmin: boolean;
    IsSuperAdmin: boolean;
    DisplayName?: string;
  }[];
}

export type PresenceStatus = "online" | "offline" | "typing" | "recording" | "paused";
export interface PresenceInfo {
  id: string;
  presences: { participant: string; lastKnownPresence: PresenceStatus; lastSeen?: number | null }[];
}

/** Pending membership request (GOWS): `requesterId` is a LID, `timestamp` unix seconds. */
export interface JoinRequest {
  requesterId: string;
  addedById?: string | null;
  parentGroupId?: string | null;
  requestMethod?: string | null;
  timestamp?: number | null;
}
