const fs = require('fs-extra');
const path = require('path');
const { toAdminIdList } = require('../../utils/checkPermission');
const { getThreadInfoCached } = require('../../utils/threadInfo');

// Canonical warning keys are `warn.theme`, `warn.spam`, etc.  Some older data
// used `warn.antitheme`; retain it only as a fallback while migrating on write.
function isWarningEnabled(settings, key) {
  const warnings = settings?.warn;
  if (!warnings) return true;
  if (Object.prototype.hasOwnProperty.call(warnings, key)) return warnings[key] !== false;
  const legacyKey = `anti${key}`;
  if (Object.prototype.hasOwnProperty.call(warnings, legacyKey)) return warnings[legacyKey] !== false;
  return true;
}

module.exports = {
  name: 'anti',
  version: '5.1.1',
  hasPermssion: 1,
  credits: 'Niio-team (Vtuan) & Fixes',
  description: 'Quản lý và bảo vệ các cài đặt của nhóm',
  usage: '\n!anti ➔ Mở menu cấu hình Bật/Tắt và Cảnh báo các chế độ bảo vệ\n!anti [tên_anti] ➔ Bật/Tắt nhanh một tính năng bảo vệ\n!anti spam config ➔ Mở menu cấu hình giới hạn số lượng spam tin nhắn\n━━━━━━━━━━━━━\n📌 Danh sách các tính năng bảo vệ:\n• namebox: Chống đổi tên nhóm\n• avtbox: Chống đổi ảnh nhóm\n• out: Chống tự ý thoát nhóm\n• join: Cấm thành viên mới tham gia\n• theme: Chống đổi theme/icon\n• spam: Chống spam tin nhắn/sticker/emoji/ảnh\n• resend: Chống gỡ tin nhắn\n• spamb: Chống spam lệnh Bot\n• tagall: Chống tag all\n• bietdanh: Chống đổi biệt danh',

  execute: async ({ api, event, args, Threads, Users }) => {
    const a_ = './modules/data/anti';
    const fileAnti = path.join(a_, 'antiFile.json');
    if (!fs.existsSync(a_)) fs.mkdirSync(a_, { recursive: true });
    if (!fs.existsSync(fileAnti)) fs.writeFileSync(fileAnti, JSON.stringify({}));

    let D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}');
    const { threadID, senderID, messageID } = event;
    if (!D_[threadID]) D_[threadID] = {};

    const settingsList = ['namebox', 'avtbox', 'out', 'join', 'theme', 'spam', 'resend', 'spamb', 'tagall', 'bietdanh'];
    const settingsMap = {
      namebox: 'Chống đổi tên nhóm', avtbox: 'Chống đổi ảnh nhóm',
      out: 'Chống thành viên thoát chùa', join: 'Cấm thành viên mới vào nhóm',
      theme: 'Chống đổi giao diện (theme/icon)', spam: 'Chống thành viên spam tin nhắn',
      resend: 'Chống gỡ tin nhắn (unsent)', spamb: 'Chống thành viên spam bot',
      tagall: 'Chống tag all (mọi người/everyone)',
      bietdanh: 'Chống đổi biệt danh'
    };

    const x_ = (args[0] || '').toLowerCase();
    const y_ = (args[1] || '').toLowerCase();
    if (x_ === 'spam' && y_ === 'config') {
      return sendSpamConfigMenu(api, threadID, senderID);
    }
    const keyName = x_ === 'antitheme' ? 'theme' : x_ === 'antitagall' ? 'tagall' : x_;
    const warnSupportedList = ['namebox', 'avtbox', 'join', 'theme', 'spam', 'spamb', 'bietdanh'];

    if (x_ && (settingsList.includes(x_) || x_ === 'antitheme' || x_ === 'antitagall')) {
      const res = await processToggle(x_, threadID, Threads, api, fileAnti);
      return api.sendMessage(`${settingsMap[keyName] || x_}: ${res}`, threadID, String(messageID));
    }

    // build menu
    let msg = '🛡️ [ CONFIG ANTI GROUP ] 🛡️\n\n';
    const { isAntithemeEnabled } = require('../../utils/antithemeSettings');
    const { isAntitagallEnabled } = require('../../utils/antitagallSettings');
    const timeLimitSec = Number(D_[threadID].spam_limit_time ?? 7.5);

    settingsList.forEach((key, idx) => {
      let isTurnedOn = false;
      if (key === 'theme' || key === 'antitheme') {
        isTurnedOn = isAntithemeEnabled(threadID);
      } else if (key === 'tagall' || key === 'antitagall') {
        isTurnedOn = isAntitagallEnabled(threadID);
      } else {
        isTurnedOn = Boolean(D_[threadID][key]);
      }
      const statusIcon = isTurnedOn ? '🟢 BẬT' : '🔴 TẮT';

      let warnPart = '';
      if (warnSupportedList.includes(key)) {
        const warnOn = isWarningEnabled(D_[threadID], key);
        warnPart = ` | ⚠️ CB: ${warnOn ? '🟢' : '🔴'}`;
      }

      let extraInfo = '';
      if (key === 'spam') {
        extraInfo = ` (trong ${timeLimitSec}s)`;
      }

      msg += `${idx + 1}. ${settingsMap[key]}${extraInfo} ➔ ${statusIcon}${warnPart}\n`;
    });
    msg += '\n💬 Reply tin nhắn này kèm các số thứ tự (ví dụ: 1 2 5) để thay đổi cấu hình.';
    msg += '\n👉 Reply "warn" hoặc "cb" đứng trước số (ví dụ: "warn 1" hoặc "cb 1 2") để bật/tắt cảnh báo (CB).';
    msg += '\n⚙️ Gõ "6 config" hoặc "anti spam config" để điều chỉnh giới hạn và thời gian spam.';

    try {
      const info = await api.sendMessage(msg, threadID);
      if (!global.client) global.client = {};
      if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
      global.client.handleReply.push({
        name: module.exports.name,
        author: senderID,
        messageID: info.messageID,
        threadID: threadID
      });
      return info;
    } catch (err) {
      console.error(err);
      return null;
    }
  },

  handleReply: async ({ api, event, Threads }) => {
    try {
      const { messageReply, senderID } = event;
      if (!messageReply || !messageReply.messageID) return;
      const list = global.client && Array.isArray(global.client.handleReply) ? global.client.handleReply : [];
      const hr = list.find(h => String(h.messageID) === String(messageReply.messageID) && h.name === module.exports.name);
      if (!hr) return;
      if (String(hr.author) !== String(senderID)) return;

      const threadID = hr.threadID || event.threadID;
      const body = String(event.body || '').trim();

      // Xử lý reply menu phụ cấu hình spam
      if (hr.type === 'spam_config') {
        return handleSpamConfigReply(api, event, hr);
      }

      // Xử lý khi gõ "6 config" từ menu chính
      const lowerBody = body.toLowerCase();
      if (lowerBody === '6 config' || lowerBody === '6+config' || lowerBody === '6 + config') {
        try { await api.unsendMessage(messageReply.messageID); } catch (e) { }
        return sendSpamConfigMenu(api, threadID, senderID);
      }

      const replyTokens = lowerBody.split(/[\s,]+/).filter(Boolean);
      const choices = replyTokens.filter(token => /^\d+$/.test(token)).map(Number);
      if (choices.length === 0) return api.sendMessage('❌ Lựa chọn không hợp lệ.', threadID, String(messageReply.messageID));

      const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
      let D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}');
      if (!D_[threadID]) D_[threadID] = {};

      // Cảnh báo chỉ dùng cú pháp có từ khóa đứng đầu, ví dụ: "cb 1 2".
      const isWarnAction = ['warn', 'cb', 'canhbao'].includes(replyTokens[0]);
      const settingsMap = {
        namebox: 'Chống đổi tên nhóm', avtbox: 'Chống đổi ảnh nhóm',
        out: 'Chống thành viên thoát chùa', join: 'Cấm thành viên mới vào nhóm',
        theme: 'Chống đổi giao diện (theme/icon)', spam: 'Chống thành viên spam tin nhắn',
        resend: 'Chống gỡ tin nhắn (unsent)', spamb: 'Chống thành viên spam bot',
        tagall: 'Chống tag all (mọi người/everyone)', bietdanh: 'Chống đổi biệt danh'
      };

      let resultMsg = isWarnAction ? '⚠️ [ KẾT QUẢ CẬP NHẬT CẢNH BÁO ]\n\n' : '⚙️ [ KẾT QUẢ CẬP NHẬT ANTI ]\n\n';
      const st_ = ['namebox', 'avtbox', 'out', 'join', 'theme', 'spam', 'resend', 'spamb', 'tagall', 'bietdanh'];
      const warnSupportedList = ['namebox', 'avtbox', 'join', 'theme', 'spam', 'spamb', 'bietdanh'];

      let warningChanged = false;
      for (const choice of choices) {
        if (choice >= 1 && choice <= st_.length) {
          const key = st_[choice - 1];
          if (isWarnAction) {
            if (!warnSupportedList.includes(key)) {
              resultMsg += `• ${settingsMap[key] || key}: Không hỗ trợ tính năng cảnh báo.\n`;
              continue;
            }
            if (!D_[threadID].warn) D_[threadID].warn = {};
            const current = isWarningEnabled(D_[threadID], key);
            D_[threadID].warn[key] = !current;
            delete D_[threadID].warn[`anti${key}`];
            warningChanged = true;
            resultMsg += `• Cảnh báo ${settingsMap[key] || key}: ${!current ? '🟢 ĐÃ BẬT' : '🔴 ĐÃ TẮT'}\n`;
          } else {
            const res = await processToggle(key, threadID, Threads, api, fileAnti);
            resultMsg += `• ${settingsMap[key] || key}: ${res}\n`;
          }
        }
      }

      if (warningChanged) fs.writeFileSync(fileAnti, JSON.stringify(D_, null, 2));

      // unsend menu
      try { await api.unsendMessage(messageReply.messageID); } catch (e) { }
      return api.sendMessage(resultMsg, threadID);
    } catch (e) { console.error('anti handleReply error', e); }
  },

  handleEvent: async ({ api, event, Threads, Users }) => {
    try {
      const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
      if (!fs.existsSync(fileAnti)) return;
      const D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}');
      const threadID = event.threadID;
      if (!threadID || !D_[threadID]) return;

      if (D_[threadID].spam) {
        await antiSpam(api, event, Threads, Users);
      }
      if (D_[threadID].resend) {
        await reSend({ event, api, client: Threads, Users });
      }
      if (D_[threadID].spamb) {
        await antiSpamBot(event, Threads, api);
      }
    } catch (e) { console.error('anti handleEvent error', e); }
  },

  handleReaction: async ({ api, event, Threads, handleReaction }) => {
    try {
      const threadID = event.threadID;
      const userID = event.userID || event.senderID;
      if (!threadID || !userID || !handleReaction) return;

      let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
      const adminIDs = toAdminIdList(threadDataFetch?.threadInfo || threadDataFetch || {});
      const adminBot = global.config?.ADMINBOT || global.config?.adminIDs || [];
      if (adminIDs.includes(String(userID)) || adminBot.includes(String(userID))) {
        try {
          await api.removeUserFromGroup(handleReaction.author, threadID);
          api.sendMessage(`Thành viên ${handleReaction.author} đã bị khai trừ khỏi nhóm do hành vi spam bot.`, threadID);
        } catch (err) { console.error('Lỗi khai trừ thành viên spam:', err); }
        try { await api.unsendMessage(handleReaction.messageID); } catch (err) { }
      }
    } catch (e) { console.error('anti handleReaction error', e); }
  }
};

