import { cn } from "@/lib/ui";

export function StatusPill({
  tone,
  children
}: {
  tone: "success" | "warning" | "danger" | "info" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium",
        tone === "success" && "border-healthy/30 bg-healthy/10 text-healthy",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "danger" && "border-danger/30 bg-danger/10 text-danger",
        tone === "info" && "border-signal/30 bg-signal/10 text-signal",
        tone === "neutral" && "border-slate-300 bg-white text-slate-700"
      )}
    >
      {children}
    </span>
  );
}
