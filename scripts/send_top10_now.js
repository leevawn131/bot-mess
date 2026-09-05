const fs = require('fs');
const path = require('path');
const login = require('../includes/f');

const DAILY_TOP_STATE_PATH = path.join(__dirname, '..', 'cache', 'checktt_daily_top_state.json');
const MONTHLY_TOP_STATE_PATH = path.join(__dirname, '..', 'cache', 'checktt_monthly_top_state.json');
const STATS_PATH = path.join(__dirname, '..', 'message_stats.json');
const { getThreadInfoCached } = require('../modules/utils/threadInfo');
const { execute } = require('../modules/utils/database');

const getClusterGroupSet = async (clusterId) => {
  if (!clusterId) return null;
  try {
    const clusterGroupTracker = require('../src/managers/clusterGroupTracker');
    if (typeof clusterGroupTracker.syncAndBalanceClusterGroups === 'function') {
      await clusterGroupTracker.syncAndBalanceClusterGroups().catch(() => {});
    }
  } catch (e) {}

  try {
    const { execute } = require('../modules/utils/database');
    const rows = await execute(
      `SELECT thread_id FROM group_profile_bindings WHERE cluster_id = ?`,
      [clusterId]
    );
    if (rows && Array.isArray(rows)) {
      return new Set(rows.map((r) => String(r.thread_id)));
    }
  } catch (e) {
    console.error(`❌ Lỗi đọc danh sách nhóm thuộc Cụm ${clusterId}:`, e.message);
  }
  return new Set();
};