// helpers
async function processToggle(x_, threadID, Threads, api, fileAnti = path.join('./modules/data/anti', 'antiFile.json')) {
  let D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}');
  if (!D_[threadID]) D_[threadID] = {};
  if (['join', 'out', 'spam', 'resend', 'spamb', 'bietdanh'].includes(x_)) {
    if (['join', 'spam', 'bietdanh'].includes(x_)) {
      const check = await checkAdmin(Threads, api, threadID);
      if (check !== true) return '❌ Thất bại (Bot cần quyền QTV)';
    }
    if (D_[threadID][x_]) {
      delete D_[threadID][x_];
      fs.writeFileSync(fileAnti, JSON.stringify(D_, null, 2));
      return '🔴 ĐÃ TẮT';
    } else {
      D_[threadID][x_] = true;
      fs.writeFileSync(fileAnti, JSON.stringify(D_, null, 2));
      if (x_ === 'bietdanh') {
        try {
          const { saveAllNicknames } = require('../../utils/nicknameStorage');
          let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
          const t_ = threadDataFetch?.threadInfo || threadDataFetch || {};
          if (t_.nicknames) {
            await saveAllNicknames(threadID, t_.nicknames);
          }
        } catch (e) {
          console.error('[ANTI BIETDANH] Lỗi khi lưu danh sách biệt danh ban đầu:', e);
        }
      }
      return '🟢 ĐÃ BẬT';
    }
  }
  if (x_ === 'namebox') {
    let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
    const t_ = threadDataFetch.threadInfo || threadDataFetch;
    let model = t_.threadName || null;
    if (!model) return `❌ Thất bại (Không lấy được thông tin tên nhóm)`;
    if (D_[threadID].namebox) { delete D_[threadID].namebox; fs.writeFileSync(fileAnti, JSON.stringify(D_, null, 2)); return '🔴 ĐÃ TẮT'; }
    D_[threadID].namebox = model; fs.writeFileSync(fileAnti, JSON.stringify(D_, null, 2)); return '🟢 ĐÃ BẬT';
  }
  if (x_ === 'avtbox') {
    let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
    const t_ = threadDataFetch.threadInfo || threadDataFetch;
    const url = t_.imageSrc || t_.threadImageIcon || null;
    if (!url) return `❌ Thất bại (Không lấy được ảnh nhóm hiện tại)`;

    if (D_[threadID].avtbox) {
      delete D_[threadID].avtbox;
      fs.writeFileSync(fileAnti, JSON.stringify(D_, null, 2));
      const localPath = path.resolve(__dirname, `../../cache/avtbox_${threadID}.jpg`);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      return '🔴 ĐÃ TẮT';
    } else {
      const axios = require('axios');
      try {
        const cacheDir = path.resolve(__dirname, '../../cache');
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        const localPath = path.join(cacheDir, `avtbox_${threadID}.jpg`);
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        fs.writeFileSync(localPath, Buffer.from(response.data));
        D_[threadID].avtbox = true;
        fs.writeFileSync(fileAnti, JSON.stringify(D_, null, 2));
        return '🟢 ĐÃ BẬT';
      } catch (err) {
        console.error(err);
        return '❌ Thất bại (Không tải được ảnh nhóm hiện tại)';
      }
    }
  }
  if (x_ === 'theme' || x_ === 'antitheme') {
    const { setAntithemeEnabled, isAntithemeEnabled } = require('../../utils/antithemeSettings');
    const check = await checkAdmin(Threads, api, threadID);
    if (check !== true) return '❌ Thất bại (Bot cần quyền QTV)';
    const currentlyEnabled = isAntithemeEnabled(threadID);
    if (currentlyEnabled) {
      setAntithemeEnabled(threadID, false);
      return '🔴 ĐÃ TẮT';
    } else {
      let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
      const t_ = threadDataFetch.threadInfo || threadDataFetch;
      const lockInfo = {
        lockedThemeID: t_.threadTheme?.id || t_.themeID || "",
        lockedThemeName: t_.threadTheme?.name || t_.themeName || "",
        lockedEmoji: t_.emoji || t_.threadQuickReactionEmoji || ""
      };
      setAntithemeEnabled(threadID, true, "", lockInfo);
      return '🟢 ĐÃ BẬT';
    }
  }
  if (x_ === 'tagall' || x_ === 'antitagall') {
    const { setAntitagallEnabled, isAntitagallEnabled } = require('../../utils/antitagallSettings');
    const check = await checkAdmin(Threads, api, threadID);
    if (check !== true) return '❌ Thất bại (Bot cần quyền QTV)';
    const currentlyEnabled = isAntitagallEnabled(threadID);
    if (currentlyEnabled) {
      setAntitagallEnabled(threadID, false);
      return '🔴 ĐÃ TẮT';
    } else {
      setAntitagallEnabled(threadID, true);
      return '🟢 ĐÃ BẬT';
    }
  }

  return '❓ Không xác định';
}

