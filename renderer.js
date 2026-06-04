// Navigasi sidebar
const { ipcRenderer } = require('electron');

// =====================
// SUPABASE CLIENT (renderer)
// =====================
const { createClient } = require('@supabase/supabase-js');
let supabaseClient = null;

async function initSupabase() {
  const config = await ipcRenderer.invoke('get-supabase-config');
  supabaseClient = createClient(config.url, config.key);
}

// Sync jadwal dari Supabase ke localStorage saat app dibuka
async function syncFromSupabase() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('schedule')
      .select('*')
      .eq('user_id', 'raookami');
    if (error || !data) return;

    const merged = JSON.parse(
      localStorage.getItem('artassist-schedule-v2') || '{}',
    );
    data.forEach((row) => {
      if (!merged[row.month_key]) merged[row.month_key] = {};
      merged[row.month_key][row.date_key] = row.posts;
    });
    localStorage.setItem('artassist-schedule-v2', JSON.stringify(merged));
    scheduleData = merged;
    renderDashboard();
    console.log('[Supabase] Jadwal berhasil di-sync.');
  } catch (e) {
    console.warn('[Supabase] Gagal sync:', e.message);
  }
}
const navButtons = document.querySelectorAll('.nav');
const pages = document.querySelectorAll('.page');

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    navButtons.forEach((b) => b.classList.remove('active'));
    pages.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.page).classList.add('active');
  });
});

// Pre-fetch tren saat app dibuka (background)
window.addEventListener('DOMContentLoaded', async () => {
  await initSupabase();
  await syncFromSupabase();
  getTrendContext()
    .then(() => console.log('Tren berhasil dimuat.'))
    .catch(() => console.warn('Gagal load tren, pakai pengetahuan AI saja.'));
});

// =====================
// DASHBOARD
// =====================
const TYPE_COLORS = {
  artwork: '#a78bfa',
  wip: '#f59e0b',
  noncreative: '#10b981',
  carousel: '#3b82f6',
  speedpaint: '#f59e0b',
};

const TYPE_LABELS = {
  artwork: '🖼️ Karya Baru',
  wip: '📸 WIP / BTS',
  noncreative: '✍️ Teks / Meme',
  carousel: '📖 Carousel',
  speedpaint: '🎬 Speed Draw',
};

function renderDashboard() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const daysLeft = daysInMonth - now.getDate();

  const allData = JSON.parse(
    localStorage.getItem('artassist-schedule-v2') || '{}',
  );
  const monthPosts = allData[monthKey] || {};

  const allPosts = [];
  Object.keys(monthPosts).forEach((dateStr) => {
    (monthPosts[dateStr] || []).forEach((post) => {
      allPosts.push({ ...post, dateStr });
    });
  });

  const bulanNames = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  const elMonth = document.getElementById('dash-month-label');
  if (elMonth)
    elMonth.textContent = `${bulanNames[now.getMonth()]} ${now.getFullYear()}`;

  const totalPosts = allPosts.length;
  const artworkCount = allPosts.filter((p) => p.type === 'artwork').length;

  const el = (id) => document.getElementById(id);
  if (el('dash-total-posts')) el('dash-total-posts').textContent = totalPosts;
  if (el('dash-artwork-count'))
    el('dash-artwork-count').textContent = artworkCount;
  if (el('dash-days-left')) el('dash-days-left').textContent = daysLeft;

  const platformCount = {};
  allPosts.forEach((p) => {
    platformCount[p.platform] = (platformCount[p.platform] || 0) + 1;
  });
  const maxPlat = Math.max(...Object.values(platformCount), 1);
  const platEl = el('dash-platform-breakdown');
  if (platEl) {
    platEl.innerHTML = Object.keys(platformCount).length
      ? Object.entries(platformCount)
          .sort((a, b) => b[1] - a[1])
          .map(
            ([plat, count]) => `
        <div class="dash-platform-row">
          <div class="dash-platform-label">${plat}</div>
          <div class="dash-platform-bar-wrap">
            <div class="dash-platform-bar" style="width:${(count / maxPlat) * 100}%; background:${PLATFORM_COLORS[plat] || '#a78bfa'}"></div>
          </div>
          <div class="dash-platform-count">${count}</div>
        </div>`,
          )
          .join('')
      : '<div style="color:#555; font-size:12px">Belum ada jadwal bulan ini</div>';
  }

  const upcoming = allPosts
    .filter((p) => p.dateStr >= todayStr)
    .sort((a, b) => (a.dateStr + a.time).localeCompare(b.dateStr + b.time))
    .slice(0, 5);

  const upcomingEl = el('dash-upcoming');
  if (upcomingEl) {
    upcomingEl.innerHTML = upcoming.length
      ? upcoming
          .map((p) => {
            const d = new Date(p.dateStr + 'T00:00:00');
            const label = `${d.getDate()} ${bulanNames[d.getMonth()]}`;
            return `<div class="dash-upcoming-item">
            <div class="dash-upcoming-date">📅 ${label}</div>
            <div class="dash-upcoming-platform" style="color:${PLATFORM_COLORS[p.platform] || '#aaa'}">${p.platform}</div>
            <div class="dash-upcoming-type">${TYPE_LABELS[p.type] || p.type}${p.note ? ` — ${p.note}` : ''}</div>
          </div>`;
          })
          .join('')
      : '<div style="color:#555; font-size:12px">Tidak ada post terjadwal ke depan</div>';
  }

  const typeCount = {};
  allPosts.forEach((p) => {
    typeCount[p.type] = (typeCount[p.type] || 0) + 1;
  });
  const typeEl = el('dash-type-breakdown');
  if (typeEl) {
    typeEl.innerHTML = Object.keys(typeCount).length
      ? Object.entries(typeCount)
          .sort((a, b) => b[1] - a[1])
          .map(
            ([type, count]) => `
        <div class="dash-type-row">
          <span><span class="dash-type-dot" style="background:${TYPE_COLORS[type] || '#aaa'}"></span>${TYPE_LABELS[type] || type}</span>
          <span style="color:#555">${count}x</span>
        </div>`,
          )
          .join('')
      : '<div style="color:#555; font-size:12px">Belum ada data</div>';
  }

  const reminderEl = el('dash-reminder');
  if (reminderEl) {
    const reminders = [];
    if (totalPosts === 0)
      reminders.push(
        '⚠️ Belum ada jadwal bulan ini. Coba fitur <b>Auto-isi</b> di halaman Jadwal.',
      );
    if (totalPosts > 0 && upcoming.length === 0)
      reminders.push('✅ Semua post bulan ini sudah lewat!');
    if (upcoming.length > 0)
      reminders.push(
        `🔜 Post berikutnya: <b>${upcoming[0].platform}</b> — ${TYPE_LABELS[upcoming[0].type] || upcoming[0].type}`,
      );
    if (artworkCount > 0)
      reminders.push(
        `🎨 Kamu punya <b>${artworkCount} karya baru</b> dijadwalkan bulan ini.`,
      );
    if (daysLeft <= 5 && totalPosts > 0)
      reminders.push(
        `⏰ Bulan ini hampir habis (<b>${daysLeft} hari lagi</b>). Siapkan konten bulan depan!`,
      );
    reminderEl.innerHTML =
      reminders.join('<br>') || '<span style="color:#555">Semua oke!</span>';
  }
}

