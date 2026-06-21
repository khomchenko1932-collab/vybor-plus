const encode = value => encodeURIComponent(value.trim());

const productProviders = [
  { id: "ozon", name: "Ozon", searchUrl: query => `https://www.ozon.ru/search/?text=${encode(query)}` },
  { id: "wildberries", name: "Wildberries", searchUrl: query => `https://www.wildberries.ru/catalog/0/search.aspx?search=${encode(query)}` },
  { id: "yandex-market", name: "Яндекс Маркет", searchUrl: query => `https://market.yandex.ru/search?text=${encode(query)}` },
  { id: "avito", name: "Avito", searchUrl: query => `https://www.avito.ru/rossiya?q=${encode(query)}` },
];

const placeProviders = [
  { id: "yandex-travel", name: "Яндекс Путешествия", searchUrl: () => "https://travel.yandex.ru/" },
  { id: "ostrovok", name: "Островок", searchUrl: () => "https://ostrovok.ru/" },
  { id: "tutu", name: "Туту", searchUrl: () => "https://www.tutu.ru/" },
];

const serviceProviders = [
  { id: "avito", name: "Avito", searchUrl: query => `https://www.avito.ru/rossiya?q=${encode(query)}` },
  { id: "profi", name: "Профи", searchUrl: () => "https://profi.ru/" },
  { id: "youdo", name: "YouDo", searchUrl: () => "https://youdo.com/" },
];

const providersFor = category => category === "place" ? placeProviders : category === "service" ? serviceProviders : category === "decision" ? [] : productProviders;

export function getSearchSources(query, category) {
  return providersFor(category).map(provider => ({
    id: provider.id,
    name: provider.name,
    url: provider.searchUrl(query),
    mode: "search",
    price: null,
    available: null,
  }));
}

export function enrichRecommendation(result, originalQuery, category) {
  for (const key of ["best", "budget", "premium"]) {
    const card = result[key];
    if (card) card.sources = getSearchSources(card.searchQuery || `${card.title} ${originalQuery}`, category);
  }
  return {
    ...result,
    sourceStatus: "search-only",
    sourcesCheckedAt: new Date().toISOString(),
  };
}
