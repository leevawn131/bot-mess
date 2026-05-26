const fs = require("fs");
const path = require("path");
const { checkCooldown } = require("../../utils/cooldown");
const { getBotConfig } = require("../../utils/envConfig");

const STATS_PATH = path.join(__dirname, "../../../message_stats.json");

function readStats() {
  try {
    if (!fs.existsSync(STATS_PATH)) return {};
    return JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeStats(stats) {
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

function toDateKeys(now = new Date()) {
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const year = vnTime.getFullYear();
  const month = String(vnTime.getMonth() + 1).padStart(2, "0");
  const day = String(vnTime.getDate()).padStart(2, "0");
  const dayKey = `${year}-${month}-${day}`;
  const monthKey = `${year}-${month}`;

  const weekDate = new Date(year, vnTime.getMonth(), day);
  const weekDay = (weekDate.getDay() + 6) % 7;
  weekDate.setDate(weekDate.getDate() - weekDay + 3);

  const firstThursday = new Date(weekDate.getFullYear(), 0, 4);
  const firstWeekDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstWeekDay + 3);

  const weekNumber =
    1 + Math.round((weekDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  const weekKey = `${weekDate.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;

  return { dayKey, weekKey, monthKey };
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-");
  if (!year || !month) return String(monthKey || "");
  return `${month}/${year}`;
}

function normalizeStatEntry(rawEntry) {
  if (typeof rawEntry === "number") {
    return {
      total: Number(rawEntry) || 0,
      daily: {},
      weekly: {},
      monthly: {},
    };
  }

  if (!rawEntry || typeof rawEntry !== "object") {
    return {
      total: 0,
      daily: {},
      weekly: {},
      monthly: {},
    };
  }

  const sanitizeMap = (obj) => {
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v) || 0;
      if (n > 0) out[k] = n;
    }
    return out;
  };

  return {
    total: Number(rawEntry.total) || 0,
    daily: sanitizeMap(rawEntry.daily),
    weekly: sanitizeMap(rawEntry.weekly),
    monthly: sanitizeMap(rawEntry.monthly),
  };
}

function chunkLines(lines, maxChars = 3500) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    if ((current + line + "\n").length > maxChars) {
      chunks.push(current.trimEnd());
      current = "";
    }
    current += `${line}\n`;
  }

  if (current.trim()) chunks.push(current.trimEnd());
  return chunks;
}

async function sendMessageSafe(api, body, threadID, replyToMessageID) {
  try {
    const result = await api.sendMessage(body, threadID, replyToMessageID);
    if (result && typeof result === "object") return { ok: true, info: result };
    return { ok: true, info: null };
  } catch {
    try {
      await new Promise((r) => setTimeout(r, 700));
      const resultRetry = await api.sendMessage(
        body,
        threadID,
        replyToMessageID,
      );
      if (resultRetry && typeof resultRetry === "object")
        return { ok: true, info: resultRetry };
      return { ok: true, info: null };
    } catch (e2) {
      return { ok: false, error: e2 };
    }
  }
}

function buildRankList({ threadInfo, threadStats, threshold }) {
  const memberInfo = threadInfo.userInfo || [];
  const memberMap = new Map(memberInfo.map((u) => [String(u.id), u]));
  const participantIDs = Array.isArray(threadInfo.participantIDs)
    ? threadInfo.participantIDs.map((id) => String(id))
    : [];
  const participantSet = new Set(participantIDs);
  const { dayKey, weekKey, monthKey } = toDateKeys();

  const allIDs = new Set([
    ...Object.keys(threadStats || {}),
    ...participantSet,
  ]);

  const list = Array.from(allIDs).map((uid) => {
    const user = memberMap.get(uid);
    const name = user?.name || `User ${uid.slice(-6)}`;
    const normalized = normalizeStatEntry(threadStats?.[uid]);
    const count = Number(normalized.total || 0);
    const dayCount = Number(normalized.daily?.[dayKey] || 0);
    const weekCount = Number(normalized.weekly?.[weekKey] || 0);
    const monthCount = Number(normalized.monthly?.[monthKey] || 0);
    const inGroup = participantSet.has(uid);

    return { uid, name, count, dayCount, weekCount, monthCount, inGroup };
  });

  const filtered =
    typeof threshold === "number"
      ? list.filter((item) => item.count <= threshold)
      : list;

  return filtered.sort((a, b) => b.count - a.count);
}

function isFacebookDeadName(name = "") {
  const raw = String(name || "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();

  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;
  return normalized === "nguoi dung facebook" || normalized === "facebook user";
}

function stripDiacritics(s = "") {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

function suppressLeaveEvents(threadID, durationMs = 15000) {
  global.leaveEventSuppressByThread = global.leaveEventSuppressByThread || {};
  global.leaveEventSuppressByThread[String(threadID)] = Date.now() + durationMs;
}

module.exports = {
  name: "checktt",
  description: "Kiểm tra tương tác, lọc/kick/reset dữ liệu tin nhắn",
  usage:
    "\n!checktt all → Xem top tương tác tất cả thành viên\n!checktt → Xem top tương tác của 1 người\n!checktt ngày → Top tương tác hôm nay\n!checktt tuần → Top tuần này\n!checktt tháng → Top tháng này\n!checktt locmem [X] → Lọc thành viên từ X tin nhắn trở xuống\n!checktt kickdead → Kick thành viên bị bay acc\n!checktt clear → Làm sạch dữ liệu tương tác\n!checktt reset → Reset dữ liệu nhóm (Admin)\n━━━━━━━━━━━━━━━━━━\n📊 Thống kê tự động theo ngày/tuần/tháng",

  execute: async ({ api, event, args }) => {
    const { threadID, messageID, senderID } = event;

    const cooldown = checkCooldown({
      command: "checktt",
      key: senderID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`,
        threadID,
        messageID,
      );
    }

    try {
      let threadInfo;
      try {
        threadInfo = await api.getThreadInfo(threadID);
      } catch (err) {
        console.error("Error getting thread info:", err);
        return api.sendMessage(
          "⚠️ Không thể lấy thông tin nhóm. Vui lòng thử lại sau.",
          threadID,
          messageID,
        );
      }

      if (!threadInfo || !threadInfo.isGroup) {
        return api.sendMessage(
          "⚠️ Lệnh này chỉ dùng trong nhóm.",
          threadID,
          messageID,
        );
      }

      const adminIDs = Array.isArray(threadInfo.adminIDs)
        ? threadInfo.adminIDs.map((a) => String(a.id))
        : [];
      const botID = String(api.getCurrentUserID());
      const isSenderAdmin = adminIDs.includes(String(senderID));

      // Get admin bot UIDs safely
      let adminBotUIDs = [];
      try {
        const config = getBotConfig();
        adminBotUIDs = config?.adminIDs || [];
      } catch (error) {
        console.error("Error getting admin bot UIDs:", error);
        adminBotUIDs = [];
      }

      const isSenderBotAdmin = Array.isArray(adminBotUIDs)
        ? adminBotUIDs.includes(String(senderID))
        : false;
      const isBotAdmin = adminIDs.includes(botID);
      const canUseChecktt = isSenderAdmin || isSenderBotAdmin;

      if (!canUseChecktt) {
        return api.sendMessage(
          "⚠️ Lệnh checktt chỉ dành cho QTV nhóm hoặc chủ bot.",
          threadID,
          messageID,
        );
      }

      const stats = readStats();
      if (!stats[threadID]) stats[threadID] = {};
      const threadStats = stats[threadID];
      const rankedBase = buildRankList({ threadInfo, threadStats });

      const sub = (args[0] || "").toLowerCase();
      const subNorm = stripDiacritics(sub);

      if (sub === "reset") {
        if (!canUseChecktt) {
          return api.sendMessage(
            "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được reset dữ liệu tương tác.",
            threadID,
            messageID,
          );
        }

        stats[threadID] = {};
        writeStats(stats);
        return api.sendMessage(
          "✅ Đã reset dữ liệu tin nhắn của nhóm này.",
          threadID,
          messageID,
        );
      }

      if (sub === "clear") {
        if (!canUseChecktt) {
          return api.sendMessage(
            "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được clear dữ liệu tương tác.",
            threadID,
            messageID,
          );
        }

        const participantSet = new Set(
          Array.isArray(threadInfo.participantIDs)
            ? threadInfo.participantIDs.map((id) => String(id))
            : [],
        );
        const allStatIDs = Object.keys(threadStats || {});
        const removedIDs = allStatIDs.filter(
          (uid) => !participantSet.has(String(uid)),
        );

        if (removedIDs.length === 0) {
          return api.sendMessage(
            "📭 Không có thành viên đã rời nhóm trong danh sách để xóa.",
            threadID,
            messageID,
          );
        }

        for (const uid of removedIDs) {
          delete stats[threadID][uid];
        }

        writeStats(stats);
        return api.sendMessage(
          `🧹 Đã clear ${removedIDs.length} thành viên đã rời nhóm khỏi dữ liệu tương tác.`,
          threadID,
          messageID,
        );
      }

      if (sub === "kickdead") {
        if (!canUseChecktt) {
          return api.sendMessage(
            "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được kickdead.",
            threadID,
            messageID,
          );
        }
        if (!isBotAdmin) {
          return api.sendMessage(
            "❌ Bot cần quyền QTV để kick thành viên.",
            threadID,
            messageID,
          );
        }

        const candidates = rankedBase.filter((item) => {
          const uid = String(item.uid);
          if (!item.inGroup) return false;
          if (uid === botID) return false;
          return isFacebookDeadName(item.name);
        });

        if (candidates.length === 0) {
          return api.sendMessage(
            "📭 Không có tài khoản 'Người dùng Facebook' nào trong danh sách tương tác.",
            threadID,
            messageID,
          );
        }

        let success = 0;
        let failed = 0;
        const failedDetails = [];

        if (
          !(
            api.removeUserFromGroup ||
            api.removeParticipant ||
            api.removeUser ||
            api.removeUserFromThread ||
            api.removeParticipantFromThread ||
            api.gcmember
          )
        ) {
          return api.sendMessage(
            "❌ Bot hiện tại không hỗ trợ chức năng kick do thư viện thiếu API xóa participant. Vui lòng cập nhật thư viện/phiên bản.",
            threadID,
            messageID,
          );
        }

        const removeUser = async (uid, tid) => {
          if (api.removeUserFromGroup) return api.removeUserFromGroup(uid, tid);
          if (api.removeParticipant) return api.removeParticipant(uid, tid);
          if (api.gcmember) return api.gcmember("remove", uid, tid);
          if (api.removeUser) return api.removeUser(uid, tid);
          if (api.removeUserFromThread)
            return api.removeUserFromThread(uid, tid);
          if (api.removeParticipantFromThread)
            return api.removeParticipantFromThread(uid, tid);
          throw new Error("Library missing remove function");
        };

        for (const user of candidates) {
          const uid = String(user.uid);
          try {
            await removeUser(uid, threadID);
            success++;
            await new Promise((r) => setTimeout(r, 300));
          } catch (e) {
            failed++;
            failedDetails.push(
              `- ${user.name || uid} (${uid}): ${e?.message || "kick lỗi"}`,
            );
          }
        }

        const failed_txt = failed > 0 ? ` | ❌${failed}` : "";
        return api.sendMessage(
          `✅ kickdead: ${success}/${candidates.length}${failed_txt}`,
          threadID,
          messageID,
        );
      }

      if (sub === "locmem") {
        const a1 = String(args[1] || "").trim();
        const a2 = String(args[2] || "").trim();

        let period = null;
        let threshold = NaN;

        const n1 = Number(a1);
        const n2 = Number(a2);

        if (!isNaN(n1) && a1 !== "") {
          threshold = n1;
          period = null;
        } else if (!isNaN(n2) && a2 !== "") {
          threshold = n2;
          period = stripDiacritics(a1 || "");
        }

        if (isNaN(threshold) || threshold < 0) {
          return api.sendMessage(
            "⚠️ Dùng đúng cú pháp: checktt locmem <số> hoặc checktt locmem [ngày|tuần|tháng] <số>",
            threadID,
            messageID,
          );
        }

        if (!isBotAdmin) {
          return api.sendMessage(
            "❌ Bot cần quyền QTV để xóa thành viên bằng locmem.",
            threadID,
            messageID,
          );
        }

        const periodMap = {
          ngay: "dayCount",
          tuan: "weekCount",
          thang: "monthCount",
        };

        const metricKey = period && periodMap[period] ? periodMap[period] : null;

        const candidates = rankedBase.filter((item) => {
          const uid = String(item.uid);
          if (!item.inGroup) return false;
          if (adminIDs.includes(uid)) return false;
          if (uid === botID) return false;
          const val = metricKey ? Number(item[metricKey] || 0) : Number(item.count || 0);
          return val <= threshold;
        });

        if (candidates.length === 0) {
          const when = metricKey ? (period === 'ngay' ? 'hôm nay' : period === 'tuan' ? 'tuần này' : 'tháng này') : 'tổng';
          return api.sendMessage(
            `📭 Không có thành viên nào có ${when} <= ${threshold}.`,
            threadID,
            messageID,
          );
        }

        suppressLeaveEvents(
          threadID,
          Math.max(15000, candidates.length * 1200),
        );

        let success = 0;
        let failed = 0;
        const failedDetails = [];

        if (
          !(
            api.removeUserFromGroup ||
            api.removeParticipant ||
            api.removeUser ||
            api.removeUserFromThread ||
            api.removeParticipantFromThread ||
            api.gcmember
          )
        ) {
          return api.sendMessage(
            "❌ Bot hiện tại không hỗ trợ chức năng kick do thư viện thiếu API xóa participant. Vui lòng cập nhật thư viện/phiên bản.",
            threadID,
            messageID,
          );
        }

        const removeUser = async (uid, tid) => {
          if (api.removeUserFromGroup) return api.removeUserFromGroup(uid, tid);
          if (api.removeParticipant) return api.removeParticipant(uid, tid);
          if (api.gcmember) return api.gcmember("remove", uid, tid);
          if (api.removeUser) return api.removeUser(uid, tid);
          if (api.removeUserFromThread)
            return api.removeUserFromThread(uid, tid);
          if (api.removeParticipantFromThread)
            return api.removeParticipantFromThread(uid, tid);
          throw new Error("Library missing remove function");
        };

        for (const user of candidates) {
          const uid = String(user.uid);
          try {
            await removeUser(uid, threadID);

            if (stats[threadID] && stats[threadID][uid] !== undefined) {
              delete stats[threadID][uid];
            }

            success++;
            await new Promise((r) => setTimeout(r, 300));
          } catch (e) {
            failed++;
            failedDetails.push(
              `- ${user.name || uid} (${uid}): ${e?.message || "xóa lỗi"}`,
            );
          }
        }

        writeStats(stats);

        const failed_txt = failed > 0 ? ` | ❌${failed}` : "";
        const label = metricKey ? (period === 'ngay' ? 'hôm nay' : period === 'tuan' ? 'tuần' : 'tháng') : 'tổng';
        return api.sendMessage(
          `✅ locmem (${label} <= ${threshold}): ${success}/${candidates.length}${failed_txt}`,
          threadID,
          messageID,
        );
      }

      const metricBySub = {
        ngay: {
          metricKey: "dayCount",
          label: "NGÀY",
          metricText: "tin hôm nay",
        },
        tuan: {
          metricKey: "weekCount",
          label: "TUẦN",
          metricText: "tin tuần này",
        },
        thang: {
          metricKey: "monthCount",
          label: "THÁNG",
          metricText: "tin tháng này",
          getTitle: () => {
            const { monthKey } = toDateKeys();
            return `📊 TOP THÁNG ${formatMonthLabel(monthKey)}`;
          },
        },
      };

      if (metricBySub[subNorm]) {
        const config = metricBySub[subNorm];
        const ranked = [...rankedBase].sort((a, b) => {
          const metricDiff =
            Number(b[config.metricKey] || 0) - Number(a[config.metricKey] || 0);
          if (metricDiff !== 0) return metricDiff;
          return Number(b.count || 0) - Number(a.count || 0);
        });

        if (ranked.length === 0) {
          return api.sendMessage(
            "📭 Chưa có dữ liệu thành viên để hiển thị.",
            threadID,
            messageID,
          );
        }

        const title = config.getTitle
          ? config.getTitle()
          : `📊 TOP ${config.label}`;
        const lines = [
          `${title}`,
          "━━━━━━━━━━━━━━━━━━",
          ...ranked.map((item, idx) => {
            const status = item.inGroup ? "" : " (❌)";
            return `${idx + 1}. ${item.name}${status} — ${Number(item[config.metricKey] || 0)}`;
          }),
          "",
          "(Reply STT để kick/xóa data)",
        ];

        const chunks = chunkLines(lines);

        global.checkttReplyContexts = global.checkttReplyContexts || {};

        const sentMessageIDs = [];
        for (let i = 0; i < chunks.length; i++) {
          const sent = await sendMessageSafe(
            api,
            chunks[i],
            threadID,
            i === chunks.length - 1 ? messageID : undefined,
          );

          if (!sent.ok) {
            return api.sendMessage(
              "❌ Facebook đang lỗi tạm thời, thử lại sau vài giây.",
              threadID,
              messageID,
            );
          }

          if (sent.info?.messageID) {
            sentMessageIDs.push(sent.info.messageID);
          }
        }

        if (sentMessageIDs.length > 0) {
          const replyContext = {
            author: String(senderID),
            threadID: String(threadID),
            ranked,
            metricKey: config.metricKey,
            createdAt: Date.now(),
          };

          for (const mid of sentMessageIDs) {
            global.checkttReplyContexts[mid] = replyContext;
          }
        }

        return;
      }

      if (!sub) {
        const targetID = String(event.messageReply?.senderID || senderID);
        const target = rankedBase.find((item) => String(item.uid) === targetID);

        const sortedByMetric = (metricKey) => {
          return [...rankedBase].sort((a, b) => {
            const metricDiff =
              Number(b[metricKey] || 0) - Number(a[metricKey] || 0);
            if (metricDiff !== 0) return metricDiff;
            return Number(b.count || 0) - Number(a.count || 0);
          });
        };

        const getRank = (sortedList, uid) => {
          const idx = sortedList.findIndex(
            (item) => String(item.uid) === String(uid),
          );
          return idx >= 0 ? idx + 1 : sortedList.length;
        };

        const safeTarget = target || {
          uid: targetID,
          name: `User ${targetID.slice(-6)}`,
          count: 0,
          dayCount: 0,
          weekCount: 0,
          monthCount: 0,
          inGroup: false,
        };

        const dayRank = getRank(sortedByMetric("dayCount"), safeTarget.uid);
        const weekRank = getRank(sortedByMetric("weekCount"), safeTarget.uid);
        const monthRank = getRank(sortedByMetric("monthCount"), safeTarget.uid);
        const totalRank = getRank(sortedByMetric("count"), safeTarget.uid);

        let msg = `📊 ${safeTarget.name}: \n`;
        msg += `Ngày: #${dayRank}/${rankedBase.length} (${safeTarget.dayCount})\nTuần: #${weekRank}/${rankedBase.length} (${safeTarget.weekCount})\nTháng: #${monthRank}/${rankedBase.length} (${safeTarget.monthCount})\nTổng: #${totalRank}/${rankedBase.length} (${safeTarget.count})`;

        return api.sendMessage(msg, threadID, messageID);
      }

      if (sub !== "all") {
        return api.sendMessage(
          "⚠️ Cú pháp không hợp lệ. Dùng: checktt | checktt all | checktt ngày | checktt tuần | checktt tháng",
          threadID,
          messageID,
        );
      }

      const ranked = rankedBase;

      if (ranked.length === 0) {
        const emptyMsg = "📭 Chưa có dữ liệu thành viên để hiển thị.";
        return api.sendMessage(emptyMsg, threadID, messageID);
      }

      const title = "📊 TOP TỔNG TIN NHẮN";

      const lines = [
        `${title}`,
        "━━━━━━━━━━━━━━━━━━",
        ...ranked.map((item, idx) => {
          const status = item.inGroup ? "" : " (❌)";
          return `${idx + 1}. ${item.name}${status} — ${item.count}`;
        }),
        "",
        "(Reply STT để kick/xóa data)",
      ];

      const chunks = chunkLines(lines);

      global.checkttReplyContexts = global.checkttReplyContexts || {};

      const sentMessageIDs = [];
      for (let i = 0; i < chunks.length; i++) {
        const sent = await sendMessageSafe(
          api,
          chunks[i],
          threadID,
          i === chunks.length - 1 ? messageID : undefined,
        );

        if (!sent.ok) {
          return api.sendMessage(
            "❌ Facebook đang lỗi tạm thời, thử lại sau vài giây.",
            threadID,
            messageID,
          );
        }

        if (sent.info?.messageID) {
          sentMessageIDs.push(sent.info.messageID);
        }
      }

      if (sentMessageIDs.length > 0) {
        const replyContext = {
          author: String(senderID),
          threadID: String(threadID),
          ranked,
          createdAt: Date.now(),
        };

        for (const mid of sentMessageIDs) {
          global.checkttReplyContexts[mid] = replyContext;
        }
      }
    } catch (e) {
      console.error("Lỗi checktt:", e);
      return api.sendMessage("❌ Lỗi khi xử lý checktt.", threadID, messageID);
    }
  },

  handleReply: async ({ api, event }) => {
    try {
      if (event.type !== "message_reply") return;

      const { threadID, senderID, messageID, messageReply, body } = event;
      const replyContexts = global.checkttReplyContexts || {};
      const context = replyContexts[messageReply?.messageID];
      if (!context) return;

      if (String(context.threadID) !== String(threadID)) return;
      if (String(context.author) !== String(senderID)) {
        return api.sendMessage(
          "⚠️ Chỉ người gọi checktt mới được reply STT.",
          threadID,
          messageID,
        );
      }

      const input = String(body || "").trim();

      // allow replying with: locmem <threshold>
      try {
        const bodyNorm = stripDiacritics(input).trim();
        const locm = bodyNorm.match(/^locmem(?:\s+(\d+))?$/i);
        if (locm && context.metricKey) {
          const threshold = Number(locm[1]);

          if (isNaN(threshold) || threshold < 0) {
            return api.sendMessage(
              "⚠️ Dùng đúng cú pháp: reply: locmem <số_tin_tổng> (ví dụ: locmem 5)",
              threadID,
              messageID,
            );
          }

          const threadInfo = await api.getThreadInfo(threadID);
          const adminIDs = Array.isArray(threadInfo.adminIDs)
            ? threadInfo.adminIDs.map((a) => String(a.id))
            : [];
          const botID = String(api.getCurrentUserID());
          const isSenderAdmin = adminIDs.includes(String(senderID));

          // Get admin bot UIDs safely
          let adminBotUIDs = [];
          try {
            const config = getBotConfig();
            adminBotUIDs = config?.adminIDs || [];
          } catch (error) {
            console.error("Error getting admin bot UIDs:", error);
            adminBotUIDs = [];
          }

          const isSenderBotAdmin = Array.isArray(adminBotUIDs)
            ? adminBotUIDs.includes(String(senderID))
            : false;

          if (!isSenderAdmin && !isSenderBotAdmin) {
            return api.sendMessage(
              "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được dùng locmem.",
              threadID,
              messageID,
            );
          }

          if (!adminIDs.includes(botID)) {
            return api.sendMessage(
              "❌ Bot cần quyền QTV để xóa thành viên bằng locmem.",
              threadID,
              messageID,
            );
          }

          const stats = readStats();
          if (!stats[threadID]) stats[threadID] = {};

          const metricKey = context.metricKey;

          const candidates = context.ranked.filter((item) => {
            const uid = String(item.uid);
            if (!item.inGroup) return false;
            if (adminIDs.includes(uid)) return false;
            if (uid === botID) return false;
            return Number(item[metricKey] || 0) <= threshold;
          });

          if (candidates.length === 0) {
            return api.sendMessage(
              `📭 Không có thành viên nào có ${metricKey} <= ${threshold}.`,
              threadID,
              messageID,
            );
          }

          suppressLeaveEvents(
            threadID,
            Math.max(15000, candidates.length * 1200),
          );

          let success = 0;
          let failed = 0;
          const failedDetails = [];

          if (
            !(
              api.removeUserFromGroup ||
              api.removeParticipant ||
              api.removeUser ||
              api.removeUserFromThread ||
              api.removeParticipantFromThread ||
              api.gcmember
            )
          ) {
            return api.sendMessage(
              "❌ Bot hiện tại không hỗ trợ chức năng kick do thư viện thiếu API xóa participant. Vui lòng cập nhật thư viện/phiên bản.",
              threadID,
              messageID,
            );
          }

          const removeUser = async (uid, tid) => {
            if (api.removeUserFromGroup) return api.removeUserFromGroup(uid, tid);
            if (api.removeParticipant) return api.removeParticipant(uid, tid);
            if (api.gcmember) return api.gcmember("remove", uid, tid);
            if (api.removeUser) return api.removeUser(uid, tid);
            if (api.removeUserFromThread) return api.removeUserFromThread(uid, tid);
            if (api.removeParticipantFromThread)
              return api.removeParticipantFromThread(uid, tid);
            throw new Error("Library missing remove function");
          };

          for (const user of candidates) {
            const uid = String(user.uid);
            try {
              await removeUser(uid, threadID);

              if (stats[threadID] && stats[threadID][uid] !== undefined) {
                delete stats[threadID][uid];
              }

              success++;
              await new Promise((r) => setTimeout(r, 300));
            } catch (e) {
              failed++;
              failedDetails.push(
                `- ${user.name || uid} (${uid}): ${e?.message || "xóa lỗi"}`,
              );
            }
          }

          writeStats(stats);

          const failed_txt = failed > 0 ? ` | ❌${failed}` : "";
          return api.sendMessage(
            `✅ locmem (${metricKey}, <= ${threshold}): ${success}/${candidates.length}${failed_txt}`,
            threadID,
            messageID,
          );
        }
      } catch (err) {
        console.error("Error handling locmem reply:", err);
      }

      const sttMatches = input.match(/\d+/g) || [];
      const sttList = [
        ...new Set(sttMatches.map((n) => Number(n)).filter(Number.isInteger)),
      ];

      if (sttList.length === 0) {
        return api.sendMessage(
          "⚠️ STT không hợp lệ. Ví dụ: 1 2 3 hoặc 1,2,3",
          threadID,
          messageID,
        );
      }

      if (sttList.length > 5) {
        return api.sendMessage(
          "⚠️ Mỗi lần chỉ xử lý tối đa 5 STT.",
          threadID,
          messageID,
        );
      }

      if (sttList.some((stt) => stt < 1 || stt > context.ranked.length)) {
        return api.sendMessage(
          "⚠️ Có STT vượt ngoài danh sách.",
          threadID,
          messageID,
        );
      }

      const threadInfo = await api.getThreadInfo(threadID);
      const adminIDs = Array.isArray(threadInfo.adminIDs)
        ? threadInfo.adminIDs.map((a) => String(a.id))
        : [];
      const botID = String(api.getCurrentUserID());
      const isSenderAdmin = adminIDs.includes(String(senderID));

      // Get admin bot UIDs safely
      let adminBotUIDs = [];
      try {
        const config = getBotConfig();
        adminBotUIDs = config?.adminIDs || [];
      } catch (error) {
        console.error("Error getting admin bot UIDs:", error);
        adminBotUIDs = [];
      }

      const isSenderBotAdmin = Array.isArray(adminBotUIDs)
        ? adminBotUIDs.includes(String(senderID))
        : false;

      if (!isSenderAdmin && !isSenderBotAdmin) {
        return api.sendMessage(
          "⚠️ Chỉ QTV nhóm hoặc chủ bot mới được xử lý kick/xóa bằng STT.",
          threadID,
          messageID,
        );
      }

      const participantSet = new Set(
        Array.isArray(threadInfo.participantIDs)
          ? threadInfo.participantIDs.map((id) => String(id))
          : [],
      );

      const selectedTargets = sttList
        .map((stt) => context.ranked[stt - 1])
        .filter(Boolean);

      if (selectedTargets.length > 1) {
        suppressLeaveEvents(threadID, 15000);
      }

      const hasKickCandidate = selectedTargets.some((target) => {
        const uid = String(target.uid);
        return (
          participantSet.has(uid) && uid !== botID && !adminIDs.includes(uid)
        );
      });

      if (hasKickCandidate && !adminIDs.includes(botID)) {
        return api.sendMessage(
          "❌ Bot cần quyền QTV để kick thành viên.",
          threadID,
          messageID,
        );
      }

      const stats = readStats();
      if (!stats[threadID]) stats[threadID] = {};

      let kicked = 0;
      let dataDeleted = 0;
      let skipped = 0;
      let failed = 0;
      const failedDetails = [];

      if (
        !(
          api.removeUserFromGroup ||
          api.removeParticipant ||
          api.removeUser ||
          api.removeUserFromThread ||
          api.removeParticipantFromThread ||
          api.gcmember
        )
      ) {
        return api.sendMessage(
          "❌ Bot hiện tại không hỗ trợ chức năng kick do thư viện thiếu API xóa participant. Vui lòng cập nhật thư viện/phiên bản.",
          threadID,
          messageID,
        );
      }

      const removeUser = async (uid, tid) => {
        if (api.removeUserFromGroup) return api.removeUserFromGroup(uid, tid);
        if (api.removeParticipant) return api.removeParticipant(uid, tid);
        if (api.gcmember) return api.gcmember("remove", uid, tid);
        if (api.removeUser) return api.removeUser(uid, tid);
        if (api.removeUserFromThread) return api.removeUserFromThread(uid, tid);
        if (api.removeParticipantFromThread)
          return api.removeParticipantFromThread(uid, tid);
        throw new Error("Library missing remove function");
      };

      for (const target of selectedTargets) {
        const uid = String(target.uid);

        if (participantSet.has(uid)) {
          if (uid === botID || adminIDs.includes(uid)) {
            skipped++;
            continue;
          }

          try {
            await removeUser(uid, threadID);
            kicked++;
            await new Promise((r) => setTimeout(r, 300));
          } catch (e) {
            failed++;
            failedDetails.push(
              `- ${target.name || uid}: ${e?.message || "kick lỗi"}`,
            );
          }
          continue;
        }

        if (stats[threadID][uid] !== undefined) {
          delete stats[threadID][uid];
          dataDeleted++;
        } else {
          skipped++;
        }
      }

      writeStats(stats);

      let msg = `✅ Xử lý xong ${selectedTargets.length} mục.`;
      msg += `\n• Kick thành công: ${kicked}`;
      msg += `\n• Xóa data: ${dataDeleted}`;
      msg += `\n• Bỏ qua: ${skipped}`;
      msg += `\n• Thất bại: ${failed}`;

      if (failedDetails.length > 0) {
        msg += `\n\n📌 Chi tiết lỗi:\n${failedDetails.slice(0, 10).join("\n")}`;
      }

      return api.sendMessage(msg, threadID, messageID);
    } catch (e) {
      console.error("Lỗi checktt handleReply:", e);
    }
  },
};