document.querySelectorAll('.nav').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.page === 'dashboard') renderDashboard();
  });
});

document.addEventListener('DOMContentLoaded', () => {
  renderDashboard();
});

// =====================
// HELPER
// =====================
function extractField(text, field) {
  const match = text.match(new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`));
  return match ? match[1] : '—';
}

function cleanOllamaJSON(raw) {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found');
  return jsonMatch[0]
    .replace(/[\u0000-\u001F\u007F]/g, (char) => {
      if (char === '\n') return ' ';
      if (char === '\r') return '';
      if (char === '\t') return ' ';
      return '';
    })
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ');
}

// =====================
// ANALISIS TREN
// =====================
let lastTrendRecommendations = null;

// trendDataCache is defined in redditFetch.js.

document.addEventListener('DOMContentLoaded', () => {
  const trendMonth = document.getElementById('trend-month');
  if (trendMonth) {
    const now = new Date();
    trendMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
});

async function generateTrendAnalysis() {
  const platform = document.getElementById('trend-platform').value;
  const focus = document.getElementById('trend-focus').value;
  const month = document.getElementById('trend-month').value;

  const focusMap = {
    theme: 'tema dan mood konten yang sedang populer di komunitas anime art',
    format: 'format konten terbaik (reel, carousel, single post, thread)',
    time: 'waktu dan hari posting yang paling optimal untuk engagement',
    hashtag: 'tren hashtag anime art yang sedang naik',
    full: 'analisis lengkap mencakup tema, format, waktu posting, dan hashtag',
  };

  const bulanNames = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  const [y, m] = month.split('-').map(Number);
  const bulanLabel = `${bulanNames[m - 1]} ${y}`;

  const resultEl = document.getElementById('trend-result');
  const detailEl = document.getElementById('trend-detail');
  const cardsEl = document.getElementById('trend-cards');
  const recEl = document.getElementById('trend-schedule-rec');

  resultEl.style.display = 'block';
  cardsEl.innerHTML =
    '<div style="color:#a78bfa; font-size:13px; grid-column:span 3">⏳ Mengambil data tren dari internet...</div>';
  detailEl.textContent = '';
  recEl.innerHTML = '';

  let trendContext = '';
  try {
    cardsEl.innerHTML =
      '<div style="color:#a78bfa; font-size:13px; grid-column:span 3">🌐 Mengambil data Reddit...</div>';
    trendContext = await getTrendContext();
  } catch (err) {
    trendContext =
      'Data tren real-time tidak tersedia, gunakan pengetahuan umum.';
  }

  cardsEl.innerHTML =
    '<div style="color:#a78bfa; font-size:13px; grid-column:span 3">🤖 Groq AI sedang menganalisis...</div>';

  const prompt = `Kamu adalah social media strategist ahli untuk komunitas illustrator anime/manga, khususnya cute boy character art (shota aesthetic, school life, cozy themes).

${trendContext}

Berdasarkan data tren real-time di atas, analisis ${focusMap[focus]} di ${platform} untuk bulan ${bulanLabel}.

PENTING:
- Hubungkan data tren di atas dengan strategi konten anime art
- Sebutkan judul anime atau tema spesifik yang lagi populer berdasarkan data
- Berikan rekomendasi yang actionable dan spesifik

Balas HANYA dengan JSON berikut, tanpa teks di luar JSON:
{
  "summary": {
    "tema_populer": "tema atau anime spesifik yang lagi trending (1-2 frasa)",
    "format_terbaik": "format konten terbaik saat ini (1 frasa)",
    "waktu_optimal": "jam dan hari terbaik posting (1 frasa)",
    "hashtag_naik": "3-4 hashtag relevan yang lagi naik"
  },
  "detail": "analisis lengkap dalam bahasa Indonesia 4-6 paragraf pendek sebut anime atau tema spesifik dari data tren",
  "rekomendasi_jadwal": [
    {"hari": "Senin", "konten": "jenis konten spesifik berdasarkan tren", "jam": "19:00", "alasan": "alasan singkat berdasarkan data"},
    {"hari": "Rabu", "konten": "...", "jam": "...", "alasan": "..."},
    {"hari": "Jumat", "konten": "...", "jam": "...", "alasan": "..."},
    {"hari": "Sabtu", "konten": "...", "jam": "...", "alasan": "..."}
  ]
}`;

  try {
    const raw = await askOllama(prompt);
    let data;
    try {
      const cleaned = cleanOllamaJSON(raw);
      data = JSON.parse(cleaned);
    } catch (parseErr) {
      console.warn('JSON parse gagal, pakai fallback:', parseErr.message);
      data = {
        summary: {
          tema_populer: extractField(raw, 'tema_populer'),
          format_terbaik: extractField(raw, 'format_terbaik'),
          waktu_optimal: extractField(raw, 'waktu_optimal'),
          hashtag_naik: extractField(raw, 'hashtag_naik'),
        },
        detail: extractField(raw, 'detail'),
        rekomendasi_jadwal: [],
      };
    }

    const cards = [
      {
        icon: '🎨',
        title: 'Tema Populer',
        value: data.summary?.tema_populer || '—',
      },
      {
        icon: '📱',
        title: 'Format Terbaik',
        value: data.summary?.format_terbaik || '—',
      },
      {
        icon: '⏰',
        title: 'Waktu Optimal',
        value: data.summary?.waktu_optimal || '—',
      },
    ];
    cardsEl.innerHTML = cards
      .map(
        (c) => `
      <div class="trend-card">
        <div class="trend-card-icon">${c.icon}</div>
        <div class="trend-card-title">${c.title}</div>
        <div class="trend-card-value">${c.value}</div>
      </div>`,
      )
      .join('');

    if (data.summary?.hashtag_naik) {
      cardsEl.innerHTML += `
        <div class="trend-card" style="grid-column:span 3; background:#a78bfa11; border-color:#a78bfa33">
          <div class="trend-card-icon">🔖</div>
          <div class="trend-card-title">Hashtag Naik</div>
          <div class="trend-card-value" style="color:#a78bfa">${data.summary.hashtag_naik}</div>
        </div>`;
    }

    if (trendDataCache?.fetchedAt) {
      cardsEl.innerHTML += `
        <div style="grid-column:span 3; font-size:11px; color:#444; margin-top:4px">
          🌐 Data diambil dari Reddit — ${trendDataCache.fetchedAt}
          <button onclick="getTrendContext(true).then(generateTrendAnalysis)"
            style="background:none; border:none; color:#a78bfa; font-size:11px; cursor:pointer; margin-left:8px">
            🔄 Refresh
          </button>
        </div>`;
    }

    detailEl.textContent = data.detail || '—';

    const recs = data.rekomendasi_jadwal || [];
    lastTrendRecommendations = recs;
    recEl.innerHTML = recs.length
      ? recs
          .map(
            (r) => `
        <div class="trend-rec-item">
          <div class="trend-rec-day">📅 ${r.hari}</div>
          <div class="trend-rec-content">
            <b>${r.konten}</b> — ${r.jam}<br>
            <span style="color:#666">${r.alasan}</span>
          </div>
        </div>`,
          )
          .join('')
      : '<div style="color:#555; font-size:12px">Tidak ada rekomendasi</div>';
  } catch (err) {
    cardsEl.innerHTML = `
      <div style="color:#ff6b6b; grid-column:span 3; font-size:13px">
        ❌ Gagal analisis. Cek API key Groq atau koneksi internet.<br>
        <span style="color:#555; font-size:11px">${err.message}</span>
      </div>`;
  }
}

function applyTrendToSchedule() {
  if (!lastTrendRecommendations || lastTrendRecommendations.length === 0) {
    showToast('Jalankan analisis dulu!');
    return;
  }

  // Ambil bulan referensi dari input analisis tren, bukan bulan sekarang
  const trendMonthInput = document.getElementById('trend-month');
  const now = new Date();
  const todayMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthKey = trendMonthInput?.value || todayMonthKey;

  const [y, m] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();

  // Kalau bulan referensi = bulan ini, mulai dari hari ini. Kalau bulan lain, mulai dari 1.
  const startDay = monthKey === todayMonthKey ? now.getDate() : 1;

  const DAY_MAP = {
    Senin: 1,
    Selasa: 2,
    Rabu: 3,
    Kamis: 4,
    Jumat: 5,
    Sabtu: 6,
    Minggu: 0,
  };

  const TYPE_FROM_KONTEN = (konten) => {
    const k = konten.toLowerCase();
    if (k.includes('karya') || k.includes('ilustrasi') || k.includes('artwork'))
      return 'artwork';
    if (k.includes('wip') || k.includes('proses') || k.includes('bts'))
      return 'wip';
    if (k.includes('carousel') || k.includes('thread')) return 'carousel';
    if (k.includes('speed') || k.includes('reel')) return 'speedpaint';
    return 'noncreative';
  };

  const allData = JSON.parse(
    localStorage.getItem('artassist-schedule-v2') || '{}',
  );
  if (!allData[monthKey]) allData[monthKey] = {};

  let added = 0;
  lastTrendRecommendations.forEach((rec) => {
    const targetDay = DAY_MAP[rec.hari];
    if (targetDay === undefined) return;
    for (let d = startDay; d <= daysInMonth; d++) {
      const date = new Date(y, m - 1, d);
      if (date.getDay() === targetDay) {
        const dateStr = `${monthKey}-${String(d).padStart(2, '0')}`;
        if (
          !allData[monthKey][dateStr] ||
          allData[monthKey][dateStr].length === 0
        ) {
          allData[monthKey][dateStr] = [
            {
              platform: 'Instagram',
              time: rec.jam || '19:00',
              type: TYPE_FROM_KONTEN(rec.konten),
              note: rec.konten,
            },
          ];
          added++;
          break;
        }
      }
    }
  });

  localStorage.setItem('artassist-schedule-v2', JSON.stringify(allData));

  // Sync input bulan di halaman Jadwal supaya kalender langsung tampil bulan yang benar
  const scheduleMonthInput = document.getElementById('schedule-month');
  if (scheduleMonthInput) scheduleMonthInput.value = monthKey;

  // Pastikan modal tidak tertinggal terbuka (bisa block klik)
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.style.display = 'none';

  showToast(`✅ ${added} slot ditambahkan ke jadwal ${monthKey}!`);
  renderDashboard();
  scheduleData = allData;

  // Hanya re-render kalender jika halaman jadwal sedang aktif
  const schedulePage = document.getElementById('schedule');
  if (schedulePage && schedulePage.classList.contains('active')) {
    renderCalendar();
  }
}
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => (toast.style.display = 'none'), duration);
}
// =====================
// GROQ API
// =====================
let GROQ_API_KEY = '';
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

// Load key saat app siap
window.addEventListener('DOMContentLoaded', async () => {
  GROQ_API_KEY = await ipcRenderer.invoke('get-groq-key');
});

async function askOllama(prompt) {
  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    },
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function askOllamaWithImage(prompt, base64Image) {
  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Image}` },
              },
            ],
          },
        ],
        stream: false,
      }),
    },
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// =====================
// IMAGE UPLOAD
// =====================
let currentImageBase64 = null;

function previewImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    currentImageBase64 = e.target.result.split(',')[1];
    const preview = document.getElementById('img-preview');
    preview.src = e.target.result;
    preview.style.display = 'block';
    document.getElementById('upload-placeholder').style.display = 'none';
    document.getElementById('upload-area').classList.add('has-image');
    document.getElementById('btn-clear').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  currentImageBase64 = null;
  document.getElementById('img-preview').style.display = 'none';
  document.getElementById('img-preview').src = '';
  document.getElementById('upload-placeholder').style.display = 'block';
  document.getElementById('upload-area').classList.remove('has-image');
  document.getElementById('btn-clear').style.display = 'none';
  document.getElementById('img-upload').value = '';
}

// =====================
// IDE KONTEN
// =====================
async function generateIdeas() {
  const platform = document.getElementById('idea-platform').value;
  const type = document.getElementById('idea-type').value;
  const mood = document.getElementById('idea-mood').value;

  const resultBox = document.getElementById('ideas-result');
  resultBox.style.display = 'block';
  resultBox.textContent = '⏳ Generating...';

  let trendContext = '';
  try {
    trendContext = await getTrendContext();
  } catch (e) {}

  const prompt = `Kamu adalah social media strategist untuk illustrator anime/manga.
${trendContext ? `\n${trendContext}\nBerdasarkan data tren di atas, b` : 'B'}erikan 5 ide konten spesifik dan kreatif untuk illustrator yang fokus menggambar karakter cowok shota (cute boy anime style).

Platform: ${platform}
Jenis konten: ${type}
Tema/mood: ${mood || 'bebas'}

Format: nomor. judul ide — cara eksekusinya singkat (1-2 kalimat). Langsung ke poin tanpa intro. Bahasa Indonesia yang natural.`;

  try {
    const result = await askOllama(prompt);
    resultBox.textContent = result;
  } catch (err) {
    resultBox.textContent =
      '❌ Gagal konek ke Groq. Cek API key atau koneksi internet.';
  }
}

