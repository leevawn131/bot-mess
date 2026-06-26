const fs = require('fs-extra');
const path = require('path');
const { toAdminIdList } = require('../../utils/checkPermission');
const { getThreadInfoCached } = require('../../utils/threadInfo');

module.exports = {
  name: 'anti',
  version: '5.1.0',
  hasPermssion: 1,
  credits: 'Niio-team (Vtuan) & Fixes',
  description: 'Quản lý và bảo vệ các cài đặt của nhóm',
  usage: '[tên anti] hoặc reply số thứ tự',

  execute: async ({ api, event, args, Threads, Users }) => {
    const a_ = './modules/data/anti';
    const fileAnti = path.join(a_, 'antiFile.json');
    if (!fs.existsSync(a_)) fs.mkdirSync(a_, { recursive: true });
    if (!fs.existsSync(fileAnti)) fs.writeFileSync(fileAnti, JSON.stringify({}));

    let D_ = JSON.parse(fs.readFileSync(fileAnti, 'utf-8') || '{}');
    const { threadID, senderID, messageID } = event;
    if (!D_[threadID]) D_[threadID] = {};

    const settingsList = ['namebox','avtbox','out','join','antitheme','spam','resend','bban','spamb','antitagall'];
    const settingsMap = {
      namebox: 'Chống đổi tên nhóm', avtbox: 'Chống đổi ảnh nhóm',
      out: 'Chống thành viên thoát chùa', join: 'Cấm thành viên mới vào nhóm',
      antitheme: 'Chống đổi giao diện (theme/icon)', spam: 'Chống tin nhắn spam thành viên',
      resend: 'Chống gỡ tin nhắn (resend)', bban: 'Cấm thành viên sử dụng bot', spamb: 'Chống thành viên spam bot',
      antitagall: 'Chống tag all (mọi người/everyone)'
    };

    const x_ = (args[0] || '').toLowerCase();
    if (x_ && settingsList.includes(x_)) {
      const res = await processToggle(x_, threadID, Threads, api, fileAnti);
      return api.sendMessage(`${settingsMap[x_] || x_}: ${res}`, threadID, String(messageID));
    }

    // build menu
    let msg = '🛡️ [ CONFIG ANTI GROUP ] 🛡️\n\n';
    const { isAntithemeEnabled } = require('../../utils/antithemeSettings');
    const { isAntitagallEnabled } = require('../../utils/antitagallSettings');
    settingsList.forEach((key, idx) => {
      let isTurnedOn = false;
      if (key === 'antitheme') {
        isTurnedOn = isAntithemeEnabled(threadID);
      } else if (key === 'antitagall') {
        isTurnedOn = isAntitagallEnabled(threadID);
      } else {
        isTurnedOn = Boolean(D_[threadID][key]);
      }
      const statusIcon = isTurnedOn ? '🟢 BẬT' : '🔴 TẮT';
      msg += `${idx+1}. ${settingsMap[key]} ➔ ${statusIcon}\n`;
    });
    msg += '\n💬 Reply tin nhắn này kèm các số thứ tự (ví dụ: 1 2 5) để thay đổi cấu hình.';

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
      const choices = body.split(/[\s,]+/).map(s => parseInt(s)).filter(n => !isNaN(n));
      if (choices.length === 0) return api.sendMessage('❌ Lựa chọn không hợp lệ.', threadID, String(messageReply.messageID));

      let resultMsg = '⚙️ [ KẾT QUẢ CẬP NHẬT ANTI ]\n\n';
      for (const choice of choices) {
        const st_ = ['namebox','avtbox','out','join','antitheme','spam','resend','bban','spamb','antitagall'];
        if (choice >=1 && choice <= st_.length) {
          const key = st_[choice-1];
          const res = await processToggle(key, threadID, Threads, api, path.join('./modules/data/anti','antiFile.json'));
          resultMsg += `• ${key}: ${res}\n`;
        }
      }

      // unsend menu
      try { await api.unsendMessage(messageReply.messageID); } catch (e) {}
      return api.sendMessage(resultMsg, threadID);
    } catch (e) { console.error('anti handleReply error', e); }
  },

  handleEvent: async ({ api, event, Threads, Users }) => {
    try {
      const fileAnti = path.join('./modules/data/anti','antiFile.json');
      if (!fs.existsSync(fileAnti)) return;
      const D_ = JSON.parse(fs.readFileSync(fileAnti,'utf-8') || '{}');
      const threadID = event.threadID;
      if (!D_[threadID]) return;
        if (D_[threadID].spam && D_[threadID].resend) {
          await antiSpam(api, event, Threads, Users);
          await reSend({ event, api, client: Threads, Users });
        } else if (D_[threadID].spam) {
          await antiSpam(api, event, Threads, Users);
        } else if (D_[threadID].resend) {
          await reSend({ event, api, client: Threads, Users });
        } else if (D_[threadID].spamb) {
          await antiSpamBot(event, Threads, api);
        }
    } catch (e) { console.error('anti handleEvent error', e); }
  },

  handleReaction: async ({ api, event, Threads, handleReaction }) => {
    try {
      const threadID = event.threadID;
      const userID = event.userID;
      const threadDataFetch = await Threads.getData(threadID);
      const adminIDs = toAdminIdList(threadDataFetch.threadInfo || threadDataFetch);
      const adminBot = global.config.ADMINBOT || [];
      if (adminIDs.includes(userID) || adminBot.includes(userID)) {
        try { await api.removeUserFromGroup(handleReaction.author, threadID); api.sendMessage(`Thành viên ${handleReaction.author} đã bị khai trừ khỏi nhóm do hành vi spam bot.`, threadID); } catch (err) { console.error(err); }
        api.unsendMessage(handleReaction.messageID);
      }
    } catch (e) { console.error('handleReaction error', e); }
  }
};

