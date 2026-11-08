import { formatEnd, isWithinRecentHistory } from "../shared/format";
import { computeStatus } from "../shared/status";
import { orderByEndAt, orderByStartAt } from "./ordering";
import { formatStart } from "./start-time";
import type { Game, Status } from "../shared/types";
import { claimedIds } from "./state";
import type { UiState } from "./state";
import { cardImageUrl, element, makeCard, makeControls, sections, type CardState } from "./templates";

export function render(root: HTMLElement, games: Game[], state: UiState, now = new Date()): void {
  const claimed = claimedIds(), controls = makeControls(state); root.replaceChildren(element("h1", "app__title", "FreeGameHub"), controls);
  const buckets = new Map<CardState, Game[]>();
  for (const section of sections) buckets.set(section.status, []);
  buckets.set("ending", []);
  for (const game of games) {
    if (state.store !== "all" && game.store !== state.store) continue;
    if (state.type !== "all" && game.type !== state.type) continue;
    if (state.hideClaimed && claimed.has(game.id)) continue;
    const status = computeStatus(game, now), end = formatEnd(game, now);
    if (status === "ended" && !isWithinRecentHistory(game.endAt, now)) continue;
    if (status === "active" && !game.endApprox && end.imminent) buckets.get("ending")!.push(game);
    else buckets.get(status)!.push(game);
  }
  let imageIndex = 0;
  for (const section of sections) {
    const group = element("section", "game-section"); group.dataset.section = section.status;
    group.append(element("h2", "game-section__title", section.title)); const list = element("div", "game-section__games");
    const ordered = section.status === "ending" ? orderByEndAt(buckets.get(section.status)!) : buckets.get(section.status)!;
    for (const [index, game] of ordered.entries()) {
      const imageUrl = cardImageUrl(game);
      if (imageUrl && imageIndex === 0) updateHeroPreconnect(imageUrl);
      list.append(makeCard(game, claimed.has(game.id), section.status, formatEnd(game, now), imageUrl, imageIndex, index === 0));
      if (imageUrl) imageIndex++;
    }
    if (!ordered.length) list.append(element("p", "game-section__empty", emptyMessage(section.status)));
    if (section.status === "active") {
      const upcoming = orderByStartAt(buckets.get("upcoming")!);
      if (upcoming.length) {
        const previews = element("div", "upcoming-preview"); previews.setAttribute("aria-label", "配布予定のプレビュー");
        previews.append(element("h3", "upcoming-preview__heading", "次回予告"));
        for (const game of upcoming) {
          const preview = element("article", "upcoming-preview__card");
          preview.append(element("h3", "upcoming-preview__title", game.title), element("p", "upcoming-preview__start", formatStart(game.startAt)));
          previews.append(preview);
        }
        list.append(previews);
      }
    }
    group.append(list); root.append(group);
  }
  if (!imageIndex) updateHeroPreconnect(null);
}

function updateHeroPreconnect(imageUrl: string | null): void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[data-hero-preconnect]');
  const origin = imageUrl ? new URL(imageUrl).origin : null;
  if (!origin || origin === location.origin) { existing?.remove(); return; }
  if (existing?.href === `${origin}/`) return;
  existing?.remove();
  const link = document.createElement("link"); link.rel = "preconnect"; link.href = origin; link.dataset.heroPreconnect = ""; document.head.append(link);
}

function emptyMessage(status: string): string {
  return ({ active: "いまは配布中のゲームがありません。", ending: "終了が近いゲームはありません。", upcoming: "配布予定のゲームはありません。", ended: "直近30日以内に終了したゲームはありません。" } as Record<string, string>)[status] ?? "該当するゲームはありません。";
}