// =====================
// CAPTION & HOOK
// =====================
async function generateCaption() {
  const platform = document.getElementById('cap-platform').value;
  const goal = document.getElementById('cap-goal').value;
  const desc = document.getElementById('cap-desc').value;
  const tone = document.getElementById('cap-tone').value;

  const toneMap = {
    cute: 'lucu dan menggemaskan',
    casual: 'santai dan friendly',
    hype: 'hype dan excited',
    story: 'bercerita dan emosional',
    funny: 'humoris dan relatable',
  };

  const resultBox = document.getElementById('caption-result');
  resultBox.style.display = 'block';
  resultBox.textContent = '⏳ Generating...';

  let trendContext = '';
  try {
    trendContext = await getTrendContext();
  } catch (e) {}

  let prompt;
  if (currentImageBase64) {
    prompt = `Kamu adalah social media copywriter untuk illustrator anime/manga.
Lihat gambar karya ini dengan seksama. Analisis apa yang kamu lihat — karakter, ekspresi, warna, mood, setting, dan detail visualnya.
${trendContext ? `\n${trendContext}\n` : ''}
Deskripsi tambahan dari user: ${desc || 'tidak ada'}
Platform: ${platform}
Tujuan: ${goal}
Tone: ${toneMap[tone]}

Buat dengan format:
ANALISIS GAMBAR: (apa yang kamu lihat di gambar — 1-2 kalimat)
HOOK: (1 kalimat pembuka yang bikin orang berhenti scroll)
CAPTION: (2-4 kalimat sesuai tone, berdasarkan gambar)
CTA: (ajakan komen/like yang natural)
EMOJI: (3 emoji yang cocok dengan mood gambar)

Bahasa Indonesia yang natural dan gaul.`;
  } else {
    if (!desc.trim()) {
      showToast('Upload gambar atau isi deskripsi karya dulu!');
      resultBox.style.display = 'none';
      return;
    }
    prompt = `Kamu adalah social media copywriter untuk illustrator anime/manga.
${trendContext ? `\n${trendContext}\n` : ''}
Buat caption ${platform} untuk illustrator yang fokus menggambar karakter cowok shota (cute anime boy style).

Deskripsi karya: ${desc}
Tujuan: ${goal}
Tone: ${toneMap[tone]}

Buat dengan format:
HOOK: (1 kalimat pembuka yang bikin orang berhenti scroll)
CAPTION: (2-4 kalimat sesuai tone)
CTA: (ajakan komen/like yang natural)
EMOJI: (3 emoji yang cocok)

Bahasa Indonesia yang natural dan gaul.`;
  }

  try {
    const result = currentImageBase64
      ? await askOllamaWithImage(prompt, currentImageBase64)
      : await askOllama(prompt);
    resultBox.textContent = result;
  } catch (err) {
    resultBox.textContent =
      '❌ Gagal konek ke Groq. Cek API key atau koneksi internet.';
  }
}

// =====================
// HASHTAG - IMAGE UPLOAD
// =====================
let currentImageBase64Hash = null;

