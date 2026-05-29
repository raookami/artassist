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

  // Reset set notifikasi tiap hari baru
  if (lastNotifDate !== todayStr) {
    notifiedToday.clear();
    lastNotifDate = todayStr;
  }

  const allData = getScheduleData();
  const todayPosts = (allData[monthKey] || {})[todayStr] || [];

  todayPosts.forEach((post) => {
    const key = `${todayStr}|${post.time}|${post.platform}`;

    // Kirim notif kalau waktunya cocok dan belum pernah dinotif
    if (post.time === currentTime && !notifiedToday.has(key)) {
      notifiedToday.add(key);

      const typeLabel = TYPE_LABELS[post.type] || post.type;
      const noteText = post.note ? `\n📝 ${post.note}` : '';

      if (Notification.isSupported()) {
        const notif = new Notification({
          title: `📅 Waktunya posting di ${post.platform}!`,
          body: `${typeLabel}${noteText}\n⏰ ${post.time}`,
          urgency: 'normal',
          timeoutType: 'default',
        });

        // Klik notif → buka / fokus ke app
        notif.on('click', () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          }
        });

        notif.show();
        console.log(`[Notif] ${post.platform} — ${typeLabel} jam ${post.time}`);
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
    },
    title: 'ArtAssist',
    autoHideMenuBar: true,
  });

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
ipcMain.on('schedule-updated', (event, scheduleJSON) => {
  const dataPath = path.join(app.getPath('userData'), 'schedule-cache.json');
  try {
    fs.writeFileSync(dataPath, scheduleJSON, 'utf-8');
    console.log('Schedule cache updated.');
  } catch (e) {
    console.warn('Gagal simpan schedule cache:', e.message);
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
// FETCH REDDIT (existing)
// =====================
ipcMain.handle('fetch-reddit', async (event, url) => {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'ArtAssist/1.0',
        Accept: 'application/json',
      },
      rejectUnauthorized: false,
    };
    https
      .get(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
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
      mainWindow.webContents.executeJavaScript(`
        if (confirm('Update ArtAssist sudah diunduh!\\nRestart sekarang untuk install?')) {
          require('electron').ipcRenderer.send('install-update');
        }
      `);
    }
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater] Error:', err.message);
  });
}

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});

// =====================
// APP LIFECYCLE
// =====================
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

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