async function checkAdmin(Threads, api, threadID) {
  try {
    const threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
    const adminIDs = toAdminIdList(threadDataFetch.threadInfo || threadDataFetch);
    return adminIDs.includes(String(api.getCurrentUserID())) ? true : '⚠️ Bot cần quyền quản trị viên nhóm';
  } catch (e) { return '⚠️ Không thể kiểm tra quyền quản trị viên của Bot'; }
}

// anti-spam, resend, antiSpamBot (simplified)
let usersSpam = {};
const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
function isOnlyEmoji(str) {
  if (!str) return false;
  // Loại bỏ khoảng trắng, các ký tự điều khiển zero-width, các bộ chọn biến thể (variation selectors) và ký tự điều khiển điều hướng
  const clean = str.replace(/[\s\ufe0f\u200d\u200b\u200c\u200e\u200f\ufe00-\ufe0f\u202a-\u202e]+/g, "");
  if (clean.length === 0) return false;
  const match = clean.match(emojiRegex);
  return match && match.join("") === clean;
}

function getMessageType(event) {
  if (event.attachments && event.attachments.length > 0) {
    const first = event.attachments[0];
    if (first.type === "sticker") return "sticker";

    // Phân loại sticker dạng avatar được gửi dưới dạng ảnh/GIF
    const isAvatar = (first.caption && /avatar/i.test(first.caption)) ||
      (first.description && /avatar/i.test(first.description)) ||
      (first.filename && /avatar/i.test(first.filename));
    if (isAvatar) return "sticker";

    if (["photo", "video", "animated_image"].includes(first.type)) return "image";
  }
  const body = String(event.body || "").trim();
  if (isOnlyEmoji(body)) return "icon";
  return "text";
}

