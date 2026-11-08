export function formatStart(startAt: string | null): string {
  if (!startAt || !Number.isFinite(Date.parse(startAt))) return "開始日時不明";
  const date = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(startAt));
  return `${date} 開始予定`;
}
