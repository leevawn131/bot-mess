const fs = require('fs');
const path = require('path');
const login = require('../includes/f');

const DAILY_TOP_STATE_PATH = path.join(__dirname, '..', 'cache', 'checktt_daily_top_state.json');
const MONTHLY_TOP_STATE_PATH = path.join(__dirname, '..', 'cache', 'checktt_monthly_top_state.json');
const STATS_PATH = path.join(__dirname, '..', 'message_stats.json');

const THREAD_INFO_TTL = 5 * 60 * 1000;
const _threadInfoCache = new Map();

async function _quietGetThreadInfo(api, key) {
  const _origErr = console.error;
  console.error = () => {};
  try {
    return await api.getThreadInfo(key);
  } finally {
    console.error = _origErr;
  }
}

async function getThreadInfoCached(api, threadID) {
  const key = String(threadID);
  const cached = _threadInfoCache.get(key);
  if (cached && Date.now() - cached.ts < THREAD_INFO_TTL) return cached.data;
  try {
    const info = await _quietGetThreadInfo(api, key);
    if (info) _threadInfoCache.set(key, { data: info, ts: Date.now() });
    return info;
  } catch (e) {
    if (cached) return cached.data;
    return null;
  }
}

const normalizeEntry = (raw) => {
  if (typeof raw === 'number') return { total: Number(raw) || 0, daily: {}, weekly: {}, monthly: {} };
  if (!raw || typeof raw !== 'object') return { total: 0, daily: {}, weekly: {}, monthly: {} };
  return {
    total: Number(raw.total) || 0,
    daily: raw.daily && typeof raw.daily === 'object' ? raw.daily : {},
    weekly: raw.weekly && typeof raw.weekly === 'object' ? raw.weekly : {},
    monthly: raw.monthly && typeof raw.monthly === 'object' ? raw.monthly : {},
  };
};

const formatDayLabel = (dayKey) => {
  const [year, month, day] = String(dayKey || '').split('-');
  if (!year || !month || !day) return String(dayKey || '');
  return `${day}/${month}/${year}`;
};

const formatMonthLabel = (monthKey) => {
  const [year, month] = String(monthKey || '').split('-');
  if (!year || !month) return String(monthKey || '');
  return `${month}/${year}`;
};

