const { getTrendContext } = require('./redditFetch.js');
// =====================
// REDDIT DATA FETCHER
// =====================
// Tidak butuh API key — pakai Reddit JSON publik

const SUBREDDITS = {
  art: [
    { name: 'AnimeArt', label: 'Anime Art' },
    { name: 'ImaginarySliceOfLife', label: 'Slice of Life Art' },
    { name: 'DigitalArt', label: 'Digital Art' },
    { name: 'learnart', label: 'Learn Art' },
  ],
  anime: [
    { name: 'anime', label: 'Anime' },
    { name: 'manga', label: 'Manga' },
    { name: 'animefigures', label: 'Anime Figures' },
  ],
  animation: [
    { name: 'animation', label: 'Animation' },
    { name: 'motiondesign', label: 'Motion Design' },
  ],
};

// Cache biar tidak fetch berulang dalam sesi yang sama
const redditCache = {};
const CACHE_DURATION = 30 * 60 * 1000; // 30 menit

async function fetchSubreddit(
  subredditName,
  sort = 'top',
  time = 'week',
  limit = 10,
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
    const url = `https://old.reddit.com/r/${subredditName}/${sort}.json?limit=${limit}&t=${time}`;
    const { ipcRenderer } = require('electron');
    const raw = await ipcRenderer.invoke('fetch-reddit', url);
    const data = JSON.parse(raw);
    const posts = json.data.children.map((p) => ({
      title: p.data.title,
      score: p.data.score,
      comments: p.data.num_comments,
      flair: p.data.link_flair_text || '',
      url: `https://reddit.com${p.data.permalink}`,
    }));

    redditCache[cacheKey] = { data: posts, timestamp: now };
    return posts;
  } catch (err) {
    console.warn(`Gagal fetch r/${subredditName}:`, err.message);
    return [];
  }
}

// Fetch semua subreddit sekaligus, return ringkasan
async function fetchAllTrends() {
  const results = {
    art: [],
    anime: [],
    animation: [],
    fetchedAt: new Date().toLocaleString('id-ID'),
  };

  // Fetch semua paralel
  const artFetches = SUBREDDITS.art.map((s) =>
    fetchSubreddit(s.name, 'top', 'week', 8),
  );
  const animeFetches = SUBREDDITS.anime.map((s) =>
    fetchSubreddit(s.name, 'hot', 'week', 8),
  );
  const animationFetches = SUBREDDITS.animation.map((s) =>
    fetchSubreddit(s.name, 'top', 'week', 5),
  );

  const [artResults, animeResults, animationResults] = await Promise.all([
    Promise.all(artFetches),
    Promise.all(animeFetches),
    Promise.all(animationFetches),
  ]);

  // Gabungkan dan sort by score
  artResults.forEach((posts, i) => {
    results.art.push(
      ...posts.map((p) => ({ ...p, source: SUBREDDITS.art[i].label })),
    );
  });
  animeResults.forEach((posts, i) => {
    results.anime.push(
      ...posts.map((p) => ({ ...p, source: SUBREDDITS.anime[i].label })),
    );
  });
  animationResults.forEach((posts, i) => {
    results.animation.push(
      ...posts.map((p) => ({ ...p, source: SUBREDDITS.animation[i].label })),
    );
  });

  results.art.sort((a, b) => b.score - a.score);
  results.anime.sort((a, b) => b.score - a.score);
  results.animation.sort((a, b) => b.score - a.score);

  return results;
}

// Format trends jadi string konteks untuk Ollama
function formatTrendsForPrompt(trends) {
  if (!trends) return 'Data tren tidak tersedia.';

  let context = `=== DATA TREN REAL-TIME (diambil ${trends.fetchedAt}) ===\n\n`;

  if (trends.anime.length > 0) {
    context += `🔥 ANIME/MANGA LAGI POPULER:\n`;
    trends.anime.slice(0, 6).forEach((p) => {
      context += `- "${p.title}" (${p.score} upvotes, ${p.comments} komentar) — ${p.source}\n`;
    });
    context += '\n';
  }

  if (trends.art.length > 0) {
    context += `🎨 TREN ANIME ART & ILUSTRASI:\n`;
    trends.art.slice(0, 6).forEach((p) => {
      context += `- "${p.title}" (${p.score} upvotes) — ${p.source}\n`;
    });
    context += '\n';
  }

  if (trends.animation.length > 0) {
    context += `🎬 TREN ANIMASI:\n`;
    trends.animation.slice(0, 4).forEach((p) => {
      context += `- "${p.title}" (${p.score} upvotes) — ${p.source}\n`;
    });
    context += '\n';
  }

  return context;
}

// Status loading global
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
    // Tunggu sampai selesai
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
    console.warn('Gagal fetch trends:', e);
  } finally {
    trendDataLoading = false;
  }

  return formatTrendsForPrompt(trendDataCache);
}
if (typeof module !== 'undefined') {
  module.exports = { getTrendContext, fetchAllTrends, formatTrendsForPrompt };
}
