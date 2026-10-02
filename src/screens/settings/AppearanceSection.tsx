import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeMode, type ThemeMode } from "@/lib/theme";

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function AppearanceSection() {
  const [mode, setMode] = useThemeMode();
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-neutral-300 dark:border-neutral-700 p-0.5">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm " +
              (mode === value ? "bg-wa-dark text-white" : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800")
            }
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">System follows your OS appearance and switches automatically.</p>
    </div>
  );
}
