import { pathToFileURL } from "node:url";
import type { Game } from "../../src/shared/types";

type Offer = {
  id: string; title: string; description?: string; offerType?: string;
  productSlug?: string | null; urlSlug?: string | null;
  catalogNs?: { mappings?: { pageSlug?: string }[] };
  keyImages?: { type: string; url: string }[];
  promotions?: { promotionalOffers?: OfferGroup[]; upcomingPromotionalOffers?: OfferGroup[] } | null;
};
type OfferGroup = { promotionalOffers?: { startDate: string; endDate: string; discountSetting?: { discountPercentage?: number } }[] };

export async function fetchGames(): Promise<Omit<Game, "status" | "summaryJa">[]> {
  const response = await fetch("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=ja&country=JP&allowCountries=JP");
  if (!response.ok) throw new Error(`Epic HTTP ${response.status}`);
  const data: unknown = await response.json();
  const elements = (data as { data?: { Catalog?: { searchStore?: { elements?: Offer[] } } } }).data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) throw new Error("Invalid Epic response");
  let englishTitles = new Map<string, string>();
  try {
    const englishResponse = await fetch("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=JP&allowCountries=JP");
    if (!englishResponse.ok) throw new Error("English Epic request failed");
    const englishData: unknown = await englishResponse.json();
    const englishElements = (englishData as { data?: { Catalog?: { searchStore?: { elements?: Offer[] } } } }).data?.Catalog?.searchStore?.elements;
    if (!Array.isArray(englishElements)) throw new Error("Invalid English Epic response");
    englishTitles = new Map(englishElements.filter(item => typeof item.id === "string" && typeof item.title === "string").map(item => [item.id, item.title]));
  } catch {
    console.warn("Epic English titles unavailable");
  }
  return elements.flatMap((offer) => {
    const groups = [...(offer.promotions?.promotionalOffers ?? []), ...(offer.promotions?.upcomingPromotionalOffers ?? [])];
    const promotions = groups.flatMap(group => group.promotionalOffers ?? []).filter(p => p.discountSetting?.discountPercentage === 0);
    return promotions.map(p => {
      const slug = offer.catalogNs?.mappings?.[0]?.pageSlug ?? offer.productSlug ?? offer.urlSlug;
      if (!slug) throw new Error(`Epic offer missing product slug: ${offer.id}`);
      return { id: `epic:${offer.id}`, title: offer.title, titleEn: englishTitles.get(offer.id) ?? null, store: "epic" as const, type: offer.offerType === "BASE_GAME" ? "game" as const : offer.offerType === "ADD_ON" || offer.offerType === "DLC" ? "dlc" as const : "other" as const, url: `https://store.epicgames.com/ja/p/${slug.replace(/\/home$/, "")}`, imageUrl: offer.keyImages?.find(i => i.type === "OfferImageWide")?.url ?? offer.keyImages?.[0]?.url ?? null, startAt: new Date(p.startDate).toISOString(), endAt: new Date(p.endDate).toISOString(), endApprox: false, worthUsd: null, source: "epic" as const, descriptionOrig: offer.description ?? null };
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchGames().then(games => console.log(JSON.stringify(games, null, 2))).catch(() => { console.error("Epic fetch failed"); process.exitCode = 1; });
}
