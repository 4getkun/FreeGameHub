import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Game } from "../../src/shared/types";
import { notificationText, type NotificationContext, type NotificationKind } from "../../src/shared/notification-format";
import { notificationKey } from "../../src/shared/identity";

export type NotifyKind = NotificationKind;
export type NotifyContext = NotificationContext;
export interface Notifier {
  name: string;
  isEnabled(env: NodeJS.ProcessEnv): boolean;
  send(game: Game, kind: NotifyKind, ctx: NotifyContext, env: NodeJS.ProcessEnv): Promise<void>;
}
export type NotifiedFile = Record<string, string[]>;

const MAX_PER_CHANNEL = 10;
const ENDING_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STATE_PATH = "public/data/notified.json";

/** Loads notifier modules from this directory, so adding one file registers it automatically. */
export async function loadNotifiers(directory = dirname(fileURLToPath(import.meta.url))): Promise<Notifier[]> {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && [".ts", ".js", ".mjs"].includes(extname(entry.name)) && entry.name !== "index.ts" && entry.name !== "index.js" && entry.name !== "index.mjs")
    .map(entry => entry.name).sort();
  const modules = await Promise.all(files.map(async file => {
    try { return await import(pathToFileURL(resolve(directory, file)).href) as Partial<Notifier>; }
    catch { return null; }
  }));
  return modules.filter((module): module is Notifier => Boolean(module?.name && module.isEnabled && module.send));
}

export async function readNotifiedFile(filePath = DEFAULT_STATE_PATH): Promise<NotifiedFile | null> {
  try {
    const value: unknown = JSON.parse(await readFile(resolve(filePath), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.values(value).some(channels => !Array.isArray(channels) || channels.some(channel => typeof channel !== "string"))) {
      throw new Error("Invalid notified.json format");
    }
    return value as NotifiedFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeNotifiedFile(state: NotifiedFile, filePath = DEFAULT_STATE_PATH): Promise<void> {
  const target = resolve(filePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function matchesFilters(game: Game, notifierName: string, env: NodeJS.ProcessEnv): boolean {
  const prefix = notifierName.toUpperCase();
  const stores = env[`${prefix}_STORES`]?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  const configuredTypes = env[`${prefix}_TYPES`]?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  const types = configuredTypes?.length ? configuredTypes : ["game"];
  return (!stores?.length || stores.includes(game.store)) && types.includes(game.type);
}

function shouldNotify(game: Game, kind: NotifyKind, now: Date): boolean {
  if (game.status !== "active") return false;
  if (kind === "new") return true;
  if (game.endApprox || !game.endAt) return false;
  const end = Date.parse(game.endAt);
  return end > now.getTime() && end <= now.getTime() + ENDING_WINDOW_MS;
}

/** Bootstraps existing offers silently once, then retries only channels that have not succeeded. */
export async function runNotifications(
  games: Game[],
  ctx: NotifyContext,
  env: NodeJS.ProcessEnv = process.env,
  options: { now?: Date; statePath?: string; notifiers?: Notifier[]; newlyActiveIds?: string[] } = {}
): Promise<{ initialized: boolean; attempts: number }> {
  const notifiers = options.notifiers ?? await loadNotifiers();
  const statePath = options.statePath ?? DEFAULT_STATE_PATH;
  const state = await readNotifiedFile(statePath);
  const now = options.now ?? new Date();
  if (!state) {
    const initial: NotifiedFile = {};
    for (const game of games.filter(item => item.status === "active")) {
      for (const kind of ["new", "ending-soon"] as const) {
        if (!shouldNotify(game, kind, now)) continue;
        initial[notificationKey(game, kind)] = notifiers.map(notifier => notifier.name);
      }
    }
    await writeNotifiedFile(initial, statePath);
    return { initialized: true, attempts: 0 };
  }

  // Migrate old ID-only records to the current period. A detected recurring
  // transition must not inherit the previous period's delivery record.
  const newlyActiveIds = new Set(options.newlyActiveIds ?? []);
  for (const game of games) {
    if (game.startAt === null || newlyActiveIds.has(game.id)) continue;
    for (const kind of ["new", "ending-soon"] as const) {
      const oldKey = `${game.id}:${kind}`;
      const currentKey = notificationKey(game, kind);
      if (state[oldKey]) {
        if (!state[currentKey]) state[currentKey] = state[oldKey];
        delete state[oldKey];
      }
    }
  }
  // A legacy key has no period information. On a detected recurring transition,
  // discard it once so it cannot be mistaken for the new period on the next run.
  for (const game of games) {
    if (game.startAt === null || !newlyActiveIds.has(game.id)) continue;
    delete state[`${game.id}:new`];
    delete state[`${game.id}:ending-soon`];
  }

  let attempts = 0;
  const counts = new Map<string, number>();
  const candidates = (["new", "ending-soon"] as const).flatMap(kind =>
    games.filter(game => shouldNotify(game, kind, now)).map(game => ({ game, kind }))
  );
  // Rotate eligible work every scheduled interval so repeated failures cannot
  // indefinitely prevent later entries from being attempted.
  const offset = candidates.length ? (Math.floor(now.getTime() / (6 * 60 * 60 * 1000)) * MAX_PER_CHANNEL) % candidates.length : 0;
  const ordered = candidates.slice(offset).concat(candidates.slice(0, offset));
  for (const { game, kind } of ordered) {
      const key = notificationKey(game, kind);
      const sent = new Set(state[key] ?? []);
      for (const notifier of notifiers) {
        if (sent.has(notifier.name) || !matchesFilters(game, notifier.name, env) || (counts.get(notifier.name) ?? 0) >= MAX_PER_CHANNEL) continue;
        let enabled = false;
        try { enabled = notifier.isEnabled(env); } catch { continue; }
        if (!enabled) continue;
        counts.set(notifier.name, (counts.get(notifier.name) ?? 0) + 1);
        attempts++;
        try {
          await notifier.send(game, kind, ctx, env);
          sent.add(notifier.name);
          state[key] = [...sent];
        } catch {
          // Do not print transport errors because they may include secret webhook URLs.
          console.error(`[notifier] ${notifier.name} send failed for ${kind} ${game.id}`);
        }
      }
  }
  await writeNotifiedFile(state, statePath);
  return { initialized: false, attempts };
}