const normalizeEntry = (raw) => {
  if (typeof raw === 'number') {
    return {
      total: Number(raw) || 0,
      daily: {},
      weekly: {},
      monthly: {},
      streak: { current: 0, lastDate: null, lastTime: 0, longest: 0, brokenCount: 0 }
    };
  }
  if (!raw || typeof raw !== 'object') {
    return {
      total: 0,
      daily: {},
      weekly: {},
      monthly: {},
      streak: { current: 0, lastDate: null, lastTime: 0, longest: 0, brokenCount: 0 }
    };
  }
  return {
    total: Number(raw.total) || 0,
    daily: raw.daily && typeof raw.daily === 'object' ? raw.daily : {},
    weekly: raw.weekly && typeof raw.weekly === 'object' ? raw.weekly : {},
    monthly: raw.monthly && typeof raw.monthly === 'object' ? raw.monthly : {},
    streak: {
      current: Number(raw.streak?.current) || 0,
      lastDate: raw.streak?.lastDate || null,
      lastTime: Number(raw.streak?.lastTime) || 0,
      longest: Number(raw.streak?.longest) || 0,
      brokenCount: Number(raw.streak?.brokenCount) || 0
    }
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
  const year = vnTime.getUTCFullYear();
  const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vnTime.getUTCDate()).padStart(2, '0');
  const dayKey = `${year}-${month}-${day}`;
  const monthKey = `${year}-${month}`;

  const weekDate = new Date(Date.UTC(year, vnTime.getUTCMonth(), vnTime.getUTCDate()));
  const weekDay = (weekDate.getUTCDay() + 6) % 7;
  weekDate.setUTCDate(weekDate.getUTCDate() - weekDay + 3);

  const firstThursday = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 4));
  const firstWeekDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekDay + 3);

  const weekNumber = 1 + Math.round((weekDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  const weekKey = `${weekDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;

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

/**
 * Hàm phân giải tên người dùng 3 lớp (Tránh lỗi User XXXXXX)
 * Lớp 1: threadInfo.userInfo
 * Lớp 2: global.data.userName & SQLite bảng messenger_users
 * Lớp 3: Batch api.getUserInfo (có timeout tối đa 5s)
 */
async function getUserNames(api, uids, threadInfo) {
  const userMap = new Map();
  if (threadInfo?.userInfo && Array.isArray(threadInfo.userInfo)) {
    for (const u of threadInfo.userInfo) {
      if (u && u.id && u.name) userMap.set(String(u.id), u.name);
    }
  }

  const missingUids = uids.map(String).filter((id) => !userMap.has(id));
  if (missingUids.length === 0) return userMap;

  // 1. Tìm trong global.data.userName
  if (global.data?.userName instanceof Map) {
    for (const id of missingUids) {
      if (global.data.userName.has(id)) {
        userMap.set(id, global.data.userName.get(id));
      }
    }
  }

  const stillMissing = missingUids.filter((id) => !userMap.has(id));
  if (stillMissing.length === 0) return userMap;

  // 2. Tìm trong SQLite (messenger_users)
  try {
    const placeholders = stillMissing.map(() => '?').join(',');
    const rows = await execute(
      `SELECT psid, name FROM messenger_users WHERE psid IN (${placeholders}) AND name IS NOT NULL AND name != 'Người dùng' AND name != ''`,
      stillMissing
    );
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && row.psid && row.name) {
          userMap.set(String(row.psid), row.name);
        }
      }
    }
  } catch (e) {}

  const finalMissing = stillMissing.filter((id) => !userMap.has(id));
  if (finalMissing.length === 0) return userMap;

  // 3. Batch gọi api.getUserInfo từ Facebook (timeout tối đa 5 giây)
  if (typeof api?.getUserInfo === 'function') {
    try {
      const info = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 5000);
        api.getUserInfo(finalMissing, (err, data) => {
          clearTimeout(timer);
          if (err || !data) return resolve(null);
          resolve(data);
        });
      });
      if (info && typeof info === 'object') {
        if (Array.isArray(info)) {
          for (const item of info) {
            if (item && typeof item === 'object') {
              for (const [id, u] of Object.entries(item)) {
                if (u && u.name) userMap.set(String(id), u.name);
              }
            }
          }
        } else {
          for (const [id, u] of Object.entries(info)) {
            if (u && u.name) userMap.set(String(id), u.name);
          }
        }
      }
    } catch (e) {}
  }

  return userMap;
}

const sendDailyTop10ToAllGroups = async (api, force = false, clusterFilter = null) => {
  try {
    const stats = {};
    if (fs.existsSync(STATS_PATH)) Object.assign(stats, JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')));

    const yesterdayKey = getPreviousDayKey();
    const todayKey = getTimeKeys().dayKey;
    const state = readState(DAILY_TOP_STATE_PATH);

    let clusterSet = null;
    if (clusterFilter) {
      clusterSet = await getClusterGroupSet(clusterFilter);
      console.log(`🎯 Lọc theo Cụm ${clusterFilter}: Có ${clusterSet ? clusterSet.size : 0} nhóm thuộc Cụm ${clusterFilter}.`);
    }

    for (const threadID of Object.keys(stats)) {
      if (clusterSet && !clusterSet.has(String(threadID))) continue;
      if (!force && state[threadID] === yesterdayKey) continue;

      const threadStats = stats[threadID];
      const ranked = Object.entries(threadStats)
        .filter(([uid]) => /^\d+$/.test(String(uid)))
        .map(([uid, raw]) => {
          const entry = normalizeEntry(raw);
          let yesterdayStreak = 0;
          if (entry.streak) {
            if (entry.streak.lastDate === todayKey) {
              yesterdayStreak = entry.streak.current > 1 ? entry.streak.current - 1 : 0;
            } else if (entry.streak.lastDate === yesterdayKey) {
              yesterdayStreak = entry.streak.current;
            }
          }
          return {
            uid: String(uid),
            count: Number(entry.daily?.[yesterdayKey] || 0),
            total: Number(entry.total || 0),
            streakValue: yesterdayStreak
          };
        })
        .filter((item) => item.count > 0)
        .sort((a, b) => {
          const dayDiff = b.count - a.count;
          if (dayDiff !== 0) return dayDiff;
          return b.total - a.total;
        });

      if (ranked.length === 0) {
        state[threadID] = yesterdayKey;
        writeState(DAILY_TOP_STATE_PATH, state);
        continue;
      }

      try {
        const { checkRentalStatus } = require('../modules/utils/rental');
        const isRented = await checkRentalStatus(threadID);
        if (!isRented) {
          state[threadID] = yesterdayKey;
          writeState(DAILY_TOP_STATE_PATH, state);
          continue;
        }

        let threadInfo = await getThreadInfoCached(api, threadID);
        if (!threadInfo) {
          console.warn(`[sendDailyTop10] Không lấy được threadInfo cho nhóm ${threadID} (có thể bị rate-limit), dùng fallback.`);
          threadInfo = { isGroup: true, userInfo: [] };
        }
        if (threadInfo.isGroup === false) continue;

        const top10 = ranked.slice(0, 10);

        // Chuẩn bị danh sách đứt chuỗi
        let lostUsers = state[threadID + "_lostUsers"];
        const pendingLostUids = [];
        if (!Array.isArray(lostUsers)) {
          const participantIDs = Array.isArray(threadInfo?.participantIDs)
            ? threadInfo.participantIDs.map((id) => String(id))
            : [];
          const participantSet = new Set(participantIDs);

          for (const uid of Object.keys(threadStats)) {
            if (!/^\d+$/.test(uid)) continue;
            if (participantSet.size > 0 && !participantSet.has(uid)) continue;

            const entry = normalizeEntry(threadStats[uid]);
            if (entry.streak.current > 0) {
              const yesterdayMsgCount = Number(entry.daily?.[yesterdayKey] || 0);
              if (yesterdayMsgCount === 0) {
                pendingLostUids.push({
                  uid,
                  lostStreak: entry.streak.current,
                });

                entry.streak.brokenCount = (entry.streak.brokenCount || 0) + 1;
                entry.streak.current = 0;

                stats[threadID][uid] = entry;
              }
            }
          }
          fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
        }

        // Lấy tên cho TẤT CẢ UIDs cần hiển thị (top 10 + người mất chuỗi)
        const allNeededDailyUids = Array.from(
          new Set([
            ...top10.map((item) => item.uid),
            ...pendingLostUids.map((item) => item.uid),
            ...(Array.isArray(lostUsers) ? lostUsers.map((u) => u.uid) : []),
          ])
        );
        const userMap = await getUserNames(api, allNeededDailyUids, threadInfo);

        if (!Array.isArray(lostUsers)) {
          lostUsers = pendingLostUids.map((item) => ({
            uid: item.uid,
            name: userMap.get(item.uid) || `User ${item.uid.slice(-6)}`,
            lostStreak: item.lostStreak,
          }));
        }

        const lines = [
          `📊 TOP 10 TƯƠNG TÁC NGÀY ${formatDayLabel(yesterdayKey)}`,
          '━'.repeat(13),
          ...top10.map((item, idx) => {
            const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
            const currentStreak = item.streakValue || 0;
            return `${idx + 1}. ${name} - ${item.count} tin | ${currentStreak} ngày 🔥`;
          }),
        ];

        const totalMessages = ranked.reduce((acc, item) => acc + item.count, 0);
        lines.push('━'.repeat(13));
        lines.push(`💬 Tổng tin nhắn trong ngày: ${totalMessages}`);

        if (Array.isArray(lostUsers) && lostUsers.length > 0) {
          lines.push("");
          lines.push("❄️ THÀNH VIÊN ĐÃ MẤT CHUỖI");
          lines.push("━".repeat(13));
          lostUsers.forEach((user) => {
            const userName = user.name || userMap.get(user.uid) || `User ${String(user.uid || '').slice(-6)}`;
            lines.push(`- ${userName} (đứt chuỗi ${user.lostStreak} ngày)`);
          });
          delete state[threadID + "_lostUsers"];
        }

        await new Promise((resolve, reject) => {
          const bodyMsg = lines.join('\n');
          const sendFallback = () => {
            api.sendMessage(bodyMsg, threadID, (err, info) => {
              if (err) return reject(err);
              resolve(info);
            });
          };

          if (typeof api.sendMessageEffect === 'function') {
            try {
              const effects = ["LOVE", "GIFTWRAP", "CELEBRATION", "FIRE"];
              const randomEffect = effects[Math.floor(Math.random() * effects.length)];
              api.sendMessageEffect({ body: bodyMsg, effect: randomEffect }, threadID, (err, info) => {
                if (err) return sendFallback();
                resolve(info);
              });
            } catch (e) {
              sendFallback();
            }
          } else {
            sendFallback();
          }
        });

        state[threadID] = yesterdayKey;
        writeState(DAILY_TOP_STATE_PATH, state);
        console.log(`✅ Đã gửi TOP 10 tương tác ngày cho nhóm ${threadID}`);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        const errMsg = e && typeof e === 'object' && e.message ? e.message : String(e || '');
        if (errMsg.includes("1545012")) {
          console.error(`❌ Lỗi gửi TOP 10 cho nhóm ${threadID}: Không thể gửi tin nhắn (bot có thể đã bị rời/kick khỏi nhóm hoặc nhóm bị khóa).`);
        } else {
          console.error(`❌ Lỗi gửi TOP 10 cho nhóm ${threadID}:`, errMsg);
        }
      }
    }

    writeState(DAILY_TOP_STATE_PATH, state);
  } catch (e) {
    console.error('❌ Lỗi gửi TOP 10 tương tác ngày cho tất cả nhóm:', e);
  }
};

const sendMonthlyTop10ToAllGroups = async (api, force = false, clusterFilter = null) => {
  try {
    const stats = {};
    if (fs.existsSync(STATS_PATH)) Object.assign(stats, JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')));

    const previousMonthKey = getPreviousMonthKey();
    const state = readState(MONTHLY_TOP_STATE_PATH);

    let clusterSet = null;
    if (clusterFilter) {
      clusterSet = await getClusterGroupSet(clusterFilter);
      console.log(`🎯 Lọc theo Cụm ${clusterFilter}: Có ${clusterSet ? clusterSet.size : 0} nhóm thuộc Cụm ${clusterFilter}.`);
    }

    for (const threadID of Object.keys(stats)) {
      if (clusterSet && !clusterSet.has(String(threadID))) continue;
      if (!force && state[threadID] === previousMonthKey) continue;

      const threadStats = stats[threadID];
      const ranked = Object.entries(threadStats)
        .filter(([uid]) => /^\d+$/.test(String(uid)))
        .map(([uid, raw]) => {
          const entry = normalizeEntry(raw);
          return {
            uid: String(uid),
            count: Number(entry.monthly?.[previousMonthKey] || 0),
            total: Number(entry.total || 0),
            streak: entry.streak
          };
        })
        .filter((item) => item.count > 0)
        .sort((a, b) => {
          const monthDiff = b.count - a.count;
          if (monthDiff !== 0) return monthDiff;
          return b.total - a.total;
        });

      if (ranked.length === 0) {
        state[threadID] = previousMonthKey;
        writeState(MONTHLY_TOP_STATE_PATH, state);
        continue;
      }

      // Top 10 longest streaks
      const rankedStreaks = Object.entries(threadStats)
        .filter(([uid]) => /^\d+$/.test(String(uid)))
        .map(([uid, raw]) => {
          const entry = normalizeEntry(raw);
          return {
            uid: String(uid),
            longest: Number(entry.streak?.longest || 0)
          };
        })
        .filter((item) => item.longest > 0)
        .sort((a, b) => b.longest - a.longest);

      try {
        const { checkRentalStatus } = require('../modules/utils/rental');
        const isRented = await checkRentalStatus(threadID);
        if (!isRented) {
          state[threadID] = previousMonthKey;
          writeState(MONTHLY_TOP_STATE_PATH, state);
          continue;
        }

        let threadInfo = await getThreadInfoCached(api, threadID);
        if (!threadInfo) {
          console.warn(`[sendMonthlyTop10] Không lấy được threadInfo cho nhóm ${threadID} (có thể bị rate-limit), dùng fallback.`);
          threadInfo = { isGroup: true, userInfo: [] };
        }
        if (threadInfo.isGroup === false) continue;

        const top10 = ranked.slice(0, 10);
        const streakTop10 = rankedStreaks.slice(0, 10);
        const allNeededMonthlyUids = Array.from(
          new Set([
            ...top10.map((item) => item.uid),
            ...streakTop10.map((item) => item.uid),
          ])
        );
        const userMap = await getUserNames(api, allNeededMonthlyUids, threadInfo);

        const lines = [
          `📊 TOP 10 TƯƠNG TÁC THÁNG ${formatMonthLabel(previousMonthKey)}`,
          '━'.repeat(13),
          ...top10.map((item, idx) => {
            const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
            const longest = item.streak?.longest || 0;
            const broken = item.streak?.brokenCount || 0;
            const streakText = longest > 0 ? ` (Kỷ lục: ${longest} ngày${broken > 0 ? `, đứt chuỗi: ${broken} lần` : ""})` : "";
            return `${idx + 1}. ${name} — ${item.count}${streakText}`;
          }),
        ];

        const totalMessages = ranked.reduce((acc, item) => acc + item.count, 0);
        lines.push('━'.repeat(13));
        lines.push(`💬 Tổng tin nhắn trong tháng: ${totalMessages}`);

        if (rankedStreaks.length > 0) {
          lines.push("");
          lines.push("🔥 TOP 10 GIỮ CHUỖI TƯƠNG TÁC LÂU NHẤT THÁNG");
          lines.push("━".repeat(13));
          streakTop10.forEach((item, idx) => {
            const name = userMap.get(item.uid) || `User ${item.uid.slice(-6)}`;
            lines.push(`${idx + 1}. ${name} — ${item.longest} ngày`);
          });
        }

        await new Promise((resolve, reject) => {
          const bodyMsg = lines.join('\n');
          const sendFallback = () => {
            api.sendMessage(bodyMsg, threadID, (err, info) => {
              if (err) return reject(err);
              resolve(info);
            });
          };

          if (typeof api.sendMessageEffect === 'function') {
            try {
              const effects = ["LOVE", "GIFTWRAP", "CELEBRATION", "FIRE"];
              const randomEffect = effects[Math.floor(Math.random() * effects.length)];
              api.sendMessageEffect({ body: bodyMsg, effect: randomEffect }, threadID, (err, info) => {
                if (err) return sendFallback();
                resolve(info);
              });
            } catch (e) {
              sendFallback();
            }
          } else {
            sendFallback();
          }
        });

        // Reset brokenCount cho toàn bộ thành viên nhóm sau khi báo cáo tháng
        for (const uid of Object.keys(threadStats)) {
          if (/^\d+$/.test(uid)) {
            if (stats[threadID][uid] && stats[threadID][uid].streak) {
              stats[threadID][uid].streak.brokenCount = 0;
            }
          }
        }

        state[threadID] = previousMonthKey;
        writeState(MONTHLY_TOP_STATE_PATH, state);
        console.log(`✅ Đã gửi TOP 10 tương tác tháng cho nhóm ${threadID}`);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        const errMsg = e && typeof e === 'object' && e.message ? e.message : String(e || '');
        if (errMsg.includes("1545012")) {
          console.error(`❌ Lỗi gửi TOP 10 cho nhóm ${threadID}: Không thể gửi tin nhắn (bot có thể đã bị rời/kick khỏi nhóm hoặc nhóm bị khóa).`);
        } else {
          console.error(`❌ Lỗi gửi TOP 10 cho nhóm ${threadID}:`, errMsg);
        }
      }
    }

    fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
    writeState(MONTHLY_TOP_STATE_PATH, state);
  } catch (e) {
    console.error('❌ Lỗi gửi TOP 10 tương tác tháng cho tất cả nhóm:', e);
  }
};

const loadAppStateForCluster = (clusterId = null) => {
  if (clusterId) {
    try {
      const configPath = path.join(__dirname, '..', 'runtime', 'account_profiles.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const cluster = (config.clusters || []).find((c) => c.cluster_id === clusterId);
        if (cluster) {
          const profilesToTry = [
            cluster.active_profile,
            ...(cluster.profiles || []).filter((p) => p !== cluster.active_profile),
          ];

          for (const pName of profilesToTry) {
            if (!pName) continue;
            const appstateFile = path.join(__dirname, '..', 'runtime', 'appstates', `appstate_${pName}.json`);
            if (fs.existsSync(appstateFile)) {
              console.log(`🔑 Tự động nạp AppState cho Profile "${pName}" của Cụm ${clusterId}...`);
              return {
                profileName: pName,
                appState: JSON.parse(fs.readFileSync(appstateFile, 'utf8')),
              };
            }
          }
        }
      }
    } catch (e) {
      console.error(`❌ Lỗi khi tìm AppState cho Cụm ${clusterId}:`, e.message);
    }
  }

  // Fallback to default appstate.json
  const runtimePath = path.join(__dirname, '..', 'runtime', 'appstate.json');
  const legacyPath = path.join(__dirname, '..', 'appstate.json');
  try {
    const p = fs.existsSync(runtimePath) ? runtimePath : legacyPath;
    console.log(`🔑 Nạp AppState mặc định (${p})...`);
    return {
      profileName: 'Default',
      appState: JSON.parse(fs.readFileSync(p, 'utf8')),
    };
  } catch (e) {
    return null;
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  let mode = 'daily';
  let clusterFilter = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force' || a === '-f') {
      force = true;
    } else if (a === '--cluster' || a === '-c') {
      if (args[i + 1] && !isNaN(parseInt(args[i + 1]))) {
        clusterFilter = parseInt(args[i + 1]);
        i++;
      }
    } else if (a.startsWith('--cluster=') || a.startsWith('-c=')) {
      clusterFilter = parseInt(a.split('=')[1]);
    } else if (a.toLowerCase() === 'daily' || a.toLowerCase() === 'monthly') {
      mode = a.toLowerCase();
    } else if (!isNaN(parseInt(a))) {
      clusterFilter = parseInt(a);
    }
  }

  const creds = loadAppStateForCluster(clusterFilter);
  if (!creds || !creds.appState) {
    console.error(`❌ Không tìm thấy AppState phù hợp cho Cụm ${clusterFilter || 'mặc định'}.`);
    process.exit(1);
  }

  login({ appState: creds.appState }, async (err, api) => {
    if (err) {
      console.error('❌ Đăng nhập thất bại. Có thể do cookie/appstate đã hết hạn hoặc bị lỗi.');
      console.error('Chi tiết lỗi đăng nhập:', err.message || err);
      process.exit(1);
    }

    try {
      const clusterMsg = clusterFilter ? ` (Cụm ${clusterFilter})` : '';
      const forceMsg = force ? ' [FORCE]' : '';
      if (mode === 'monthly') {
        console.log(`... Gửi TOP 10 tương tác tháng (bằng tay)${clusterMsg}${forceMsg}...`);
        await sendMonthlyTop10ToAllGroups(api, force, clusterFilter);
      } else {
        console.log(`... Gửi TOP 10 tương tác ngày (bằng tay)${clusterMsg}${forceMsg}...`);
        await sendDailyTop10ToAllGroups(api, force, clusterFilter);
      }
    } catch (e) {
      console.error('❌ Lỗi khi gửi TOP:', e);
    }

    process.exit(0);
  });
};

main();
