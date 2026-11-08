import { afterEach, expect, it, vi } from "vitest";
import { fetchGames } from "../scripts/fetchers/gamerpower";

afterEach(() => vi.unstubAllGlobals());
it("maps GamerPower fields and handles unknown dates", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async()=>[
  {id:1,title:"Example (Steam) Giveaway",platforms:"PC, Steam, Epic Games Store",type:"Early Access",worth:"$9.99",published_date:"2026-11-01 12:00:00",end_date:"2026-11-12 23:59:00",open_giveaway_url:"https://example.com"},
  {id:2,title:"Another Giveaway",platforms:"DRM-Free",type:"unknown",worth:"N/A",published_date:"2026-11-01 12:00:00",end_date:"N/A",gamerpower_url:"https://example.com"}
 ]}));
 const games=await fetchGames();
 expect(games[0]).toMatchObject({title:"Example",store:"epic",type:"beta",worthUsd:9.99,startAt:"2026-11-01T12:00:00.000Z",endAt:"2026-11-12T23:59:00.000Z",endApprox:true});
 expect(games[1]).toMatchObject({title:"Another",store:"other",type:"other",worthUsd:null,endAt:null,endApprox:false});
});