function previewImageHash(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    currentImageBase64Hash = e.target.result.split(',')[1];
    const preview = document.getElementById('img-preview-hash');
    preview.src = e.target.result;
    preview.style.display = 'block';
    document.getElementById('upload-placeholder-hash').style.display = 'none';
    document.getElementById('upload-area-hash').classList.add('has-image');
    document.getElementById('btn-clear-hash').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

function clearImageHash() {
  currentImageBase64Hash = null;
  document.getElementById('img-preview-hash').style.display = 'none';
  document.getElementById('img-preview-hash').src = '';
  document.getElementById('upload-placeholder-hash').style.display = 'block';
  document.getElementById('upload-area-hash').classList.remove('has-image');
  document.getElementById('btn-clear-hash').style.display = 'none';
  document.getElementById('img-upload-hash').value = '';
}

// =====================
// HASHTAG GENERATOR
// =====================
async function generateHashtags() {
  const platform = document.getElementById('hash-platform').value;
  const desc = document.getElementById('hash-desc').value;
  const count = document.getElementById('hash-count').value;
  const strategy = document.getElementById('hash-strategy').value;

  if (!desc.trim() && !currentImageBase64Hash) {
    showToast('Upload gambar atau isi deskripsi dulu!');
    return;
  }

  const strategyMap = {
    mix: 'campuran: 50% hashtag niche kecil (di bawah 100rb post), 30% medium (100rb-1jt post), 20% besar (di atas 1jt post)',
    niche:
      'niche spesifik saja — komunitas kecil tapi sangat targeted dan engaged',
    trending: 'trending dan populer — mix hashtag viral dengan yang relevan',
  };

  const resultBox = document.getElementById('hashtag-result');
  resultBox.style.display = 'block';
  resultBox.textContent = '⏳ Generating...';
  document.getElementById('btn-copy-hash').style.display = 'none';

  let trendContext = '';
  try {
    trendContext = await getTrendContext();
  } catch (e) {}

  let prompt;
  if (currentImageBase64Hash) {
    prompt = `Kamu adalah social media hashtag strategist untuk illustrator anime/manga.
Lihat gambar ini dengan seksama. Analisis konten, style, mood, dan elemen visualnya.
${trendContext ? `\n${trendContext}\n` : ''}
Berdasarkan analisis gambar dan data tren di atas, buat ${count} hashtag ${platform} yang paling relevan.

Deskripsi tambahan: ${desc || 'tidak ada'}
Strategi: ${strategyMap[strategy]}

Kelompokkan dengan format:
🎯 NICHE:
(hashtag niche)

📈 MEDIUM:
(hashtag medium)

🔥 BESAR:
(hashtag besar)

Tulis hashtag langsung tanpa penjelasan. Gunakan bahasa Inggris dan Jepang (romaji) karena komunitas anime art global.`;
  } else {
    prompt = `Kamu adalah social media hashtag strategist untuk illustrator anime/manga.
${trendContext ? `\n${trendContext}\n` : ''}
Buat ${count} hashtag ${platform} untuk konten illustrator yang fokus di karakter cowok shota (cute anime boy style).

Deskripsi konten: ${desc}
Strategi: ${strategyMap[strategy]}

Kelompokkan dengan format:
🎯 NICHE:
(hashtag niche)

📈 MEDIUM:
(hashtag medium)

🔥 BESAR:
(hashtag besar)

Tulis hashtag langsung tanpa penjelasan. Gunakan bahasa Inggris dan Jepang (romaji) karena komunitas anime art global.`;
  }

  try {
    const result = currentImageBase64Hash
      ? await askOllamaWithImage(prompt, currentImageBase64Hash)
      : await askOllama(prompt);
    resultBox.textContent = result;
    document.getElementById('btn-copy-hash').style.display = 'inline-block';
  } catch (err) {
    resultBox.textContent =
      '❌ Gagal konek ke Groq. Cek API key atau koneksi internet.';
  }
}

function copyHashtags() {
  const text = document.getElementById('hashtag-result').textContent;
  const hashtagsOnly = text.match(/#\w+/g);
  if (hashtagsOnly) {
    navigator.clipboard.writeText(hashtagsOnly.join(' '));
    document.getElementById('btn-copy-hash').textContent = '✅ Tersalin!';
    setTimeout(() => {
      document.getElementById('btn-copy-hash').textContent =
        '📋 Copy Semua Hashtag';
    }, 2000);
  }
}

// =====================
// JADWAL BULANAN
// =====================
const PLATFORM_COLORS = {
  Instagram: '#e1306c',
  TikTok: '#69c9d0',
  'Twitter/X': '#1d9bf0',
  Facebook: '#1877f2',
};

const CONTENT_TYPE_CLASS = {
  artwork: 'type-artwork',
  wip: 'type-wip',
  noncreative: 'type-noncreative',
  carousel: 'type-carousel',
  speedpaint: 'type-speedpaint',
};

const CONTENT_TYPE_LABEL = {
  artwork: '🖼️',
  wip: '📸',
  noncreative: '✍️',
  carousel: '📖',
  speedpaint: '🎬',
};

let scheduleData = JSON.parse(
  localStorage.getItem('artassist-schedule-v2') || '{}',
);
let editingSlot = null;

// =====================
// AUTO-HAPUS DATA LAMA
// =====================
function cleanOldScheduleData() {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let deleted = 0;
  Object.keys(scheduleData).forEach((key) => {
    if (key < currentMonthKey) {
      delete scheduleData[key];
      deleted++;
    }
  });
  if (deleted > 0) {
    const json = JSON.stringify(scheduleData);
    localStorage.setItem('artassist-schedule-v2', json);
    ipcRenderer.send('schedule-updated', json);
    console.log(`[CleanUp] ${deleted} bulan lama dihapus.`);
  }
}
cleanOldScheduleData();

function saveSchedule() {
  const json = JSON.stringify(scheduleData);
  localStorage.setItem('artassist-schedule-v2', json);
  ipcRenderer.send('schedule-updated', json);
}

function getMonthKey() {
  return document.getElementById('schedule-month')?.value || '';
}

function getDaysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function getFirstDayOfWeek(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const day = new Date(y, m - 1, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

function renderCalendar() {
  const monthInput = document.getElementById('schedule-month');
  if (monthInput && !monthInput.value) {
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const monthKey = getMonthKey();
  const grid = document.getElementById('calendar-month');
  if (!grid || !monthKey) return;
  grid.innerHTML = '';

  // ... sisa kode renderCalendar yang sudah ada
  const DAY_NAMES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  DAY_NAMES.forEach((d) => {
    const h = document.createElement('div');
    h.className = 'cal-month-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  const totalDays = getDaysInMonth(monthKey);
  const firstDay = getFirstDayOfWeek(monthKey);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day-cell empty';
    grid.appendChild(empty);
  }

  const monthPosts = scheduleData[monthKey] || {};

  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${monthKey}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell' + (dateStr === todayStr ? ' today' : '');

    const dayNum = document.createElement('div');
    dayNum.className = 'cal-day-num';
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    const posts = monthPosts[dateStr] || [];
    posts.forEach((post, idx) => {
      const card = document.createElement('div');
      card.className = `cal-month-card ${CONTENT_TYPE_CLASS[post.type] || 'type-artwork'}`;
      card.textContent = `${CONTENT_TYPE_LABEL[post.type] || '🖼️'} ${post.time} ${post.platform}`;
      card.onclick = (e) => {
        e.stopPropagation();
        openModal(dateStr, idx);
      };
      cell.appendChild(card);
    });

    cell.onclick = () => openModal(dateStr, null);
    grid.appendChild(cell);
  }
}

function openModal(dateStr, index) {
  editingSlot = { dateStr, index };
  const posts = (scheduleData[getMonthKey()] || {})[dateStr] || [];
  const post = index !== null ? posts[index] : null;

  document.getElementById('modal-date').value = dateStr;
  document.getElementById('modal-platform').value =
    post?.platform || 'Instagram';
  document.getElementById('modal-time').value = post?.time || '19:00';
  document.getElementById('modal-type').value = post?.type || 'artwork';
  document.getElementById('modal-note').value = post?.note || '';
  document.getElementById('btn-delete-post').style.display =
    index !== null ? 'inline-block' : 'none';
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  editingSlot = null;
}

function savePost() {
  const { dateStr } = editingSlot;
  const monthKey = getMonthKey();
  const post = {
    platform: document.getElementById('modal-platform').value,
    time: document.getElementById('modal-time').value,
    type: document.getElementById('modal-type').value,
    note: document.getElementById('modal-note').value,
  };

  if (!scheduleData[monthKey]) scheduleData[monthKey] = {};
  if (!scheduleData[monthKey][dateStr]) scheduleData[monthKey][dateStr] = [];

  const { index } = editingSlot;
  if (index !== null) {
    scheduleData[monthKey][dateStr][index] = post;
  } else {
    scheduleData[monthKey][dateStr].push(post);
    scheduleData[monthKey][dateStr].sort((a, b) =>
      a.time.localeCompare(b.time),
    );
  }

  saveSchedule();
  closeModal();
  renderCalendar();
}

function deletePost() {
  const { dateStr, index } = editingSlot;
  const monthKey = getMonthKey();
  scheduleData[monthKey][dateStr].splice(index, 1);
  saveSchedule();
  closeModal();
  renderCalendar();
}

function clearMonthSchedule() {
  const monthKey = getMonthKey();
  if (!monthKey) return;
  if (!confirm(`Kosongkan semua jadwal bulan ${monthKey}?`)) return;
  delete scheduleData[monthKey];
  saveSchedule();
  renderCalendar();
}

function exportSchedule() {
  const monthKey = getMonthKey();
  const monthPosts = scheduleData[monthKey] || {};
  let text = `📅 JADWAL POSTING — ${monthKey}\n\n`;
  Object.keys(monthPosts)
    .sort()
    .forEach((dateStr) => {
      const posts = monthPosts[dateStr];
      if (posts.length) {
        text += `${dateStr}\n`;
        posts.forEach((p) => {
          text += `  • ${p.time} — ${p.platform} — ${p.type}${p.note ? ` (${p.note})` : ''}\n`;
        });
        text += '\n';
      }
    });
  navigator.clipboard.writeText(text);
  showToast('Jadwal tersalin ke clipboard!');
}

async function generateScheduleSuggestion() {
  const monthKey = getMonthKey();
  if (!monthKey) {
    showToast('Pilih bulan dulu!');
    return;
  }

  const complexity = document.getElementById('art-complexity').value;
  const activeDays = document.getElementById('art-active-days').value;
  const totalDays = getDaysInMonth(monthKey);
  const [y, m] = monthKey.split('-');

  const complexityMap = {
    sketch: '1-2 hari per karya',
    medium: '3-4 hari per karya',
    detail: '5-7 hari per karya',
  };

  let trendContext = '';
  try {
    trendContext = await getTrendContext();
  } catch (e) {}

  const prompt = `Kamu adalah social media strategist untuk illustrator anime/manga.
${trendContext ? `\n${trendContext}\n` : ''}
Buat jadwal posting realistis untuk bulan ${monthKey} (total ${totalDays} hari).

Kondisi artist:
- Waktu selesaikan 1 karya: ${complexityMap[complexity]}
- Hari aktif menggambar per minggu: ${activeDays} hari
- Jenis konten tersedia: artwork baru, WIP/behind the scenes, carousel/thread, konten teks/meme, speed draw

Aturan penting:
- Karya baru hanya bisa dipost setelah cukup waktu menggambar
- Hari tidak menggambar bisa diisi WIP, carousel, atau konten teks
- Jangan lebih dari 1 post per hari
- Total posting realistis maksimal 14-18 post
- Gunakan jam posting 07:00, 12:00, 19:00, atau 21:00
- Pertimbangkan tren yang sedang populer dari data di atas

Balas HANYA dengan JSON format ini, tanpa penjelasan apapun:
{
  "${y}-${m}-03": [{"platform":"Instagram","time":"19:00","type":"artwork","note":"karya pertama bulan ini"}],
  "${y}-${m}-07": [{"platform":"TikTok","time":"19:00","type":"wip","note":"proses sketching"}]
}

type hanya boleh: artwork, wip, noncreative, carousel, speedpaint`;

  const btn = document.querySelector('#schedule .btn-generate');
  if (btn) {
    btn.textContent = '⏳ Generating...';
    btn.disabled = true;
  }

  try {
    const raw = await askOllama(prompt);
    let suggestion;
    try {
      const cleaned = cleanOllamaJSON(raw);
      suggestion = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('Format JSON tidak valid dari Groq');
    }

    if (!scheduleData[monthKey]) scheduleData[monthKey] = {};
    Object.keys(suggestion).forEach((dateStr) => {
      if (
        !scheduleData[monthKey][dateStr] ||
        scheduleData[monthKey][dateStr].length === 0
      ) {
        scheduleData[monthKey][dateStr] = suggestion[dateStr];
      }
    });

    saveSchedule();
    renderCalendar();
  } catch (err) {
    showToast('Gagal generate jadwal. Coba lagi atau isi manual.');
  } finally {
    const btn = document.querySelector('#schedule .btn-generate');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✦ Auto-isi Jadwal';
    }
  }
}

// =====================
// THREAD / CAROUSEL
// =====================
document.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthInput = document.getElementById('schedule-month');
  if (monthInput) {
    monthInput.value = defaultMonth;
    monthInput.addEventListener('change', renderCalendar);
  }
  renderCalendar();
  document.querySelectorAll('.nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.page === 'schedule') setTimeout(renderCalendar, 50);
    });
  });
});

