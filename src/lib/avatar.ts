// Deterministic Gmail-tinted avatar styling from a seed string (name/email).
const TONES = [
  "bg-gmail-blue/15 text-gmail-blue",
  "bg-gmail-red/15 text-gmail-red",
  "bg-gmail-green/15 text-gmail-green",
  "bg-gmail-yellow/25 text-[oklch(0.58_0.13_75)] dark:text-gmail-yellow",
  "bg-chart-5/18 text-chart-5",
];

export function avatarClasses(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TONES[h % TONES.length];
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