async function antiSpam(api, event, Threads, Users) {
  try {
    const { threadID, senderID } = event;
    if (!threadID || !senderID) return;
    if (event.type !== "message" && event.type !== "message_reply") return;

    let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
    const adminIDs = toAdminIdList(threadDataFetch?.threadInfo || threadDataFetch || {});
    const type = getMessageType(event);
    const { getAdminBotUIDs } = require("../../utils/checkPermission");
    const adminBot = getAdminBotUIDs();
    const isAdminBypass = adminBot.includes(String(senderID)) || adminIDs.includes(String(senderID)) || String(senderID) === String(api.getCurrentUserID());
    if (isAdminBypass) {
      if (type === "sticker" || type === "image" || type === "icon") {
        console.log(`[SPAM BYPASS] Phát hiện ${type} từ QTV/Admin/Bot (UID: ${senderID}), tự động bỏ qua không cảnh báo.`);
      }
      return;
    }

    const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
    let D_ = {};
    if (fs.existsSync(fileAnti)) {
      try { D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}'); } catch (e) { }
    }
    if (!D_[threadID]) D_[threadID] = {};

    const limits = {
      text: Number(D_[threadID].spam_limit_text ?? 5),
      icon: Number(D_[threadID].spam_limit_icon ?? 5),
      sticker: Number(D_[threadID].spam_limit_sticker ?? 3),
      image: Number(D_[threadID].spam_limit_image ?? 3)
    };

    if (!usersSpam[senderID]) {
      usersSpam[senderID] = {
        lastType: "",
        text: { count: 0, start: Date.now(), last: "" },
        icon: { count: 0, start: Date.now(), last: "" },
        sticker: { count: 0, start: Date.now(), last: "" },
        image: { count: 0, start: Date.now(), last: "" }
      };
    }

    const timeLimitSec = Number(D_[threadID].spam_limit_time ?? 7.5);
    const timeLimitMs = timeLimitSec * 1000;

    const limit = limits[type];
    const currentTime = Date.now();

    // Reset các bộ đếm loại cũ nếu đổi loại tin nhắn (ví dụ từ gửi sticker chuyển sang gửi text)
    if (usersSpam[senderID].lastType && usersSpam[senderID].lastType !== type) {
      const oldType = usersSpam[senderID].lastType;
      usersSpam[senderID][oldType].count = 0;
      usersSpam[senderID][oldType].last = "";
    }
    usersSpam[senderID].lastType = type;

    const userSpamType = usersSpam[senderID][type];

    if (currentTime - userSpamType.start > timeLimitMs) {
      userSpamType.count = 0;
      userSpamType.start = currentTime;
    }

    const currentContent = type === "sticker" ? (event.attachments[0].stickerID || event.attachments[0].url) :
      type === "image" ? event.attachments[0].url : event.body;

    // Đối với Sticker, Icon, Image: Gửi liên tiếp các tin nhắn cùng loại (bất kể trùng ID hay khác ID/Nội dung) đều được tính là spam liên tiếp
    // Đối với Tin nhắn thường (text): Phải trùng khớp nội dung mới tính là spam
    const isSameSpam = (type === "text") ? (currentContent && currentContent === userSpamType.last) : true;

    if (isSameSpam) {
      userSpamType.count++;
      if (userSpamType.count >= limit && currentTime - userSpamType.start <= timeLimitMs) {
        const typeNames = { text: "tin nhắn thường", icon: "icon/emoji", sticker: "sticker", image: "ảnh/media" };
        const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
        let D_ = {};
        if (fs.existsSync(fileAnti)) {
          try { D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}'); } catch (e) { }
        }
        if (!D_[threadID] || !D_[threadID].warn || D_[threadID].warn.spam !== false) {
          const { addWarning } = require('../../utils/warningStorage');
          await addWarning(api, threadID, senderID, `Spam ${typeNames[type]} (${limit} tin/lần trong ${timeLimitSec}s)`);
        }
        userSpamType.count = 0;
        userSpamType.start = currentTime;
        userSpamType.last = "";
      }
    } else {
      userSpamType.count = 1;
      userSpamType.last = currentContent;
    }
  } catch (e) { console.error('antiSpam error', e); }
}