async function generateThread() {
  const platform = document.getElementById('thread-platform').value;
  const topic = document.getElementById('thread-topic').value.trim();
  const goal = document.getElementById('thread-goal').value;
  const count = document.getElementById('thread-count').value;
  const tone = document.getElementById('thread-tone').value;

  if (!topic) {
    showToast('Isi topik dulu!');
    return;
  }

  const toneMap = {
    casual: 'santai, personal, seperti ngobrol dengan teman',
    edu: 'edukatif, informatif, jelas dan mudah dipahami',
    hype: 'energetik, excited, bikin semangat',
    story: 'bercerita, emosional, membangun narasi',
  };

  const isTwitter = platform.includes('Twitter');
  const formatName = isTwitter ? 'thread Twitter/X' : 'carousel Instagram';

  const prompt = `Kamu adalah content creator untuk illustrator anime/manga.
Buat ${formatName} dengan ${count} bagian tentang: "${topic}"
Tujuan: ${goal}
Tone: ${toneMap[tone]}
${
  isTwitter
    ? `Setiap tweet maksimal 280 karakter. Gunakan emoji, numbering (1/${count}, 2/${count} dst).`
    : `Setiap slide: judul singkat (max 8 kata) + body 2-3 kalimat. Gunakan emoji.`
}

Format output WAJIB seperti ini:
SLIDE_1
${isTwitter ? 'ISI TWEET PERTAMA (hook yang bikin orang mau baca lanjut)' : 'JUDUL: judul slide\nISI: isi slide'}

SLIDE_2
${isTwitter ? 'ISI TWEET KEDUA' : 'JUDUL: judul slide\nISI: isi slide'}

...dst sampai SLIDE_${count}

Bahasa Indonesia yang natural. Fokus untuk komunitas illustrator anime.`;

  const container = document.getElementById('thread-result-container');
  const slidesEl = document.getElementById('thread-slides');
  const label = document.getElementById('thread-result-label');

  container.style.display = 'block';
  slidesEl.innerHTML =
    '<div style="color:#a78bfa;font-size:13px">⏳ Generating...</div>';

  try {
    const result = await askOllama(prompt);
    label.textContent = isTwitter
      ? `🧵 Thread (${count} tweets)`
      : `📖 Carousel (${count} slides)`;

    const rawSlides = result.split(/SLIDE_\d+\n?/).filter((s) => s.trim());
    slidesEl.innerHTML = '';

    rawSlides.forEach((content, i) => {
      const card = document.createElement('div');
      card.className = 'thread-card';

      const num = document.createElement('div');
      num.className = 'thread-num';
      num.textContent = isTwitter
        ? `${i + 1}/${rawSlides.length}`
        : `Slide ${i + 1}`;
      card.appendChild(num);

      if (!isTwitter && content.includes('JUDUL:')) {
        const titleMatch = content.match(/JUDUL:\s*(.+)/);
        const bodyMatch = content.match(/ISI:\s*([\s\S]+)/);
        if (titleMatch) {
          const title = document.createElement('div');
          title.className = 'thread-slide-title';
          title.textContent = titleMatch[1].trim();
          card.appendChild(title);
        }
        if (bodyMatch) {
          const body = document.createElement('div');
          body.className = 'thread-slide-body';
          body.textContent = bodyMatch[1].trim();
          card.appendChild(body);
        }
      } else {
        const body = document.createElement('div');
        body.className = 'thread-slide-body';
        body.textContent = content.trim();
        card.appendChild(body);
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-copy-slide';
      copyBtn.textContent = '📋';
      copyBtn.title = 'Copy slide ini';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(content.trim());
        copyBtn.textContent = '✅';
        setTimeout(() => (copyBtn.textContent = '📋'), 1500);
      };
      card.appendChild(copyBtn);
      slidesEl.appendChild(card);
    });
  } catch (err) {
    slidesEl.innerHTML =
      '<div style="color:#ff6b6b">❌ Gagal konek ke Groq. Cek API key.</div>';
  }
}

