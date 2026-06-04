require('dotenv').config();
const { supabase } = require('./supabase');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  Notification,
  nativeImage,
  Tray,
  Menu,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// =====================
// SINGLE INSTANCE LOCK
// =====================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Ada instance lain yang sudah jalan — langsung quit
  app.quit();
} else {
  // Kalau ada yang coba buka instance kedua, fokus ke window yang sudah ada
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

let ollamaProcess = null;
let mainWindow = null;
let tray = null;
let reminderInterval = null;
const NOTIFIED_KEY_PREFIX = 'notified-'; // track notif yang sudah dikirim hari ini

// =====================
// AUTO-START OLLAMA
// =====================
function startOllama() {
  exec('tasklist', (err, stdout) => {
    if (stdout.toLowerCase().includes('ollama')) {
      console.log('Ollama sudah berjalan.');
      return;
    }

    const ollamaPaths = [
      path.join(
        process.env.LOCALAPPDATA || '',
        'Programs',
        'Ollama',
        'ollama.exe',
      ),
      'C:\\Program Files\\Ollama\\ollama.exe',
      'ollama',
    ];

    let started = false;
    for (const ollamaPath of ollamaPaths) {
      try {
        ollamaProcess = spawn(ollamaPath, ['serve'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        ollamaProcess.on('error', () => {});
        ollamaProcess.unref();
        console.log(`Ollama dimulai dari: ${ollamaPath}`);
        started = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!started) {
      console.warn('Ollama tidak ditemukan. Pastikan Ollama sudah terinstall.');
    }
  });
}

// =====================
// BACA JADWAL DARI DISK
// =====================
function getScheduleData() {
  // Electron simpan localStorage di file leveldb, tidak bisa dibaca langsung.
  // Renderer akan kirim data via IPC setiap kali jadwal berubah.
  // Main process simpan salinannya di file JSON sederhana.
  const dataPath = path.join(app.getPath('userData'), 'schedule-cache.json');
  try {
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('Gagal baca schedule cache:', e.message);
  }
  return {};
}

// =====================
// LABEL TIPE KONTEN
// =====================
const TYPE_LABELS = {
  artwork: '🖼️ Karya Baru',
  wip: '📸 WIP / BTS',
  noncreative: '✍️ Teks / Meme',
  carousel: '📖 Carousel',
  speedpaint: '🎬 Speed Draw',
};

// =====================
// PUTAR SUARA NOTIFIKASI
// =====================
function playNotificationSound() {
  const candidates = [
    path.join(__dirname, 'assets', 'notification.wav'),
    path.join(__dirname, 'assets', 'notification.mp3'),
  ];

  const assetPath = candidates.find((p) => fs.existsSync(p));

  if (!assetPath) {
    console.warn('[Sound] File tidak ditemukan di assets/');
    return;
  }

  console.log('[Sound] Playing:', assetPath);

  // Cara 1: PowerShell — paling reliable di Windows, tidak butuh window visible
  const psCmd =
    `powershell -NoProfile -WindowStyle Hidden -Command "` +
    `$player = New-Object System.Media.SoundPlayer '${assetPath.replace(/'/g, "''")}'; ` +
    `$player.PlaySync()"`;

  exec(psCmd, (err) => {
    if (err) {
      console.warn('[Sound] PowerShell gagal:', err.message);
      // Cara 2: fallback ke renderer jika window ada dan visible
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('play-sound', assetPath);
        console.log('[Sound] Fallback ke renderer');
      }
    } else {
      console.log('[Sound] ✅ PowerShell berhasil');
    }
  });
}

// =====================
// CEK & KIRIM NOTIFIKASI
// =====================
// notifiedToday: Set berisi key "dateStr|time|platform" yang sudah dinotif hari ini
const notifiedToday = new Set();
let lastNotifDate = ''; // reset notifiedToday tiap hari baru

function checkAndNotify() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  console.log(`[Check] ${todayStr} ${currentTime}`);

  // Reset set notifikasi tiap hari baru
  if (lastNotifDate !== todayStr) {
    notifiedToday.clear();
    lastNotifDate = todayStr;
  }

  const allData = getScheduleData();
  const todayPosts = (allData[monthKey] || {})[todayStr] || [];

  console.log(`[Check] Posts hari ini: ${todayPosts.length}`);
  if (todayPosts.length > 0) {
    console.log(
      `[Check] Post times: ${todayPosts.map((p) => p.time).join(', ')}`,
    );
  }

  // Cek apakah file cache ada
  const dataPath = path.join(app.getPath('userData'), 'schedule-cache.json');
  console.log(`[Check] Cache path: ${dataPath}`);
  console.log(`[Check] Cache exists: ${fs.existsSync(dataPath)}`);

  todayPosts.forEach((post) => {
    const key = `${todayStr}|${post.time}|${post.platform}`;

    console.log(
      `[Check] Comparing post.time="${post.time}" vs currentTime="${currentTime}"`,
    );

    // Kirim notif kalau waktunya cocok dan belum pernah dinotif
    if (post.time === currentTime && !notifiedToday.has(key)) {
      notifiedToday.add(key);

      const typeLabel = TYPE_LABELS[post.type] || post.type;
      const noteText = post.note ? `\n📝 ${post.note}` : '';

      console.log(`[Notif] Supported: ${Notification.isSupported()}`);

      if (Notification.isSupported()) {
        const notif = new Notification({
          title: `📅 Waktunya posting di ${post.platform}!`,
          body: `${typeLabel}${noteText}\n⏰ ${post.time}`,
          urgency: 'normal',
          timeoutType: 'default',
          silent: false,
        });

        // Klik notif → buka / fokus ke app
        notif.on('click', () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          }
        });

        notif.show();
        console.log(
          `[Notif] SENT: ${post.platform} — ${typeLabel} jam ${post.time}`,
        );

        // Putar suara notifikasi
        playNotificationSound();
      }
    }
  });
}