async function reSend({ event: e, api: a, client: t, Users: s }) {
  try {
    if (!e || !e.threadID) return;
    if (e.senderID == (global.botID || a.getCurrentUserID())) return;
    global.logMessage = global.logMessage || new Map();
    const i = global.data?.threadData?.get(e.threadID) || {};
    if ((void 0 === i.resend || i.resend != 0) && e.senderID != a.getCurrentUserID()) {
      if (e.type !== 'message_unsend') {
        global.logMessage.set(e.messageID, { msgBody: e.body, attachment: e.attachments });
      }
      if (e.type === 'message_unsend') {
        const m = global.logMessage.get(e.messageID);
        if (!m) return;
        let name = 'Người dùng';
        if (s && typeof s.getNameUser === 'function') {
          try { name = await s.getNameUser(e.senderID); } catch (err) { }
        }
        if (!m.attachment || m.attachment.length === 0) {
          return a.sendMessage(`${name} vừa gỡ tin nhắn: ${m.msgBody || 'Không có nội dung văn bản'}`, e.threadID);
        } else {
          const request = require('request'); const axios = require('axios'); const { writeFileSync, createReadStream } = require('fs-extra');
          let tcount = 0; let smsg = { body: `${name} vừa gỡ ${m.attachment.length} tệp đính kèm.${m.msgBody ? `\n\nNội dung: ${m.msgBody}` : ''}`, attachment: [] };
          for (const f of m.attachment) {
            tcount++;
            const pathname = (await request.get(f.url)).uri.pathname;
            const ext = pathname.substring(pathname.lastIndexOf('.') + 1);
            const p = __dirname + `/cache/${tcount}.${ext}`;
            const y = (await axios.get(f.url, { responseType: 'arraybuffer' })).data;
            writeFileSync(p, Buffer.from(y, 'utf-8')); smsg.attachment.push(createReadStream(p));
          }
          a.sendMessage(smsg, e.threadID);
        }
      }
    }
  } catch (err) { console.error('reSend error', err); }
}

