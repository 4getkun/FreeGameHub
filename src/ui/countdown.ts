import { countdownText } from "../shared/format";
export function updateCountdowns(root: ParentNode, now = Date.now()): void {
  root.querySelectorAll<HTMLElement>("[data-countdown]").forEach(node => {
    const end = Date.parse(node.dataset.countdown ?? "");
    node.textContent = Number.isFinite(end) && end > now ? countdownText(end - now) : "終了しました";
  });
}