function copyThread() {
  const cards = document.querySelectorAll('.thread-card .thread-slide-body');
  const text = Array.from(cards)
    .map((el, i) => `${i + 1}. ${el.textContent}`)
    .join('\n\n');
  navigator.clipboard.writeText(text);
  const btn = document.querySelector('#thread-result-container .btn-copy');
  btn.textContent = '✅ Tersalin!';
  setTimeout(() => (btn.textContent = '📋 Copy Semua'), 2000);
}
// =====================
// TIPS GROWTH
// =====================
const TIPS_DATA = [
  // INSTAGRAM - ALGORITMA
  {
    platform: 'Instagram',
    category: 'Algoritma',
    goal: 'Nambah Followers',
    title: 'Post Reels dulu, foto belakangan',
    body: 'Algoritma IG 2024 sangat memprioritaskan Reels untuk reach organik. Speed draw 15-30 detik jauh lebih mudah viral dibanding static post.',
    action: '⚡ Action: Konversi 1 karya per minggu jadi Reels speed draw.',
  },
  {
    platform: 'Instagram',
    category: 'Algoritma',
    goal: 'Viral',
    title: 'Hook 3 detik pertama = segalanya',
    body: 'Instagram mengukur "watch time". Mulai Reels dengan bagian paling menarik dari prosesmu — bukan dari awal sketsa yang kosong.',
    action:
      '⚡ Action: Mulai video dari reveal akhir, lalu mundur ke prosesnya.',
  },
  {
    platform: 'Instagram',
    category: 'Engagement',
    goal: 'Nambah Followers',
    title: 'CTA spesifik lebih efektif dari "like & follow"',
    body: 'Ganti "follow untuk konten lebih banyak" dengan pertanyaan spesifik: "Kalau karakter ini punya kekuatan, kamu pilih apa?" — komentar meledak.',
    action:
      '⚡ Action: Setiap caption wajib ada 1 pertanyaan yang mudah dijawab.',
  },
  {
    platform: 'Instagram',
    category: 'Engagement',
    goal: 'Viral',
    title: 'Balas komentar dalam 1 jam pertama',
    body: 'IG boost post yang dapat engagement cepat. Balas setiap komentar dalam 60 menit setelah posting untuk trigger algoritma.',
    action: '⚡ Action: Set alarm 1 jam setelah jadwal posting.',
  },
  {
    platform: 'Instagram',
    category: 'Konsistensi',
    goal: 'Nambah Followers',
    title: 'Posting jam 19.00–21.00 WIB',
    body: 'Audience anime art Indonesia paling aktif setelah pulang sekolah/kerja. Hindari posting tengah hari saat engagement rendah.',
    action: '⚡ Action: Jadwalkan semua post di jam ini via Creator Studio.',
  },
  {
    platform: 'Instagram',
    category: 'Branding',
    goal: 'Dapet Komisi',
    title: 'Bio harus ada kata "commission"',
    body: 'Klien yang cari komisioner browse profile, bukan DM langsung. Pastikan bio-mu jelas: "Open Commission | DM for info" + link price list.',
    action:
      '⚡ Action: Update bio sekarang, tambah link Carrd/Notion price list.',
  },
  {
    platform: 'Instagram',
    category: 'Branding',
    goal: 'Dapet Komisi',
    title: 'Highlight "Commission Info" di profil',
    body: 'Buat Story Highlight khusus berisi contoh karya komisi, harga, dan cara order. Ini berfungsi seperti portofolio mini yang selalu terlihat.',
    action: '⚡ Action: Buat highlight dengan cover icon yang konsisten.',
  },

  // TIKTOK - ALGORITMA
  {
    platform: 'TikTok',
    category: 'Algoritma',
    goal: 'Viral',
    title: 'Video 7–15 detik punya reach tertinggi',
    body: 'TikTok memprioritaskan completion rate. Video pendek lebih mudah ditonton habis. Speed draw dengan musik trending = kombinasi paling kuat.',
    action:
      '⚡ Action: Buat speed draw 10 detik per karya, gunakan sound trending.',
  },
  {
    platform: 'TikTok',
    category: 'Algoritma',
    goal: 'Nambah Followers',
    title: 'Pakai niche hashtag, bukan mega hashtag',
    body: '#art punya miliaran post — kamu tenggelam. Coba #animeartist #digitalartprocess #animefanart yang lebih tertarget dan kompetisinya lebih rendah.',
    action:
      '⚡ Action: Gunakan 3-5 hashtag niche, 1-2 hashtag medium per post.',
  },
  {
    platform: 'TikTok',
    category: 'Engagement',
    goal: 'Viral',
    title: 'Stitch & Duet konten trending',
    body: 'Reaksi terhadap konten viral lebih mudah masuk FYP daripada konten original. Stitch video "rate my art style" atau tren "anime vs reality".',
    action: '⚡ Action: Monitor trending sounds di tab Discover setiap minggu.',
  },
  {
    platform: 'TikTok',
    category: 'Konsistensi',
    goal: 'Nambah Followers',
    title: 'Posting 1x sehari selama 30 hari pertama',
    body: 'Algoritma TikTok reward akun yang konsisten di awal. 30 hari sprint di awal bisa 10x lebih efektif dari posting sporadis selama setahun.',
    action: '⚡ Action: Batch record 7 video sekaligus, jadwalkan otomatis.',
  },
  {
    platform: 'TikTok',
    category: 'Branding',
    goal: 'Dapet Komisi',
    title: 'Pinned video = etalase komisianmu',
    body: 'Pin 3 video terbaikmu: 1 showcase hasil komisi, 1 proses speed draw, 1 video "commission open". Ini yang pertama dilihat calon klien.',
    action: '⚡ Action: Atur 3 pinned video di profil sekarang.',
  },

  // TWITTER/X - ALGORITMA
  {
    platform: 'Twitter/X',
    category: 'Algoritma',
    goal: 'Viral',
    title: 'Post karya tanpa link eksternal',
    body: 'X/Twitter sangat men-downgrade post yang berisi link (ke IG, Pixiv, dll). Post karya langsung di X, simpan link untuk reply atau bio.',
    action:
      '⚡ Action: Upload gambar langsung ke X, jangan link dari platform lain.',
  },
  {
    platform: 'Twitter/X',
    category: 'Engagement',
    goal: 'Nambah Followers',
    title: 'Thread "proses karya" selalu perform bagus',
    body: 'Komunitas art di X sangat menghargai behind-the-scenes. Thread 5-7 tweet dari sketch → lineart → coloring → final bisa dapat ratusan retweet.',
    action: '⚡ Action: Buat 1 thread proses karya per minggu.',
  },
  {
    platform: 'Twitter/X',
    category: 'Engagement',
    goal: 'Viral',
    title: 'Quote tweet artis besar dengan karyamu',
    body: 'Quote tweet challenge atau prompt dari artis besar di niche-mu. Followers mereka akan lihat karyamu — exposure gratis ke audiens yang relevan.',
    action: '⚡ Action: Ikuti minimal 1 art challenge atau prompt per minggu.',
  },
  {
    platform: 'Twitter/X',
    category: 'Branding',
    goal: 'Dapet Komisi',
    title: 'Tweet "commission open" setiap Senin pagi',
    body: 'Konsistensi pengumuman komisi membangun ekspektasi. Followers akan ingat dan menunggu. Sertakan contoh karya terbaru dan harga singkat.',
    action:
      '⚡ Action: Jadwalkan tweet "Commission Open" setiap Senin jam 08.00.',
  },
  {
    platform: 'Twitter/X',
    category: 'Konsistensi',
    goal: 'Nambah Followers',
    title: 'Engage di #FollowFriday dan art community',
    body: 'Retweet dan komentari karya artis lain di niche yang sama. Komunitas X sangat mutual-driven — support orang lain = dapat support balik.',
    action:
      '⚡ Action: Luangkan 10 menit sehari untuk engage dengan 3-5 artis lain.',
  },

  // MULTI-PLATFORM - KONSISTENSI & BRANDING
  {
    platform: 'Instagram',
    category: 'Konsistensi',
    goal: 'Nambah Followers',
    title: 'Batching konten = game changer',
    body: 'Jangan buat konten hari H. Setiap Minggu, buat 3-4 konten sekaligus lalu jadwalkan. Ini menghilangkan tekanan harian dan menjaga konsistensi.',
    action: '⚡ Action: Blokir 2-3 jam setiap Minggu untuk batching konten.',
  },
  {
    platform: 'TikTok',
    category: 'Branding',
    goal: 'Nambah Followers',
    title: 'Punya "signature style" yang mudah dikenali',
    body: 'Artis yang tumbuh cepat punya visual identity yang konsisten — color palette, jenis karakter, atau tema tertentu. Orang follow karena tahu apa yang akan mereka dapat.',
    action: '⚡ Action: Tentukan 1-2 tema utama yang selalu kamu post.',
  },
  {
    platform: 'Instagram',
    category: 'Engagement',
    goal: 'Dapet Komisi',
    title: 'Testimoni klien = iklan terbaik',
    body: 'Screenshot pujian klien (dengan izin) dan post sebagai Story atau feed. Social proof jauh lebih efektif dari self-promo untuk menarik klien baru.',
    action:
      '⚡ Action: Minta setiap klien untuk kasih feedback setelah komisi selesai.',
  },
];

let tipsFilters = { platform: 'semua', category: 'semua', goal: 'semua' };

