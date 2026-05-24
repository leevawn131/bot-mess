const { checkPermission } = require("../../modules/utils/checkPermission");

function normalizeReaction(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";

  if (text === "like" || text === "👍" || text === "thumbsup" || text === "thumbs_up") {
    return "like";
  }

  return text;
}

module.exports = {
  name: "likeDelete",
  eventType: ["message_reaction"],

  execute: async ({ api, event }) => {
    const threadID = String(event?.threadID || "");
    const reactorID = String(event?.userID || "");
    const messageOwnerID = String(event?.senderID || "");
    const botID = String(api.getCurrentUserID());

    if (!threadID || !event?.messageID) return;
    if (!reactorID || reactorID === botID) return;
    if (!messageOwnerID || messageOwnerID !== botID) return;

    const reaction = normalizeReaction(event.reaction || event.emoji || event.icon);
    if (reaction !== "like") return;

    // Kiểm tra quyền theo mode hiện tại
    try {
      const permCheck = await checkPermission(threadID, reactorID, api);
      if (!permCheck.allowed) return;
    } catch (permErr) {
      console.error("Lỗi check quyền thả like:", permErr);
      return;
    }

    try {
      await api.unsendMessage(event.messageID);
    } catch (error) {
      console.error("Lỗi xóa tin nhắn khi thả like:", error);
    }
  },
};