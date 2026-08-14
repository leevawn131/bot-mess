const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
const config = require('../../config.json');
const { getThreadInfoCached } = require('../utils/threadInfo');

module.exports = {
  name: 'antiEvent',
  eventType: ["log:subscribe","log:thread-name","log:unsubscribe","log:thread-image","log:thread-admins","change_thread_image"],

  run: async function(Obj) { return this.execute(Obj); },
    execute: async ({ api, event, Threads }) => {
    const antiDir = path.join('./modules/data/anti');
    const fileAnti = path.join(antiDir, 'antiFile.json');
    if (!fs.existsSync(antiDir)) fs.mkdirSync(antiDir, { recursive: true });
    if (!fs.existsSync(fileAnti)) fs.writeFileSync(fileAnti, JSON.stringify({}));

    let DataAnti = {};
    try { DataAnti = JSON.parse(fs.readFileSync(fileAnti,'utf-8')||'{}'); } catch(e){ DataAnti = {}; }
    const botID = api.getCurrentUserID();
    const threadID = event.threadID;

    const isAllowed = async (uid) => {
      if (String(uid) === String(botID)) return true;

      const adminBotList = [
        ...(Array.isArray(global.config?.ADMINBOT) ? global.config.ADMINBOT : []),
        ...(Array.isArray(global.config?.adminIDs) ? global.config.adminIDs : []),
        ...(Array.isArray(config?.adminIDs) ? config.adminIDs : [])
      ].map(String);
      if (adminBotList.includes(String(uid))) return true;

      try {
        const threadDataFetch = Threads ? await Threads.getData(threadID) : null;
        const info = threadDataFetch?.threadInfo || await getThreadInfoCached(api, threadID);
        if (info && Array.isArray(info.adminIDs)) {
          return info.adminIDs.some(el => String(el.id || el) === String(uid));
        }
      } catch (e) { return false; }
      return false;
    };

    // 1. ANTI ĐỔI TÊN NHÓM
    if (event.logMessageType === 'log:thread-name' && DataAnti[threadID] && DataAnti[threadID].namebox) {
      const isAuthorAllowed = await isAllowed(event.author);
      if (isAuthorAllowed) {
        DataAnti[threadID].namebox = event.logMessageData.name || DataAnti[threadID].namebox;
        await fs.writeJson(fileAnti, DataAnti, { spaces: 2 });
      } else {
        await api.setTitle(DataAnti[threadID].namebox, threadID);
        if (!DataAnti[threadID].warn || DataAnti[threadID].warn.namebox !== false) {
          const { addWarning } = require('../utils/warningStorage');
          await addWarning(api, threadID, event.author, "Tự ý đổi tên nhóm");
        }
      }
    }

    // 2. ANTI THÊM THÀNH VIÊN
    if (event.logMessageType === 'log:subscribe' && DataAnti[threadID] && DataAnti[threadID].join) {
      if (event.logMessageData && Array.isArray(event.logMessageData.addedParticipants)) {
        const botIn = event.logMessageData.addedParticipants.some(i => String(i.userFbId) === String(botID));
        if (botIn) return;
        const memJoin = event.logMessageData.addedParticipants.map(info => info.userFbId);
        for (const idUser of memJoin) { await new Promise(r=>setTimeout(r,1000)); api.removeUserFromGroup(idUser, threadID); }
        if (!DataAnti[threadID].warn || DataAnti[threadID].warn.join !== false) {
          const { addWarning } = require('../utils/warningStorage');
          await addWarning(api, threadID, event.author, "Tự ý thêm thành viên mới khi đang bật anti-join");
        }
      }
    }

    // 3. ANTI THOÁT NHÓM (TỰ ĐỘNG THÊM LẠI)
    if (event.logMessageType === 'log:unsubscribe' && DataAnti[threadID] && DataAnti[threadID].out) {
      const typeOut = event.author == event.logMessageData.leftParticipantFbId ? 'out' : 'kick';
      if (typeOut === 'out') {
        api.addUserToGroup(event.logMessageData.leftParticipantFbId, threadID, (err) => {
          if (err) api.sendMessage('❎ Không thể thêm lại người dùng', threadID);
          else api.sendMessage('✅ Đã thêm lại thành công người vừa thoát', threadID);
        });
      }
    }

    // 4. ANTI ĐỔI ẢNH NHÓM
    if (event.type === 'change_thread_image' && DataAnti[threadID] && DataAnti[threadID].avtbox) {
      const isAuthorAllowed = await isAllowed(event.author);
      const newUrl = event.image?.url || null;

      if (isAuthorAllowed) {
        if (!newUrl) {
          // Trường hợp QTV hoặc bot gỡ ảnh nhóm
          delete DataAnti[threadID].avtbox;
          await fs.writeJson(fileAnti, DataAnti, { spaces: 2 });
          const localPath = path.resolve(__dirname, `../../cache/avtbox_${threadID}.jpg`);
          if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
          return api.sendMessage('Vì quản trị viên đã gỡ avt, bot tự động tắt anti đổi ảnh nhóm', threadID);
        } else {
          // Trường hợp QTV hoặc bot đổi ảnh mới -> Cập nhật cache cục bộ
          try {
            const cacheDir = path.resolve(__dirname, '../../cache');
            const localPath = path.join(cacheDir, `avtbox_${threadID}.jpg`);
            const response = await axios.get(newUrl, { responseType: 'arraybuffer' });
            await fs.writeFile(localPath, Buffer.from(response.data));
          } catch (err) {
            console.error('[AVTBOX] Lỗi cập nhật ảnh nhóm mới:', err);
          }
        }
      } else {
        // Thành viên thường đổi ảnh -> Khôi phục về ảnh cũ từ cache
        const localPath = path.resolve(__dirname, `../../cache/avtbox_${threadID}.jpg`);
        if (fs.existsSync(localPath)) {
          api.changeGroupImage(fs.createReadStream(localPath), threadID, (err) => {
            if (err) return api.sendMessage('⚠️ Có lỗi xảy ra khi khôi phục ảnh nhóm', threadID);
          });
        }
        if (!DataAnti[threadID].warn || DataAnti[threadID].warn.avtbox !== false) {
          const { addWarning } = require('../utils/warningStorage');
          await addWarning(api, threadID, event.author, "Tự ý đổi ảnh nhóm");
        }
      }
    }
    // Tự động tắt các chế độ anti khi bot bị gỡ Admin nhóm
    if (event.logMessageType === 'log:thread-admins' && event.logMessageData.ADMIN_EVENT === 'remove_admin') {
      await delModeAnti(event, DataAnti, botID, api);
    }
  }
};

async function delModeAnti(event, DataAnti, botID, api) {
  if (event.logMessageData.TARGET_ID == botID) {
    const list = ['join','spam'];
    let xyz = [];
    for (const a of list) {
      if (!DataAnti[event.threadID] || !DataAnti[event.threadID][a]) continue;
      delete DataAnti[event.threadID][a]; xyz.push(a);
    }
    await fs.writeJson(path.join('./modules/data/anti','antiFile.json'), DataAnti, { spaces: 2 });
    
    try {
      const { isAntitagallEnabled, setAntitagallEnabled } = require('../../utils/antitagallSettings');
      if (isAntitagallEnabled(event.threadID)) {
        setAntitagallEnabled(event.threadID, false);
        xyz.push('antitagall');
      }
    } catch (e) {
      console.error('[ANTI] Lỗi khi tắt antitagall:', e);
    }

    if (xyz.length === 0) return;
    api.sendMessage(`Bot đã mất quyền Admin => Tự động tắt các chế độ anti: ${xyz.join(', ')}`, event.threadID);
  }
}