const getTimeKeys = (now = new Date()) => {
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const year = vnTime.getFullYear();
  const month = String(vnTime.getMonth() + 1).padStart(2, '0');
  const day = String(vnTime.getDate()).padStart(2, '0');
  const dayKey = `${year}-${month}-${day}`;
  const monthKey = `${year}-${month}`;

  const weekDate = new Date(year, vnTime.getMonth(), day);
  const weekDay = (weekDate.getDay() + 6) % 7;
  weekDate.setDate(weekDate.getDate() - weekDay + 3);
  const firstThursday = new Date(weekDate.getFullYear(), 0, 4);
  const firstWeekDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstWeekDay + 3);
  const weekNumber = 1 + Math.round((weekDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  const weekKey = `${weekDate.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;

  return { dayKey, weekKey, monthKey };
};

const getPreviousDayKey = (now = new Date()) => {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return getTimeKeys(d).dayKey;
};

const getPreviousMonthKey = (now = new Date()) => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return getTimeKeys(d).monthKey;
};

const readState = (filePath) => {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {}
  return {};
};

const writeState = (filePath, state) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (e) {}
};

const sendDailyTop10ToAllGroups = async (api, force = false) => {
  try {
    const stats = {};
    if (fs.existsSync(STATS_PATH)) Object.assign(stats, JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')));

    const yesterdayKey = getPreviousDayKey();
    const state = readState(DAILY_TOP_STATE_PATH);

    for (const threadID of Object.keys(stats)) {
      if (!force && state[threadID] === yesterdayKey) continue;

      const threadStats = stats[threadID];
      const ranked = Object.entries(threadStats)
        .filter(([uid]) => /^\d+$/.test(String(uid)))
        .map(([uid, raw]) => {
          const entry = normalizeEntry(raw);
          return { uid: String(uid), count: Number(entry.daily?.[yesterdayKey] || 0), total: Number(entry.total || 0) };
        })
        .filter((item) => item.count > 0)
        .sort((a, b) => {
          const dayDiff = b.count - a.count;
          if (dayDiff !== 0) return dayDiff;
          return b.total - a.total;
        });

      if (ranked.length === 0) continue;

      try {
        const threadInfo = await getThreadInfoCached(api, threadID);
        if (!threadInfo?.isGroup) continue;

        const userMap = new Map((threadInfo.userInfo || []).map((u) => [String(u.id), u.name]));
        const lines = [
          `📊 TOP 10 TƯƠNG TÁC NGÀY ${formatDayLabel(yesterdayKey)}`,
          '━'.repeat(13),
          ...ranked.slice(0, 10).map((item, idx) => {
            const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
            return `${idx + 1}. ${name} — ${item.count}`;
          }),
        ];

        await api.sendMessage(lines.join('\n'), threadID);
        state[threadID] = yesterdayKey;
        console.log(`✅ Đã gửi TOP 10 tương tác ngày cho nhóm ${threadID}`);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.error(`❌ Lỗi gửi TOP 10 cho nhóm ${threadID}:`, e && e.message ? e.message : e);
      }
    }

    writeState(DAILY_TOP_STATE_PATH, state);
  } catch (e) {
    console.error('❌ Lỗi gửi TOP 10 tương tác ngày cho tất cả nhóm:', e);
  }
};

const sendMonthlyTop10ToAllGroups = async (api, force = false) => {
  try {
    const stats = {};
    if (fs.existsSync(STATS_PATH)) Object.assign(stats, JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')));

    const previousMonthKey = getPreviousMonthKey();
    const state = readState(MONTHLY_TOP_STATE_PATH);

    for (const threadID of Object.keys(stats)) {
      if (!force && state[threadID] === previousMonthKey) continue;

      const threadStats = stats[threadID];
      const ranked = Object.entries(threadStats)
        .filter(([uid]) => /^\d+$/.test(String(uid)))
        .map(([uid, raw]) => {
          const entry = normalizeEntry(raw);
          return { uid: String(uid), count: Number(entry.monthly?.[previousMonthKey] || 0), total: Number(entry.total || 0) };
        })
        .filter((item) => item.count > 0)
        .sort((a, b) => {
          const monthDiff = b.count - a.count;
          if (monthDiff !== 0) return monthDiff;
          return b.total - a.total;
        });

      if (ranked.length === 0) continue;

      try {
        const threadInfo = await getThreadInfoCached(api, threadID);
        if (!threadInfo?.isGroup) continue;

        const userMap = new Map((threadInfo.userInfo || []).map((u) => [String(u.id), u.name]));
        const lines = [
          `📊 TOP 10 TƯƠNG TÁC THÁNG ${formatMonthLabel(previousMonthKey)}`,
          '━'.repeat(13),
          ...ranked.slice(0, 10).map((item, idx) => {
            const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
            return `${idx + 1}. ${name} — ${item.count}`;
          }),
        ];

        await api.sendMessage(lines.join('\n'), threadID);
        state[threadID] = previousMonthKey;
        console.log(`✅ Đã gửi TOP 10 tương tác tháng cho nhóm ${threadID}`);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.error(`❌ Lỗi gửi TOP 10 tháng cho nhóm ${threadID}:`, e && e.message ? e.message : e);
      }
    }

    writeState(MONTHLY_TOP_STATE_PATH, state);
  } catch (e) {
    console.error('❌ Lỗi gửi TOP 10 tương tác tháng cho tất cả nhóm:', e);
  }
};

const loadAppState = () => {
  const runtimePath = path.join(__dirname, '..', 'runtime', 'appstate.json');
  const legacyPath = path.join(__dirname, '..', 'appstate.json');
  try {
    const p = fs.existsSync(runtimePath) ? runtimePath : legacyPath;
    return { appState: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    return null;
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const mode = (args.find(a => !a.startsWith('-')) || 'daily').toLowerCase();
  const force = args.some(a => a === '--force' || a === '-f');

  const creds = loadAppState();
  if (!creds) {
    console.error('❌ Không tìm thấy appstate.json.');
    process.exit(1);
  }

  login(creds, async (err, api) => {
    if (err) {
      console.error('❌ Đăng nhập thất bại. Có thể do cookie/appstate đã hết hạn hoặc bị lỗi.');
      console.error('👉 Hãy cập nhật appstate.json hoặc chạy lệnh sau để làm mới:');
      console.error('   node refresh-appstate.js <email> <password>');
      console.error('Chi tiết lỗi đăng nhập:', err.message || err);
      process.exit(1);
    }

    // Save fresh appstate to file
    try {
      const appState = JSON.stringify(api.getAppState(), null, 2);
      const runtimePath = path.join(__dirname, '..', 'runtime', 'appstate.json');
      const legacyPath = path.join(__dirname, '..', 'appstate.json');
      fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
      fs.writeFileSync(runtimePath, appState);
      fs.writeFileSync(legacyPath, appState);
    } catch (e) {}

    try {
      if (mode === 'monthly') {
        console.log(`🕗 Gửi TOP 10 tương tác tháng (bằng tay)${force ? ' [FORCE]' : ''}...`);
        await sendMonthlyTop10ToAllGroups(api, force);
      } else {
        console.log(`🕗 Gửi TOP 10 tương tác ngày (bằng tay)${force ? ' [FORCE]' : ''}...`);
        await sendDailyTop10ToAllGroups(api, force);
      }
    } catch (e) {
      console.error('❌ Lỗi khi gửi TOP:', e);
    }

    try { await api.logout(); } catch {};
    process.exit(0);
  });
};

main();
