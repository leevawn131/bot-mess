module.exports.config = {
  name: "kick",
  version: "5.0.0",
  hasPermssion: 1,
  credits: "Derek",
  description: "Kick thành viên khỏi nhóm",
  commandCategory: "Quản Trị Viên",
  usages: "[tag/reply/uid/all]",
  cooldowns: 3
};

module.exports.run = async function ({ api, event, args }) {

  const { threadID, messageID, senderID } = event;

  try {

    const threadInfo = await api.getThreadInfo(threadID);

    const botID = api.getCurrentUserID();

    // Check bot admin
    const botIsAdmin = threadInfo.adminIDs.some(
      item => String(item.id) === String(botID)
    );

    if (!botIsAdmin) {
      return api.sendMessage(
`╭───────⭓
│ ❌ Bot chưa có QTV
╰───────⭓`,
        threadID,
        messageID
      );
    }

    // Check người dùng admin
    const senderIsAdmin = threadInfo.adminIDs.some(
      item => String(item.id) === String(senderID)
    );

    if (!senderIsAdmin) {
      return api.sendMessage(
`╭───────⭓
│ ❌ Bạn không phải QTV
╰───────⭓`,
        threadID,
        messageID
      );
    }

    let users = [];

    // Tag
    if (Object.keys(event.mentions).length > 0) {

      users = Object.keys(event.mentions);

    }

    // Reply
    else if (event.messageReply) {

      users.push(event.messageReply.senderID);

    }

    // Kick all
    else if (args[0] === "all") {

      const adminIDs = threadInfo.adminIDs.map(
        item => String(item.id)
      );

      users = threadInfo.participantIDs.filter(
        id =>
          String(id) !== String(botID) &&
          String(id) !== String(senderID) &&
          !adminIDs.includes(String(id))
      );

    }

    // UID
    else if (args[0]) {

      users = args;

    }

    if (users.length === 0) {
      return api.sendMessage(
`╭───────⭓
│ ⚠️ Dùng:
│ • /kick @tag
│ • reply tin nhắn
│ • /kick uid
│ • /kick all
╰───────⭓`,
        threadID,
        messageID
      );
    }

    let success = 0;
    let failed = 0;

    for (const id of users) {

      const uid = String(id);

      // Không kick bot
      if (uid === String(botID)) {
        failed++;
        continue;
      }

      // Không kick chính mình
      if (uid === String(senderID)) {
        failed++;
        continue;
      }

      // Không kick admin
      const isAdmin = threadInfo.adminIDs.some(
        item => String(item.id) === uid
      );

      if (isAdmin) {
        failed++;
        continue;
      }

      // Remove bằng callback chuẩn Horizon
      await new Promise((resolve) => {

        api.removeUserFromGroup(uid, threadID, (err) => {

          if (err) {

            console.log(err);

            failed++;

          } else {

            success++;

          }

          resolve();

        });

      });

    }

    return api.sendMessage(
`╭───────⭓
│ 🗑️ Kick Thành Công
├───────⭓
│ ✅ Thành công: ${success}
│ ❌ Thất bại: ${failed}
╰───────⭓`,
      threadID,
      messageID
    );

  } catch (e) {

    console.log(e);

    return api.sendMessage(
`╭───────⭓
│ ❌ Đã xảy ra lỗi
╰───────⭓`,
      threadID,
      messageID
    );

  }

};