import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { Toggle } from "./shared";

export function MediaSection() {
  const s = useSettings();
  const qc = useQueryClient();
  const set = async (patch: Parameters<typeof s.save>[0]) => {
    await s.save(patch);
    // Message lists are fetched with the auto-download list; refetch so placeholders update.
    qc.invalidateQueries({ queryKey: ["messages"] });
  };
  return (
    <>
      <Toggle
        label="Auto-load images"
        hint="Photos appear immediately."
        checked={s.autoLoadImages}
        onChange={(v) => set({ autoLoadImages: v })}
      />
      <Toggle
        label="Auto-load stickers"
        hint="Detected from the message type (stickers are webp images)."
        checked={s.autoLoadStickers}
        onChange={(v) => set({ autoLoadStickers: v })}
      />
      <Toggle
        label="Auto-load videos"
        hint="Videos can be large; off shows a blurred frame with the size."
        checked={s.autoLoadVideos}
        onChange={(v) => set({ autoLoadVideos: v })}
      />
      <Toggle label="Auto-load voice notes & audio" checked={s.autoLoadAudio} onChange={(v) => set({ autoLoadAudio: v })} />
      <p className="text-xs text-neutral-500">Documents are never downloaded automatically — click to open.</p>
    </>
  );
}