// helpers
async function processToggle(x_, threadID, Threads, api, fileAnti = path.join('./modules/data/anti','antiFile.json')) {
  let D_ = JSON.parse(fs.readFileSync(fileAnti,'utf-8') || '{}');
  if (!D_[threadID]) D_[threadID] = {};
  if (['join','out','spam','resend','bban','spamb'].includes(x_)) {
    if (['join','spam'].includes(x_)) {
      const check = await checkAdmin(Threads, api, threadID);
      if (check !== true) return '❌ Thất bại (Bot cần quyền QTV)';
    }
    if (D_[threadID][x_]) { delete D_[threadID][x_]; fs.writeFileSync(fileAnti, JSON.stringify(D_,null,2)); return '🔴 ĐÃ TẮT'; }
    else { D_[threadID][x_] = true; fs.writeFileSync(fileAnti, JSON.stringify(D_,null,2)); return '🟢 ĐÃ BẬT'; }
  }
  if (x_ === 'namebox') {
    let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
    const t_ = threadDataFetch.threadInfo || threadDataFetch;
    let model = t_.threadName || null;
    if (!model) return `❌ Thất bại (Không lấy được thông tin tên nhóm)`;
    if (D_[threadID].namebox) { delete D_[threadID].namebox; fs.writeFileSync(fileAnti, JSON.stringify(D_,null,2)); return '🔴 ĐÃ TẮT'; }
    D_[threadID].namebox = model; fs.writeFileSync(fileAnti, JSON.stringify(D_,null,2)); return '🟢 ĐÃ BẬT';
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
  if (x_ === 'antitheme') {
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
  if (x_ === 'antitagall') {
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
async function antiSpam(api, event, Threads, Users) {
  try {
    const { threadID, senderID } = event;
    let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
    const adminIDs = toAdminIdList(threadDataFetch.threadInfo || threadDataFetch);
    const adminBot = global.config.ADMINBOT || [];
    if (adminBot.includes(senderID) || adminIDs.includes(senderID)) return;
    if (!usersSpam[senderID]) usersSpam[senderID] = { count1:0, count2:0, start1:Date.now(), start2:Date.now(), lastMessage: event.body };
    const currentTime = Date.now();
    if (currentTime - usersSpam[senderID].start1 > 8000) { usersSpam[senderID].count1 = 0; usersSpam[senderID].start1 = currentTime; }
    if (currentTime - usersSpam[senderID].start2 > 2500) { usersSpam[senderID].count2 = 0; usersSpam[senderID].start2 = currentTime; }
    if (event.body === usersSpam[senderID].lastMessage) {
      usersSpam[senderID].count1++;
      if (usersSpam[senderID].count1 > 6 && currentTime - usersSpam[senderID].start1 < 7500) {
        const userInfo = await Users.getData(senderID);
        api.removeUserFromGroup(senderID, threadID);
        api.sendMessage({ body: `Đã tự động kick ${userInfo.name} do hành vi spam liên tục` }, threadID);
        usersSpam[senderID] = { count1:0, count2:0, start1:currentTime, start2:currentTime, lastMessage: '' };
      }
    } else {
      usersSpam[senderID].count2++; usersSpam[senderID].start2 = currentTime; usersSpam[senderID].lastMessage = event.body;
      if (usersSpam[senderID].count2 > 9 && currentTime - usersSpam[senderID].start2 <= 2500) {
        const userInfo = await Users.getData(senderID);
        api.removeUserFromGroup(senderID, threadID);
        api.sendMessage({ body: `Đã tự động kick ${userInfo.name} do spam văn bản khác nhau` }, threadID);
        usersSpam[senderID] = { count1:0, count2:0, start1:currentTime, start2:currentTime, lastMessage: '' };
      }
    }
  } catch (e) { console.error('antiSpam error', e); }
}

async function reSend({ event: e, api: a, client: t, Users: s }) {
  try {
    if (e.senderID == (global.botID || a.getCurrentUserID())) return;
    global.logMessage = global.logMessage || new Map();
    const i = global.data.threadData.get(e.threadID) || {};
    if ((void 0 === i.resend || i.resend != 0) && e.senderID != a.getCurrentUserID()) {
      if (e.type !== 'message_unsend') {
        global.logMessage.set(e.messageID, { msgBody: e.body, attachment: e.attachments });
      }
      if (e.type === 'message_unsend') {
        const m = global.logMessage.get(e.messageID);
        if (!m) return;
        const name = await s.getNameUser(e.senderID);
        if (!m.attachment || m.attachment.length === 0) {
          return a.sendMessage(`${name} vừa gỡ tin nhắn: ${m.msgBody || 'Không có nội dung văn bản'}`, e.threadID);
        } else {
          const request = require('request'); const axios = require('axios'); const { writeFileSync, createReadStream } = require('fs-extra');
          let tcount = 0; let smsg = { body: `${name} vừa gỡ ${m.attachment.length} tệp đính kèm.${m.msgBody ? `\n\nNội dung: ${m.msgBody}` : ''}`, attachment: [] };
          for (const f of m.attachment) {
            tcount++;
            const pathname = (await request.get(f.url)).uri.pathname;
            const ext = pathname.substring(pathname.lastIndexOf('.')+1);
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
    let threadDataFetch = Threads ? await Threads.getData(threadID) : await getThreadInfoCached(api, threadID);
    const adminIDs = toAdminIdList(threadDataFetch.threadInfo || threadDataFetch);
    const adminBot = global.config.ADMINBOT || [];
    if (adminBot.includes(senderID) || adminIDs.includes(senderID) || senderID == api.getCurrentUserID()) return;
    const prefix = global.data?.threadData?.get(threadID)?.PREFIX || global.config.PREFIX;
    if (!body || !body.startsWith(prefix)) return;
    if (!_s[senderID]) _s[senderID] = { count:0, startTime: Date.now() };
    const now = Date.now(); if (now - _s[senderID].startTime > 60000) {_s[senderID].count=0; _s[senderID].startTime=now;} _s[senderID].count++;
    if (_s[senderID].count > 5) {
      try {
        const info = await api.sendMessage('Phát hiện thành viên ' + senderID + ' đang spam bot, quản trị viên hãy thả 1 icon bất kỳ vào đây để khai trừ thành viên này khỏi nhóm!', threadID);
        if (info && info.messageID) {
          if (!global.client) global.client = {};
          if (!Array.isArray(global.client.handleReaction)) global.client.handleReaction = [];
          global.client.handleReaction.push({ name: 'anti', author: senderID, messageID: info.messageID, threadID });
        }
      } catch (err) { /* ignore send errors */ }
    }
  } catch (e) { console.error('antiSpamBot error', e); }
}
