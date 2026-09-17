import { useEffect, useRef, useState } from "react";
import { confirm } from "@/components/Confirm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Camera, Trash2, Loader2, Check, Pencil } from "lucide-react";
import { requireClient } from "@/store/settings";
import { Avatar, Button, Input, Label } from "@/components/ui";
import { fileToBase64, errMsg } from "@/lib/utils";
import { qk } from "@/api/queries";

/** Edit the WhatsApp profile of a session: picture, display name, about. */
export function ProfileModal({ session, onClose }: { session: string; onClose: () => void }) {
  const qc = useQueryClient();
  const profile = useQuery({
    queryKey: ["profile", session],
    queryFn: () => requireClient().myProfile(session),
  });
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile.data) {
      setName(profile.data.name ?? "");
      setStatus(profile.data.status ?? "");
    }
  }, [profile.data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    setMsg(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["profile", session] });
      await qc.invalidateQueries({ queryKey: qk.sessions });
      setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  const nameDirty = profile.data && name.trim() !== (profile.data.name ?? "");
  const statusDirty = profile.data && status.trim() !== (profile.data.status ?? "");

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[400px] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Pencil size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1">My profile · {session}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-5">
          {profile.isLoading && <Loader2 className="animate-spin text-neutral-400" />}
          {profile.error && <div className="text-xs text-red-600 selectable">{(profile.error as Error).message}</div>}
          {profile.data && (
            <>
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <Avatar src={profile.data.picture} name={profile.data.name || "?"} size={112} />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={busy === "picture"}
                    className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-wa-dark text-white grid place-items-center shadow hover:bg-wa-teal"
                    title="Change photo"
                  >
                    {busy === "picture" ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      await run(
                        "picture",
                        async () => requireClient().setProfilePicture(session, { mimetype: f.type || "image/jpeg", filename: f.name, data: await fileToBase64(f) }),
                        "Photo updated",
                      );
                    }}
                  />
                </div>
                {profile.data.picture && (
                  <button
                    className="text-xs text-red-600 flex items-center gap-1 hover:underline"
                    disabled={busy === "delpic"}
                    onClick={async () => {
                      if (await confirm({ title: "Remove your profile photo?", danger: true, confirmLabel: "Confirm" })) void run("delpic", () => requireClient().deleteProfilePicture(session), "Photo removed");
                    }}
                  >
                    <Trash2 size={12} /> Remove photo
                  </button>
                )}
                <div className="text-xs text-neutral-500 selectable">+{profile.data.id.split("@")[0]}</div>
              </div>

              <div>
                <Label>Name</Label>
                <div className="flex gap-2">
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={25} />
                  <Button disabled={!nameDirty || !name.trim() || busy === "name"} onClick={() => run("name", () => requireClient().setProfileName(session, name.trim()), "Name updated")}>
                    {busy === "name" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </Button>
                </div>
                <div className="text-[11px] text-neutral-400 mt-1">{name.length}/25</div>
              </div>

              <div>
                <Label>About</Label>
                <div className="flex gap-2">
                  <Input value={status} onChange={(e) => setStatus(e.target.value)} maxLength={139} placeholder="Hey there! I am using WhatsApp." />
                  <Button disabled={!statusDirty || busy === "status"} onClick={() => run("status", () => requireClient().setProfileStatus(session, status.trim()), "About updated")}>
                    {busy === "status" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </Button>
                </div>
                <div className="text-[11px] text-neutral-400 mt-1">{status.length}/139 · current value may not be readable on this engine</div>
              </div>

              {msg && (
                <div className={"text-xs selectable " + (msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600")}>{msg.text}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