const _s = {};
async function antiSpamBot(event, Threads, api) {
  try {
    const { threadID, senderID, body } = event;
    if (!body || !threadID || !senderID) return;
    let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
    const adminIDs = toAdminIdList(threadDataFetch?.threadInfo || threadDataFetch || {});
    const adminBot = global.config?.ADMINBOT || global.config?.adminIDs || [];
    if (adminBot.includes(String(senderID)) || adminIDs.includes(String(senderID)) || String(senderID) === String(api.getCurrentUserID())) return;
    const prefix = global.data?.threadData?.get(threadID)?.PREFIX || global.config?.prefix || global.config?.PREFIX || '!';
    if (!body.startsWith(prefix)) return;

    if (!global.spamBotCooldown) global.spamBotCooldown = new Map();

    const now = Date.now();
    if (!_s[senderID]) _s[senderID] = { count: 0, startTime: now };
    if (now - _s[senderID].startTime > 30000) {
      _s[senderID].count = 0;
      _s[senderID].startTime = now;
    }
    _s[senderID].count++;
    if (_s[senderID].count > 5) {
      _s[senderID].count = 0;
      _s[senderID].startTime = now;
      global.spamBotCooldown.set(String(senderID), now + 300000);
      const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
      let D_ = {};
      if (fs.existsSync(fileAnti)) {
        try { D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}'); } catch (e) { }
      }
      if (!D_[threadID] || !D_[threadID].warn || D_[threadID].warn.spamb !== false) {
        const { addWarning } = require('../../utils/warningStorage');
        await addWarning(api, threadID, senderID, "Spam lệnh bot liên tục");
      }
    }
  } catch (e) { console.error('antiSpamBot error', e); }
}

