import type { Game, Status } from "../shared/types";
import type { UiState } from "./state";
import { formatStart } from "./start-time";

export type CardState = Status | "ending";
export const sections: Array<{ status: CardState; title: string }> = [
  { status: "active", title: "配布中" }, { status: "ending", title: "もうすぐ終了" },
  { status: "upcoming", title: "配布予定" }, { status: "ended", title: "終了済み（直近30日）" }
];
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, role: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = role; if (text !== undefined) node.textContent = text; return node;
}
export function makeCard(game: Game, claimed: boolean, status: CardState, end: { text: string; countdown: string | null; imminent: boolean }): HTMLElement {
  const card = element("article", "game-card"); card.dataset.state = status; card.dataset.claimed = String(claimed); card.dataset.approx = String(game.endApprox);
  const title = element("h3", "game-card__title");
  const url = safeHttpUrl(game.url);
  if (url) { const link = element("a", "game-card__link", game.title); link.href = url; link.rel = "noopener noreferrer"; title.append(link); } else title.textContent = game.title;
  if (game.imageUrl && safeHttpUrl(game.imageUrl)) { const img = element("img", "game-card__image"); img.src = safeHttpUrl(game.imageUrl)!; img.alt = ""; img.loading = "lazy"; card.append(img); }
  card.append(title, element("p", "game-card__store", game.store), element("p", "game-card__type", typeLabel(game.type)), element("p", "game-card__end", end.text));
  if (status === "upcoming") card.append(element("p", "game-card__start", formatStart(game.startAt)));
  if (end.imminent) card.append(element("p", "game-card__imminent", "まもなく"));
  if (end.countdown) { const countdown = element("p", "game-card__countdown", end.countdown); countdown.dataset.countdown = game.endAt ?? ""; card.append(countdown); }
  if (game.worthUsd !== null) card.append(element("p", "game-card__worth", `通常価格相当 $${game.worthUsd}`));
  if (game.summaryJa) card.append(element("p", "game-card__summary", `AI要約: ${game.summaryJa}`));
  if (game.type !== "game") card.append(element("span", "badge", typeLabel(game.type)));
  const label = element("label", "game-card__claimed-label"); const check = element("input", "game-card__claimed"); check.type = "checkbox"; check.checked = claimed; check.dataset.claimedId = game.id; label.append(check, document.createTextNode(" 受け取り済み")); card.append(label);
  return card;
}
export function makeControls(state: UiState): HTMLElement {
  const controls = element("section", "filters"); controls.setAttribute("aria-label", "絞り込み");
  const storeLabel = element("label", "filters__label", "ストア"); const store = element("select", "filters__store"); store.dataset.filter = "store";
  for (const [value, labelText] of [["all", "全部"], ["epic", "Epic"], ["steam", "Steam"], ["gog", "GOG"], ["itch", "itch.io"], ["prime", "Prime Gaming"], ["other", "その他"]]) { const option = element("option", "", labelText); option.value = value; store.append(option); }
  store.value = state.store; storeLabel.append(store); controls.append(storeLabel);
  const rss = element("nav", "store-feeds"); rss.setAttribute("aria-label", "ストア別RSS");
  for (const [value, labelText] of [["epic", "Epic RSS"], ["steam", "Steam RSS"], ["gog", "GOG RSS"], ["itch", "itch.io RSS"], ["prime", "Prime RSS"], ["other", "その他 RSS"]]) { const link = element("a", "store-feeds__link", labelText); link.href = `/feeds/${value}.xml`; rss.append(link); } controls.append(rss);
  const tabs = element("div", "type-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "種別");
  for (const [value, labelText] of [["game", "ゲーム本体"], ["dlc", "DLC"], ["loot", "ゲーム内アイテム"], ["beta", "ベータ"], ["other", "その他"], ["all", "すべて"]]) { const button = element("button", "type-tabs__tab", labelText); button.type = "button"; button.dataset.type = value; button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(state.type === value)); tabs.append(button); } controls.append(tabs);
  const hideLabel = element("label", "filters__claimed-label"); const hide = element("input", "filters__claimed"); hide.type = "checkbox"; hide.checked = state.hideClaimed; hide.dataset.filter = "hide-claimed"; hideLabel.append(hide, document.createTextNode(" 受け取り済みを隠す")); controls.append(hideLabel);
  return controls;
}
function typeLabel(type: Game["type"]): string { return ({ game: "ゲーム本体", dlc: "DLC", loot: "ゲーム内アイテム", beta: "ベータ", other: "その他" })[type]; }
function safeHttpUrl(value: string): string | null { try { const url = new URL(value, location.origin); return url.protocol === "http:" || url.protocol === "https:" ? url.href : null; } catch { return null; } }
