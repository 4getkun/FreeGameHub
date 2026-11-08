import { formatEnd, isWithinRecentHistory } from "../shared/format";
import { computeStatus } from "../shared/status";
import type { Game, Status } from "../shared/types";
import { claimedIds } from "./state";
import type { UiState } from "./state";
import { element, makeCard, makeControls, sections, type CardState } from "./templates";

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
  for (const section of sections) {
    const group = element("section", "game-section"); group.dataset.section = section.status;
    group.append(element("h2", "game-section__title", section.title)); const list = element("div", "game-section__games");
    for (const game of buckets.get(section.status)!) list.append(makeCard(game, claimed.has(game.id), section.status, formatEnd(game, now)));
    if (!list.childElementCount) list.append(element("p", "game-section__empty", "該当するゲームはありません。"));
    group.append(list); root.append(group);
  }
}
