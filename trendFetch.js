// =====================
// TREND DATA FETCHER — AniList + Danbooru
// =====================
// Ganti dari Reddit RSS (cuma daftar judul post populer minggu ini) ke:
// 1. AniList GraphQL — trending anime & manga real, dihitung dari aktivitas
//    user AniList (bukan proxy dari jumlah upvote post), update terus tiap hari.
// 2. Danbooru — agregasi karakter/tag yang lagi banyak digambar komunitas
//    minggu ini (hanya post rating "general", tidak ada konten NSFW).
// Keduanya API publik gratis, tanpa API key, dan tanpa drama rate-limit
// separah Reddit.

const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const DANBOORU_ENDPOINT = "https://danbooru.donmai.us/posts.json";
const SAFEBOORU_ENDPOINT = "https://safebooru.org/index.php";

const CACHE_DURATION = 30 * 60 * 1000; // 30 menit
const sourceCache = {};

function isCacheValid(key) {
  const c = sourceCache[key];
  return c && Date.now() - c.timestamp < CACHE_DURATION;
}

function setCache(key, data) {
  sourceCache[key] = { data, timestamp: Date.now() };
}

// =====================
// ANILIST — TRENDING ANIME / MANGA
// =====================
const ANILIST_QUERY = `
query ($type: MediaType, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(type: $type, sort: TRENDING_DESC, isAdult: false) {
      title { romaji english }
      format
      trending
      popularity
      averageScore
      season
      seasonYear
      genres
    }
  }
}`;

async function fetchAniListTrending(type, perPage = 8) {
  const cacheKey = `anilist-${type}`;
  if (isCacheValid(cacheKey)) return sourceCache[cacheKey].data;

  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: ANILIST_QUERY,
      variables: { type, perPage },
    }),
  });

  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  const media = json?.data?.Page?.media || [];

  const results = media.map((m) => ({
    title: m.title.english || m.title.romaji,
    format: m.format,
    season: m.season && m.seasonYear ? `${m.season} ${m.seasonYear}` : "",
    score: m.averageScore,
    genres: (m.genres || []).slice(0, 3),
  }));

  setCache(cacheKey, results);
  return results;
}

// =====================
// DANBOORU — TAG/KARAKTER PALING BANYAK DIGAMBAR MINGGU INI
// =====================
// Cuma tarik post dengan rating:g (general/aman, tanpa NSFW), difilter
// tanggal 7 hari terakhir, diurutkan skor. Lalu agregasi frekuensi tag
// karakter & copyright (judul asal) buat lihat siapa/apa yang lagi rame
// digambar komunitas art minggu ini.

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function aggregateTags(posts) {
  const freq = {};
  posts.forEach((p) => {
    const chars = (p.tag_string_character || "").split(" ").filter(Boolean);
    const copyrights = (p.tag_string_copyright || "")
      .split(" ")
      .filter(Boolean);
    chars.forEach((t) => {
      freq[t] = (freq[t] || 0) + 2; // karakter dibobot lebih tinggi
    });
    copyrights.forEach((t) => {
      freq[t] = (freq[t] || 0) + 1;
    });
  });

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => tag.replace(/_/g, " "));
}

async function fetchDanbooruTrending(limit = 40) {
  const cacheKey = "danbooru";
  if (isCacheValid(cacheKey)) return sourceCache[cacheKey].data;

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tags = `rating:g order:score date:${fmtDate(weekAgo)}..${fmtDate(today)}`;
  const url = `${DANBOORU_ENDPOINT}?tags=${encodeURIComponent(tags)}&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ArtAssist/2.0 (trend research tool)" },
    });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || !contentType.includes("application/json")) {
      throw new Error(`Danbooru menolak/diblokir (status ${res.status})`);
    }
    const posts = await res.json();
    const results = aggregateTags(posts);
    if (results.length === 0) throw new Error("Danbooru kosong");
    setCache(cacheKey, results);
    return results;
  } catch (err) {
    console.log(
      `[Trend] Danbooru tidak bisa diakses (${err.message}), pakai fallback Safebooru — ini normal, bukan error.`,
    );
    return fetchSafebooruTrending(limit);
  }
}

// Fallback kalau Danbooru down/limit — Safebooru cuma nampung konten SFW.
async function fetchSafebooruTrending(limit = 40) {
  const cacheKey = "safebooru";
  if (isCacheValid(cacheKey)) return sourceCache[cacheKey].data;

  const params = new URLSearchParams({
    page: "dapi",
    s: "post",
    q: "index",
    json: "1",
    limit: String(limit),
    tags: "sort:score:desc",
  });
  const url = `${SAFEBOORU_ENDPOINT}?${params.toString()}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "ArtAssist/2.0 (trend research tool)" },
  });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok || !contentType.includes("application/json")) {
    throw new Error(`Safebooru menolak/diblokir (status ${res.status})`);
  }
  const posts = await res.json();

  // Safebooru cuma ngasih 1 field "tags" gabungan, tanpa pemisah karakter/copyright
  const freq = {};
  (posts || []).forEach((p) => {
    (p.tags || "")
      .split(" ")
      .filter(Boolean)
      .forEach((t) => {
        freq[t] = (freq[t] || 0) + 1;
      });
  });
  const results = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => tag.replace(/_/g, " "));

  setCache(cacheKey, results);
  return results;
}

