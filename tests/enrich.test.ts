import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrich } from "../scripts/enrich";
import type { Game } from "../src/shared/types";

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "epic:example", title: "秘密タイトル", titleEn: "Secret Title", store: "epic", type: "game",
    url: "https://store.example/game", imageUrl: null, startAt: null, endAt: null,
    status: "active", endApprox: false, worthUsd: null, source: "epic",
    descriptionOrig: "A puzzle game about restoring a forgotten garden.", summaryJa: null,
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("P5 Groq enrichment", () => {
  it("creates a Japanese summary of at most 60 characters using description and store", async () => {
    const longSummary = "庭を再生するパズルゲームです。".repeat(5);
    const network = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: longSummary } }] })
    });
    vi.stubGlobal("fetch", network);
    const input = [game()];

    const output = await enrich(input, { max: 30, env: { GROQ_API_KEY: "test-key", GROQ_MODEL: "test-model" } });

    expect(output[0].summaryJa).toBe(Array.from(longSummary).slice(0, 60).join(""));
    expect(Array.from(output[0].summaryJa!).length).toBeLessThanOrEqual(60);
    expect(output[0]).not.toBe(input[0]);
    const request = JSON.parse(network.mock.calls[0][1].body as string);
    expect(request.model).toBe("test-model");
    const messages = JSON.stringify(request.messages);
    expect(messages).toContain("A puzzle game about restoring a forgotten garden.");
    expect(messages).toContain("epic");
    expect(messages).not.toContain("秘密タイトル");
    expect(messages).not.toContain("Secret Title");
  });

  it("skips requests when GROQ_API_KEY is missing", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const input = [game()];

    const output = await enrich(input, { max: 30, env: {} });

    expect(network).not.toHaveBeenCalled();
    expect(output[0].summaryJa).toBeNull();
  });

  it("uses groqModel from config.json when GROQ_MODEL is unset", async () => {
    const root = await mkdtemp(join(tmpdir(), "freegamehub-enrich-"));
    try {
      const configPath = join(root, "config.json");
      await writeFile(configPath, JSON.stringify({ groqModel: "config-model" }));
      const network = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "庭を再生するパズルゲーム。" } }] })
      });
      vi.stubGlobal("fetch", network);

      await enrich([game()], { max: 30, env: { GROQ_API_KEY: "test-key" }, configPath });

      expect(JSON.parse(network.mock.calls[0][1].body as string).model).toBe("config-model");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips requests when config.json is malformed and GROQ_MODEL is unset", async () => {
    const root = await mkdtemp(join(tmpdir(), "freegamehub-enrich-"));
    try {
      const configPath = join(root, "config.json");
      await writeFile(configPath, "{");
      const network = vi.fn();
      vi.stubGlobal("fetch", network);

      const output = await enrich([game()], { max: 30, env: { GROQ_API_KEY: "test-key" }, configPath });

      expect(network).not.toHaveBeenCalled();
      expect(output[0].summaryJa).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps failed games unchanged and enriches later eligible games within max", async () => {
    const network = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "街を守る戦略ゲーム。" } }] }) });
    vi.stubGlobal("fetch", network);
    const input = [
      game({ id: "epic:failed" }),
      game({ id: "epic:success" }),
      game({ id: "epic:already", summaryJa: "すでに要約済み。" }),
      game({ id: "epic:no-description", descriptionOrig: null })
    ];

    const output = await enrich(input, { max: 2, env: { GROQ_API_KEY: "test-key", GROQ_MODEL: "test-model" } });

    expect(network).toHaveBeenCalledTimes(2);
    expect(output.map(item => item.summaryJa)).toEqual([null, "街を守る戦略ゲーム。", "すでに要約済み。", null]);
    expect(output.map(item => item.id)).toEqual(input.map(item => item.id));
  });
});