function renderTipsCards() {
  const grid = document.getElementById('tips-grid');
  if (!grid) return;

  const filtered = TIPS_DATA.filter(
    (t) =>
      (tipsFilters.platform === 'semua' ||
        t.platform === tipsFilters.platform) &&
      (tipsFilters.category === 'semua' ||
        t.category === tipsFilters.category) &&
      (tipsFilters.goal === 'semua' || t.goal === tipsFilters.goal),
  );

  if (!filtered.length) {
    grid.innerHTML =
      '<div class="tips-empty">Tidak ada tips untuk filter ini.</div>';
    return;
  }

  grid.innerHTML = filtered
    .map(
      (t) => `
    <div class="tips-card">
      <div class="tips-card-badges">
        <span class="tips-badge tips-badge-platform">${t.platform}</span>
        <span class="tips-badge tips-badge-category">${t.category}</span>
        <span class="tips-badge tips-badge-goal">${t.goal}</span>
      </div>
      <div class="tips-card-title">${t.title}</div>
      <div class="tips-card-body">${t.body}</div>
      <div class="tips-card-action">${t.action}</div>
    </div>
  `,
    )
    .join('');
}

document.addEventListener('DOMContentLoaded', () => {
  renderTipsCards();

  document.querySelectorAll('.tips-tag').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      const val = btn.dataset.val;
      tipsFilters[filter] = val;
      // Update active state hanya di group yang sama
      btn
        .closest('.tips-filter-btns')
        .querySelectorAll('.tips-tag')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderTipsCards();
    });
  });
});

document.querySelectorAll('.nav').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.page === 'tips') renderTipsCards();
  });
});

async function generateAITips() {
  const platform = document.getElementById('ai-tips-platform').value;
  const problem = document.getElementById('ai-tips-problem').value;
  const followersVal = document.getElementById('ai-tips-followers').value;
  const target = document.getElementById('ai-tips-target').value;
  const desc = document.getElementById('ai-tips-desc').value.trim();

  const followersMap = {
    nano: 'di bawah 1.000 followers',
    micro: '1.000–10.000 followers',
    mid: '10.000–50.000 followers',
    macro: 'lebih dari 50.000 followers',
  };

  const prompt = `Kamu adalah social media strategist spesialis untuk ilustrator anime/manga.

Situasi user:
- Platform: ${platform}
- Masalah: ${problem}
- Followers saat ini: ${followersMap[followersVal]}
- Target 3 bulan: ${target}
${desc ? `- Deskripsi tambahan: ${desc}` : ''}

Berikan 5 tips growth yang spesifik, actionable, dan realistis untuk situasi ini.
Fokus pada strategi yang bisa langsung diterapkan hari ini.
Bahasa Indonesia yang santai dan personal, seperti ngobrol sesama seniman.

Format setiap tips:
🔹 [Judul Tips]
[Penjelasan 2-3 kalimat]
⚡ Action: [langkah konkret yang bisa dilakukan hari ini]`;

  const resultEl = document.getElementById('ai-tips-result');
  resultEl.style.display = 'block';
  resultEl.textContent = '⏳ AI sedang menyusun tips untuk situasimu...';

  try {
    const result = await askOllama(prompt);
    resultEl.textContent = result;
  } catch (err) {
    resultEl.textContent =
      '❌ Gagal konek ke Groq. Cek API key atau koneksi internet.';
  }
}

// =====================
// AUTO-START & SETTINGS
// =====================
async function getAutoStart() {
  return await ipcRenderer.invoke('get-autostart');
}

async function setAutoStart(enable) {
  const result = await ipcRenderer.invoke('set-autostart', enable);
  const toggle = document.getElementById('toggle-autostart');
  if (toggle) toggle.checked = result;
  showToast(
    result ? '✅ Auto-start diaktifkan' : '📌 Auto-start dinonaktifkan',
  );
}

document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggle-autostart');
  if (toggle) {
    toggle.checked = await getAutoStart();
    toggle.addEventListener('change', (e) => setAutoStart(e.target.checked));
  }
});
// =====================
// CHAT AI
// Tambahkan ke bagian bawah renderer.js
// (atau buat file chat.js dan include di index.html)
// =====================

const CHAT_SYSTEM_PROMPT = `Kamu adalah ArtAssist AI, asisten pribadi untuk illustrator anime/manga Indonesia.

Kamu ahli di:
- Strategi konten & social media (Instagram, TikTok, Twitter/X)
- Tips menggambar dan improvement skill
- Pricing & manajemen komisi
- Branding personal sebagai artist
- Analisis tren anime & art community

Gaya komunikasi:
- Santai, friendly, seperti teman sesama seniman
- Bahasa Indonesia yang natural (boleh mix sedikit English kalau relevan)
- Jawaban konkret dan actionable, bukan teori kosong
- Pakai emoji secukupnya biar tidak kaku
- Kalau ada tips, beri langkah spesifik yang bisa dilakukan hari ini`;

let chatHistory = [];
let chatIsTyping = false;

function appendChatBubble(role, content) {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return null;

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;

  if (role === 'ai') {
    bubble.innerHTML = `
      <div class="chat-bubble-avatar">✦</div>
      <div class="chat-bubble-content">${content}</div>`;
  } else {
    bubble.innerHTML = `<div class="chat-bubble-content">${content}</div>`;
  }

  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function showTypingIndicator() {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return null;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble ai typing';
  bubble.id = 'chat-typing-indicator';
  bubble.innerHTML = `
    <div class="chat-bubble-avatar">✦</div>
    <div class="chat-bubble-content">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>`;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function removeTypingIndicator() {
  const el = document.getElementById('chat-typing-indicator');
  if (el) el.remove();
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!input || chatIsTyping) return;

  const message = input.value.trim();
  if (!message) return;

  // Reset input
  input.value = '';
  input.style.height = 'auto';

  // Sembunyikan suggestion chips setelah pertama kali kirim
  const suggestions = document.getElementById('chat-suggestions');
  if (suggestions) suggestions.style.display = 'none';

  // Tampilkan bubble user
  appendChatBubble('user', escapeHtml(message));

  // Tambah ke history
  chatHistory.push({ role: 'user', content: message });

  // Lock UI
  chatIsTyping = true;
  sendBtn.disabled = true;
  showTypingIndicator();

  try {
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            ...chatHistory,
          ],
          max_tokens: 1024,
          stream: false,
        }),
      },
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const reply = data.choices[0].message.content;
    chatHistory.push({ role: 'assistant', content: reply });

    removeTypingIndicator();
    appendChatBubble('ai', formatChatReply(reply));
  } catch (err) {
    removeTypingIndicator();
    appendChatBubble(
      'ai',
      '❌ Gagal konek ke Groq. Cek API key atau koneksi internet.',
    );
  } finally {
    chatIsTyping = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function handleChatKey(event) {
  // Enter = kirim, Shift+Enter = baris baru
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

function autoResizeInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function useSuggestion(btn) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = btn.textContent.replace(/^[^\w\s]*\s*/, ''); // hapus emoji di depan
    input.focus();
    sendChatMessage();
  }
}

function clearChat() {
  chatHistory = [];
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;
  messagesEl.innerHTML = `
    <div class="chat-bubble ai">
      <div class="chat-bubble-avatar">✦</div>
      <div class="chat-bubble-content">
        Chat direset. Ada yang bisa aku bantu? 😊
      </div>
    </div>`;

  // Tampilkan suggestion lagi
  const suggestions = document.getElementById('chat-suggestions');
  if (suggestions) suggestions.style.display = 'flex';
}

// Format reply: bold **text**, newline jadi <br>
function formatChatReply(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render dashboard saat nav chat diklik (sama seperti halaman lain)
document.querySelectorAll('.nav').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.page === 'chat') {
      setTimeout(() => {
        document.getElementById('chat-input')?.focus();
      }, 50);
    }
  });
});
