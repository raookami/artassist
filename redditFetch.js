// =====================
// REDDIT DATA FETCHER
// =====================
// Pakai RSS feed (.rss) — lebih stabil dari JSON endpoint

const SUBREDDITS = {
  art: [
    { name: "AnimeArt", label: "Anime Art" },
    { name: "ImaginarySliceOfLife", label: "Slice of Life Art" },
    { name: "DigitalArt", label: "Digital Art" },
    { name: "learnart", label: "Learn Art" },
  ],
  anime: [
    { name: "anime", label: "Anime" },
    { name: "manga", label: "Manga" },
    { name: "animefigures", label: "Anime Figures" },
  ],
  animation: [
    { name: "animation", label: "Animation" },
    { name: "motiondesign", label: "Motion Design" },
  ],
};

const redditCache = {};
const CACHE_DURATION = 30 * 60 * 1000; // 30 menit

// Parse RSS XML sederhana, ambil judul post
function parseRSS(xml) {
  const posts = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const titleMatch =
      item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
      item.match(/<title>(.*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    if (title && title !== "reddit: the front page of the internet") {
      posts.push({
        title,
        score: 0,
        comments: 0,
        flair: "",
        url: "",
      });
    }
  }
  return posts;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =====================
// PARAM RSS PRIBADI (OPSIONAL)
// =====================
// Reddit sejak ~Juni 2026 memperketat rate limit RSS tanpa login jadi
// ~1 request/menit. Salah satu workaround yang dilaporkan masih berfungsi:
// tempelkan parameter user= & feed= milik akunmu sendiri (dari
// https://www.reddit.com/prefs/feeds/) ke URL RSS — request lalu diperlakukan
// sebagai personal feed dan lolos dari limit ketat itu.
// Isi REDDIT_RSS_USER & REDDIT_RSS_FEED di .env kalau mau pakai cara ini.
// Kalau kosong, fallback ke jeda antar-request yang sesuai limit resmi Reddit.
let rssParamsCache = null;
async function getRssParams() {
  if (rssParamsCache) return rssParamsCache;
  try {
    const { ipcRenderer } = require("electron");
    rssParamsCache = await ipcRenderer.invoke("get-reddit-rss-params");
  } catch (e) {
    rssParamsCache = { user: "", feed: "" };
  }
  return rssParamsCache;
}

async function fetchSubreddit(
  subredditName,
  sort = "top",
  time = "week",
  limit = 10,
  retries = 1,
) {
  const cacheKey = `${subredditName}-${sort}-${time}`;
  const now = Date.now();

  if (
    redditCache[cacheKey] &&
    now - redditCache[cacheKey].timestamp < CACHE_DURATION
  ) {
    return redditCache[cacheKey].data;
  }

  try {
    // Pakai RSS feed — jauh lebih stabil dari .json endpoint
    const { user, feed } = await getRssParams();
    const personalParams =
      user && feed
        ? `&user=${encodeURIComponent(user)}&feed=${encodeURIComponent(feed)}`
        : "";
    const url = `https://www.reddit.com/r/${subredditName}/${sort}.rss?limit=${limit}${personalParams}`;
    const { ipcRenderer } = require("electron");
    const raw = await ipcRenderer.invoke("fetch-reddit", url);

    // Validasi: kalau dapat HTML bukan RSS, lempar error
    if (raw.trim().startsWith("<!DOCTYPE") || raw.trim().startsWith("<html")) {
      throw new Error("Got HTML instead of RSS");
    }

    const posts = parseRSS(raw);
    redditCache[cacheKey] = { data: posts, timestamp: now };
    return posts;
  } catch (err) {
    const isRateLimited = err.message.includes("429");
    if (isRateLimited && retries > 0) {
      // Reddit sekarang cuma izinin ~1 request/menit tanpa param user/feed,
      // jadi retry cepat (detik) percuma — tunggu penuh ~65 detik sebelum coba lagi.
      const waitMs = 65000;
      console.warn(
        `Kena rate limit di r/${subredditName}, retry dalam ${Math.round(waitMs / 1000)}s...`,
      );
      await delay(waitMs);
      return fetchSubreddit(subredditName, sort, time, limit, retries - 1);
    }
    console.warn(`Gagal fetch r/${subredditName}:`, err.message);
    return [];
  }
}

async function fetchAllTrends() {
  const results = {
    art: [],
    anime: [],
    animation: [],
    fetchedAt: new Date().toLocaleString("id-ID"),
  };

  // Gabungkan semua subreddit jadi satu antrian, lalu fetch SATU PER SATU
  // dengan jeda kecil di antaranya. Reddit rate-limit request beruntun/paralel
  // dari IP yang sama, jadi burst 9 request sekaligus (kayak sebelumnya pakai
  // Promise.all) hampir selalu kena 429.
  const queue = [
    ...SUBREDDITS.art.map((s) => ({ ...s, category: "art", sort: "top" })),
    ...SUBREDDITS.anime.map((s) => ({ ...s, category: "anime", sort: "hot" })),
    ...SUBREDDITS.animation.map((s) => ({
      ...s,
      category: "animation",
      sort: "top",
    })),
  ];

  // Reddit (sejak ~Jun 2026) cuma izinin ~1 request RSS/menit tanpa param
  // user/feed pribadi. Kalau param itu diisi di .env (lihat getRssParams),
  // limitnya jauh lebih longgar jadi jeda bisa pendek. Kalau tidak, jeda
  // panjang ~65 detik supaya tidak 429 di request kedua dan seterusnya.
  const { user, feed } = await getRssParams();
  const hasPersonalParams = Boolean(user && feed);
  const gapMs = hasPersonalParams ? 1000 : 65000;

  for (let i = 0; i < queue.length; i++) {
    const s = queue[i];
    const limit = s.category === "animation" ? 5 : 8;
    const posts = await fetchSubreddit(s.name, s.sort, "week", limit);
    results[s.category].push(...posts.map((p) => ({ ...p, source: s.label })));

    // Jeda antar-request (skip jeda setelah request terakhir)
    if (i < queue.length - 1) {
      await delay(gapMs);
    }
  }

  results.art.sort((a, b) => b.score - a.score);
  results.anime.sort((a, b) => b.score - a.score);
  results.animation.sort((a, b) => b.score - a.score);

  return results;
}

function formatTrendsForPrompt(trends) {
  if (!trends) return "Data tren tidak tersedia.";

  let context = `=== DATA TREN REAL-TIME (diambil ${trends.fetchedAt}) ===\n\n`;

  if (trends.anime.length > 0) {
    context += `🔥 ANIME/MANGA LAGI POPULER:\n`;
    trends.anime.slice(0, 6).forEach((p) => {
      context += `- "${p.title}" — ${p.source}\n`;
    });
    context += "\n";
  }

  if (trends.art.length > 0) {
    context += `🎨 TREN ANIME ART & ILUSTRASI:\n`;
    trends.art.slice(0, 6).forEach((p) => {
      context += `- "${p.title}" — ${p.source}\n`;
    });
    context += "\n";
  }

  if (trends.animation.length > 0) {
    context += `🎬 TREN ANIMASI:\n`;
    trends.animation.slice(0, 4).forEach((p) => {
      context += `- "${p.title}" — ${p.source}\n`;
    });
    context += "\n";
  }

  return context;
}

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
