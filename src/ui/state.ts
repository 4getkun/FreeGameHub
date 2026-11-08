import type { GameType, Store } from "../shared/types";

export interface UiState { store: Store | "all"; type: GameType | "all"; hideClaimed: boolean; }
const stores: Array<Store | "all"> = ["all", "epic", "steam", "gog", "itch", "prime", "other"];
const types: Array<GameType | "all"> = ["game", "dlc", "loot", "beta", "other", "all"];

export function readState(search: string): UiState {
  const params = new URLSearchParams(search), store = params.get("store"), type = params.get("type");
  return { store: stores.includes(store as Store | "all") ? store as Store | "all" : "all", type: types.includes(type as GameType | "all") ? type as GameType | "all" : "game", hideClaimed: params.get("claimed") === "hide" };
}
export function writeState(state: UiState, location = window.location): void {
  const params = new URLSearchParams();
  if (state.store !== "all") params.set("store", state.store);
  if (state.type !== "game") params.set("type", state.type);
  if (state.hideClaimed) params.set("claimed", "hide");
  const query = params.toString(); history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}
export function claimedIds(): Set<string> {
  try { const value: unknown = JSON.parse(localStorage.getItem("freegamehub:claimed") ?? "[]"); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []); } catch { return new Set(); }
}
export function saveClaimed(ids: Set<string>): void { try { localStorage.setItem("freegamehub:claimed", JSON.stringify([...ids])); } catch { /* Storage may be disabled or full. */ } }
