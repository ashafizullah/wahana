import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { autoLoadMimePrefixes, requireClient, useSettings } from "@/store/settings";
import type { WAMessage } from "./types";

export const qk = {
  version: ["server", "version"] as const,
  sessions: ["sessions"] as const,
  chats: (session: string) => ["chats", session] as const,
  messages: (session: string, chatId: string) => ["messages", session, chatId] as const,
  contacts: (session: string) => ["contacts", session] as const,
  groups: (session: string) => ["groups", session] as const,
};

export function useServerVersion() {
  const client = useSettings((s) => s.client);
  return useQuery({
    queryKey: qk.version,
    queryFn: () => requireClient().serverVersion(),
    enabled: !!client,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useSessions() {
  const client = useSettings((s) => s.client);
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => requireClient().listSessions(true),
    enabled: !!client,
    refetchInterval: 15_000,
  });
}

export function useChats(session: string) {
  const client = useSettings((s) => s.client);
  return useQuery({
    queryKey: qk.chats(session),
    queryFn: () => requireClient().chatsOverview(session, 100),
    enabled: !!client && !!session,
    staleTime: 10_000,
  });
}

/** Server-side media pre-download list derived from user prefs. */
export function useMediaPrefixes() {
  const autoLoadImages = useSettings((s) => s.autoLoadImages);
  const autoLoadStickers = useSettings((s) => s.autoLoadStickers);
  const autoLoadVideos = useSettings((s) => s.autoLoadVideos);
  const autoLoadAudio = useSettings((s) => s.autoLoadAudio);
  return autoLoadMimePrefixes({ autoLoadImages, autoLoadStickers, autoLoadVideos, autoLoadAudio });
}

export function useMessages(session: string, chatId: string | null) {
  const client = useSettings((s) => s.client);
  const prefixes = useMediaPrefixes();
  return useQuery({
    queryKey: qk.messages(session, chatId ?? ""),
    queryFn: () =>
      requireClient().messages(session, chatId!, {
        limit: 60,
        downloadMedia: prefixes.length > 0,
        downloadMediaMimetypes: prefixes,
      }),
    enabled: !!client && !!session && !!chatId,
    staleTime: 30_000,
  });
}

export function useContacts(session: string) {
  const client = useSettings((s) => s.client);
  return useQuery({
    queryKey: qk.contacts(session),
    queryFn: () => requireClient().contacts(session),
    enabled: !!client && !!session,
    staleTime: 5 * 60_000,
  });
}

export function useSendText(session: string, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, replyTo }: { text: string; replyTo?: string }) =>
      requireClient().sendText(session, chatId, text, replyTo),
    onSuccess: (msg) => {
      qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) =>
        old && !old.some((m) => m.id === msg.id) ? [msg, ...old] : old,
      );
      qc.invalidateQueries({ queryKey: qk.chats(session) });
    },
  });
}

export function useSessionAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      action,
      name,
    }: {
      action: "start" | "stop" | "restart" | "logout" | "delete" | "create";
      name: string;
    }) => {
      const c = requireClient();
      switch (action) {
        case "start":
          return c.startSession(name);
        case "stop":
          return c.stopSession(name);
        case "restart":
          return c.restartSession(name);
        case "logout":
          return c.logoutSession(name);
        case "delete":
          return c.deleteSession(name);
        case "create":
          return c.createSession(name, true);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}