async function sendSpamConfigMenu(api, threadID, senderID) {
  const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
  let D_ = {};
  if (fs.existsSync(fileAnti)) {
    try { D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}'); } catch (e) { }
  }
  if (!D_[threadID]) D_[threadID] = {};

  const textLimit = D_[threadID].spam_limit_text ?? 5;
  const iconLimit = D_[threadID].spam_limit_icon ?? 5;
  const stickerLimit = D_[threadID].spam_limit_sticker ?? 3;
  const imageLimit = D_[threadID].spam_limit_image ?? 3;
  const timeLimit = D_[threadID].spam_limit_time ?? 7.5;

  let msg = '⚙️ [ CẤU HÌNH GIỚI HẠN SPAM ] ⚙️\n\n' +
    `1. Tin nhắn thường ➔ Tối đa ${textLimit} tin trong ${timeLimit}s\n` +
    `2. Icon/Emoji ➔ Tối đa ${iconLimit} emoji trong ${timeLimit}s\n` +
    `3. Sticker ➔ Tối đa ${stickerLimit} sticker trong ${timeLimit}s\n` +
    `4. Ảnh/Video/Media ➔ Tối đa ${imageLimit} ảnh trong ${timeLimit}s\n` +
    `5. Thời gian tính spam ➔ ${timeLimit}s\n\n` +
    `💬 Reply tin nhắn này kèm cặp số để cấu hình.\n` +
    `Cú pháp: <Số thứ tự> <Số lượng/Thời gian>\n` +
    `Ví dụ: "1 5" để chỉnh tin nhắn thường là 5.\n` +
    `Ví dụ: "5 10" để chỉnh thời gian tính spam thành 10s.\n` +
    `Ví dụ: "2 3 5 10" để chỉnh riêng icon tối đa 3 trong 10s` +
    `Để cấu hình nhiều mục cùng lúc: "1 5 2 5 3 3 4 3 5 10".`;

  try {
    const info = await api.sendMessage(msg, threadID);
    if (!global.client) global.client = {};
    if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
    global.client.handleReply.push({
      name: 'anti',
      type: 'spam_config',
      author: senderID,
      messageID: info.messageID,
      threadID: threadID
    });
    return info;
  } catch (err) {
    console.error(err);
  }
}

