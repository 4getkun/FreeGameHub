import "./styles/tokens.css";
import "./styles/index.css";
import "./styles/components.css";
import { gamesFileSchema } from "./shared/schema";
import { claimedIds, readState, saveClaimed, writeState } from "./ui/state";
import { render } from "./ui/render";
import { updateCountdowns } from "./ui/countdown";
import type { Game } from "./shared/types";

const root = document.querySelector<HTMLElement>("[data-app-root]");
if (!root) throw new Error("App root is missing");
let state = readState(location.search);
let countdownTimer: number | undefined;
let games: Game[] | null = null;

function redraw(): void {
  if (!games) return;
  render(root!, games, state);
  updateCountdowns(root!);
}

async function start(): Promise<void> {
  try {
    const response = await fetch("/data/games.json", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`データの取得に失敗しました (${response.status})`);
    const result = gamesFileSchema.safeParse(await response.json());
    if (!result.success) throw new Error("ゲームデータの形式が正しくありません");
    games = result.data.games;
    redraw();
    if (countdownTimer === undefined) countdownTimer = window.setInterval(redraw, 60_000);
  } catch (error) {
    root!.replaceChildren(Object.assign(document.createElement("h1"), { textContent: "FreeGameHub" }), Object.assign(document.createElement("p"), { textContent: error instanceof Error ? error.message : "ゲームデータを読み込めませんでした。" }));
  }
}

root.addEventListener("change", event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target instanceof HTMLInputElement && target.dataset.claimedId) {
    const ids = claimedIds(); if (target.checked) ids.add(target.dataset.claimedId); else ids.delete(target.dataset.claimedId); saveClaimed(ids);
  } else if (target instanceof HTMLInputElement && target.dataset.filter === "hide-claimed") state = { ...state, hideClaimed: target.checked };
  else if (target instanceof HTMLSelectElement && target.dataset.filter === "store") state = { ...state, store: target.value as typeof state.store };
  else return;
  writeState(state); redraw();
});
root.addEventListener("click", event => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-type]");
  if (!button) return;
  state = { ...state, type: button.dataset.type as typeof state.type }; writeState(state); redraw();
});
window.addEventListener("popstate", () => { state = readState(location.search); redraw(); });
void start();