// =====================
// MULAI / STOP REMINDER
// =====================
function startReminderLoop() {
  if (reminderInterval) return;
  // Cek setiap 30 detik supaya tidak telat > 30 detik dari waktu yang dijadwalkan
  reminderInterval = setInterval(checkAndNotify, 30 * 1000);
  console.log('Reminder loop started.');
}

function stopReminderLoop() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}

// =====================
// BUAT WINDOW
// =====================
function createWindow() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
      },
    });
  });

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
    title: 'ArtAssist',
    autoHideMenuBar: true,
  });

  // Izinkan autoplay media tanpa interaksi user
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(true);
    },
  );

  mainWindow.loadFile('index.html');

  // Kalau di-close, sembunyi ke tray (bukan quit)
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// =====================
// SYSTEM TRAY
// =====================
function createTray() {
  if (tray && !tray.isDestroyed()) return; // sudah ada dan masih hidup, skip
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const trayIcon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('ArtAssist — Reminder aktif 🐺');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '✦ Buka ArtAssist',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: '❌ Keluar',
      click: () => {
        app.isQuitting = true;
        tray.destroy();
        tray = null;
        stopReminderLoop();
        exec('taskkill /F /IM ollama.exe', () => {});
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Klik icon tray → buka/fokus window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// =====================
// IPC — DARI RENDERER
// =====================

// Renderer kirim data jadwal terbaru setiap kali ada perubahan
ipcMain.on('schedule-updated', async (event, scheduleJSON) => {
  // Simpan lokal seperti biasa
  const dataPath = path.join(app.getPath('userData'), 'schedule-cache.json');
  try {
    fs.writeFileSync(dataPath, scheduleJSON, 'utf-8');
    console.log('Schedule cache updated (local).');
  } catch (e) {
    console.warn('Gagal simpan schedule cache lokal:', e.message);
  }

  // Sync ke Supabase
  try {
    const allData = JSON.parse(scheduleJSON);
    for (const monthKey of Object.keys(allData)) {
      const monthData = allData[monthKey];
      for (const dateKey of Object.keys(monthData)) {
        const posts = monthData[dateKey];
        await supabase.from('schedule').upsert(
          {
            user_id: 'raookami',
            month_key: monthKey,
            date_key: dateKey,
            posts: posts,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,month_key,date_key' },
        );
      }
    }
    console.log('Schedule synced to Supabase.');
  } catch (e) {
    console.warn('Gagal sync ke Supabase:', e.message);
  }
});

// Renderer tanya status auto-start
ipcMain.handle('get-autostart', () => {
  return app.getLoginItemSettings().openAtLogin;
});

// Renderer minta toggle auto-start
ipcMain.handle('set-autostart', (event, enable) => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    openAsHidden: true,
  });
  return app.getLoginItemSettings().openAtLogin;
});

// =====================
// FETCH REDDIT
// =====================
function fetchWithRedirect(url, options, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));
    https
      .get(url, options, (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          res.resume();
          return fetchWithRedirect(redirectUrl, options, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

ipcMain.handle('fetch-reddit', async (event, url) => {
  const options = {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    rejectUnauthorized: false,
  };
  return fetchWithRedirect(url, options);
});

// Renderer minta Supabase config
ipcMain.handle('get-supabase-config', () => {
  return {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  };
});

// Renderer minta API key secara aman
ipcMain.handle('get-groq-key', () => {
  return process.env.GROQ_API_KEY;
});

// =====================
// AUTO UPDATER
// =====================
function setupAutoUpdater() {
  // Cek update diam-diam di background
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', () => {
    if (Notification.isSupported()) {
      new Notification({
        title: '🔄 Update ArtAssist tersedia!',
        body: 'Sedang mengunduh update terbaru di background...',
        silent: false,
      }).show();
    }
  });

  autoUpdater.on('update-downloaded', () => {
    // Tampilkan notif + opsi install sekarang
    if (Notification.isSupported()) {
      const notif = new Notification({
        title: '✅ Update siap dipasang!',
        body: 'Klik untuk restart dan install update ArtAssist.',
      });
      notif.on('click', () => {
        autoUpdater.quitAndInstall();
      });
      notif.show();
    }

    // Juga tampilkan dialog di window kalau sedang buka
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded'); // kirim sinyal ke renderer
    }
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater] Error:', err.message);
  });
}

// Test suara dari renderer (tombol debug)
ipcMain.on('test-sound', () => {
  playNotificationSound();
});
ipcMain.on('test-notif-debug', () => {
  console.log(
    '[Debug] Notification.isSupported():',
    Notification.isSupported(),
  );
  const n = new Notification({
    title: '🔔 Test dari Main',
    body: 'Kalau ini muncul, notif main process OK',
  });
  n.show();
  console.log('[Debug] n.show() dipanggil');
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});

// =====================
// APP LIFECYCLE
// =====================
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
// Izinkan autoplay audio tanpa user gesture (wajib untuk notifikasi suara)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('com.artassist.app'); // ← tambahkan ini

app.whenReady().then(() => {
  startOllama();
  createTray();

  setTimeout(() => {
    createWindow();
    startReminderLoop();
    checkAndNotify();
    setupAutoUpdater(); // cek update setelah window siap
  }, 2000);

  app.on('activate', () => {
    // Klik ikon taskbar → tampilkan window yang sudah ada, jangan buat baru
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Jangan quit — biarkan app tetap jalan di tray
  // Quit hanya lewat menu tray "Keluar"
});
