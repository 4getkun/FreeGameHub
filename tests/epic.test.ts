import { afterEach, expect, it, vi } from "vitest";
import { fetchGames } from "../scripts/fetchers/epic";
afterEach(() => vi.unstubAllGlobals());
const offer = { id: "one", title: "日本語", productSlug: "example", promotions: { promotionalOffers: [{ promotionalOffers: [{startDate:"2026-11-01T00:00:00Z",endDate:"2026-11-10T00:00:00Z",discountSetting:{discountPercentage:0}}]}] } };
const response = (elements: unknown[]) => ({ok:true,json:async()=>({data:{Catalog:{searchStore:{elements}}}})});
it("matches English by offer ID", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([offer])).mockResolvedValueOnce(response([{id:"one",title:"English"}])));
 expect((await fetchGames())[0]).toMatchObject({title:"日本語",titleEn:"English"});
});
it("keeps Japanese offers if English fetch fails", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([offer])).mockRejectedValueOnce(new Error("failed")));
 expect((await fetchGames())[0].titleEn).toBeNull();
});