async function handleSpamConfigReply(api, event, hr) {
  const { threadID, messageReply, senderID } = event;
  const body = String(event.body || '').trim();

  const parts = body.split(/[\s,]+/).map(s => parseFloat(s)).filter(n => !isNaN(n));
  if (parts.length < 2 || parts.length % 2 !== 0) {
    return api.sendMessage('❌ Cú pháp reply không hợp lệ. Vui lòng nhập theo cặp: <Số thứ tự> <Số lượng/Thời gian> (Ví dụ: 1 5 5 10).', threadID, String(messageReply.messageID));
  }

  const fileAnti = path.join('./modules/data/anti', 'antiFile.json');
  let D_ = {};
  if (fs.existsSync(fileAnti)) {
    try { D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}'); } catch (e) { }
  }
  if (!D_[threadID]) D_[threadID] = {};

  const configKeys = {
    1: 'spam_limit_text',
    2: 'spam_limit_icon',
    3: 'spam_limit_sticker',
    4: 'spam_limit_image',
    5: 'spam_limit_time'
  };
  const configNames = {
    1: 'Tin nhắn thường',
    2: 'Icon/Emoji',
    3: 'Sticker',
    4: 'Ảnh/Media',
    5: 'Thời gian tính spam'
  };

  let resultMsg = '⚙️ [ CẬP NHẬT CẤU HÌNH SPAM ] ⚙️\n\n';
  let hasChanges = false;

  for (let i = 0; i < parts.length; i += 2) {
    const idx = parts[i];
    const value = parts[i + 1];

    if (configKeys[idx] && value > 0) {
      const key = configKeys[idx];
      D_[threadID][key] = value;
      const unit = idx === 5 ? 'giây' : 'tin/mục';
      resultMsg += `• ${configNames[idx]}: Mức mới ${value} ${unit}\n`;
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return api.sendMessage('❌ Không có thay đổi nào được áp dụng. Vui lòng kiểm tra lại số thứ tự (1-5) và số lượng/thời gian (> 0).', threadID, String(messageReply.messageID));
  }

  fs.writeFileSync(fileAnti, JSON.stringify(D_, null, 2));

  try { await api.unsendMessage(messageReply.messageID); } catch (e) { }
  return api.sendMessage(resultMsg, threadID);
}