// =====================
// GABUNGKAN SEMUA SUMBER
// =====================
async function fetchAllTrends() {
  const results = {
    animeTrending: [],
    mangaTrending: [],
    artTagsTrending: [],
    fetchedAt: new Date().toLocaleString("id-ID"),
  };

  const [anime, manga, artTags] = await Promise.allSettled([
    fetchAniListTrending("ANIME", 8),
    fetchAniListTrending("MANGA", 6),
    fetchDanbooruTrending(40),
  ]);

  if (anime.status === "fulfilled") results.animeTrending = anime.value;
  else console.warn("Gagal fetch AniList (anime):", anime.reason?.message);

  if (manga.status === "fulfilled") results.mangaTrending = manga.value;
  else console.warn("Gagal fetch AniList (manga):", manga.reason?.message);

  if (artTags.status === "fulfilled") results.artTagsTrending = artTags.value;
  else console.warn("Gagal fetch tren tag art:", artTags.reason?.message);

  return results;
}

function formatTrendsForPrompt(trends) {
  if (!trends) return "Data tren tidak tersedia.";

  let context = `=== DATA TREN REAL-TIME (AniList + Danbooru, diambil ${trends.fetchedAt}) ===\n\n`;

  if (trends.animeTrending.length > 0) {
    context += `🔥 ANIME LAGI TRENDING (AniList, sinyal aktivitas user real-time):\n`;
    trends.animeTrending.forEach((m) => {
      const meta = [m.format, m.season].filter(Boolean).join(" · ");
      context += `- "${m.title}"${meta ? ` (${meta})` : ""}${m.genres?.length ? ` — genre: ${m.genres.join(", ")}` : ""}\n`;
    });
    context += "\n";
  }

  if (trends.mangaTrending.length > 0) {
    context += `📖 MANGA LAGI TRENDING (AniList):\n`;
    trends.mangaTrending.forEach((m) => {
      context += `- "${m.title}"${m.genres?.length ? ` — genre: ${m.genres.join(", ")}` : ""}\n`;
    });
    context += "\n";
  }

  if (trends.artTagsTrending.length > 0) {
    context += `🎨 KARAKTER/TEMA PALING BANYAK DIGAMBAR MINGGU INI (Danbooru, rating aman):\n`;
    context += `- ${trends.artTagsTrending.join(", ")}\n\n`;
  }

  if (
    trends.animeTrending.length === 0 &&
    trends.mangaTrending.length === 0 &&
    trends.artTagsTrending.length === 0
  ) {
    return "Data tren real-time tidak tersedia saat ini, gunakan pengetahuan umum.";
  }

  return context;
}

// =====================
// CACHE LAPIS ATAS (dipakai renderer.js)
// =====================
let trendDataCache = null;
let trendDataLoading = false;
let trendDataLoadedAt = null;

async function getTrendContext(forceRefresh = false) {
  const now = Date.now();
  const isStale =
    !trendDataLoadedAt || now - trendDataLoadedAt > CACHE_DURATION;

  if (trendDataCache && !isStale && !forceRefresh) {
    return formatTrendsForPrompt(trendDataCache);
  }

  if (trendDataLoading) {
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (!trendDataLoading) {
          clearInterval(check);
          resolve();
        }
      }, 300);
    });
    return formatTrendsForPrompt(trendDataCache);
  }

  trendDataLoading = true;
  try {
    trendDataCache = await fetchAllTrends();
    trendDataLoadedAt = Date.now();
  } catch (e) {
    console.warn("Gagal fetch trends:", e);
  } finally {
    trendDataLoading = false;
  }

  return formatTrendsForPrompt(trendDataCache);
}

if (typeof module !== "undefined") {
  module.exports = { getTrendContext, fetchAllTrends, formatTrendsForPrompt };
}
