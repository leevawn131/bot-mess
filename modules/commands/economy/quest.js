const mysql = require("mysql2/promise");
const { checkCooldown } = require("../../utils/cooldown");
const {
  getUserQuests,
  acceptRandomQuest,
  previewClaims,
  previewClaimAll,
  markQuestsClaimed,
} = require("../../utils/questSystem");

function getTierLabel(tier) {
  if (tier === "easy") return "Dễ";
  if (tier === "medium") return "Trung bình";
  if (tier === "hard") return "Khó";
  return "Hiếm";
}

function normalizeInput(input) {
  return (input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function parseTierFilter(input) {
  const key = normalizeInput(input);

  if (["de", "easy", "d", "1"].includes(key)) return "easy";
  if (["trungbinh", "tb", "medium", "m", "2"].includes(key)) return "medium";
  if (["kho", "hard", "h", "3"].includes(key)) return "hard";
  if (["hiem", "rare", "r", "4", "dianguc", "hell"].includes(key))
    return "rare";
  return null;
}

module.exports = {
  name: "quest",
  description: "Quest ngày: nhận random, check tiến độ, claim thưởng",
  usage: "\n!quest nhan <de|tb|kho|hiem> → Nhận quest ngẫu nhiên theo độ khó\n!quest check → Xem tiến độ quest hiện tại\n!quest claim → Nhận thưởng quest đã hoàn thành\n━{13}\n🎯 Mỗi ngày nhận tối đa 3 quest\n🏅 Độ khó càng cao, thưởng càng lớn\n💡 Ví dụ: !quest nhan kho",

  execute: async ({ api, event, args, config }) => {
    const { threadID, messageID, senderID } = event;
    const rawSubCommand = args[0] || "";
    const subCommand = normalizeInput(rawSubCommand);

    const cooldown = checkCooldown({
      command: "quest",
      key: senderID,
      durationMs: 10000,
    });
    if (!cooldown.allowed) {
      return api.sendMessage(
        `⏳ Chờ ${cooldown.timeLeft}s rồi dùng lại lệnh quest.`,
        threadID,
        messageID,
      );
    }

    try {
      const data = await getUserQuests(senderID);
      const quests = data.quests;

      if (subCommand === "claim") {
        const claimArg = (args[1] || "").toLowerCase();
        if (!claimArg) {
          return api.sendMessage(
            "💡 Dùng: quest claim all hoặc quest claim [STT trong quest check]",
            threadID,
            messageID,
          );
        }

        try {
          const rows = await execute(
            "SELECT credits FROM messenger_users WHERE psid = ?",
            [senderID],
          );
          if (rows.length === 0) {
            return api.sendMessage(
              "❌ Bạn chưa có tài khoản.\nGõ !tien để tạo trước.",
              threadID,
              messageID,
            );
          }

          const baseCredits = parseInt(rows[0].credits) || 0;

          if (claimArg === "all") {
            const claimAllResult = await previewClaimAll(senderID);
            if (claimAllResult.claimableCount === 0) {
              return api.sendMessage(
                "🫠 Không có nhiệm vụ đã nhận nào đủ điều kiện nhận thưởng.",
                threadID,
                messageID,
              );
            }

            await execute(
              "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
              [claimAllResult.totalReward, senderID],
            );
            const markResult = await markQuestsClaimed(
              senderID,
              claimAllResult.claimableIDs,
            );

            if (
              markResult.markedCount !== claimAllResult.claimableCount ||
              markResult.totalReward !== claimAllResult.totalReward
            ) {
              throw new Error("Quest claim mismatch after DB update");
            }

            return api.sendMessage(
              `🎉 Nhận thưởng ${claimAllResult.claimableCount} nhiệm vụ: +${claimAllResult.totalReward.toLocaleString()} xu\n` +
                `💳 Số dư mới: ${(baseCredits + claimAllResult.totalReward).toLocaleString()} xu`,
              threadID,
              messageID,
            );
          }

          const latestData = await getUserQuests(senderID);
          const acceptedQuests = latestData.quests.filter(
            (quest) => quest.accepted,
          );
          if (acceptedQuests.length === 0) {
            return api.sendMessage(
              "📭 Bạn chưa nhận nhiệm vụ nào. Dùng quest nhan để lấy quest random.",
              threadID,
              messageID,
            );
          }

          const sttList = args
            .slice(1)
            .join(" ")
            .split(/[\s,]+/)
            .map((item) => parseInt(item, 10))
            .filter((num) => !Number.isNaN(num));

          if (sttList.length === 0) {
            return api.sendMessage(
              "⚠️ STT không hợp lệ. Ví dụ: quest claim 1 2 3",
              threadID,
              messageID,
            );
          }

          const uniqueStt = [...new Set(sttList)];
          const invalidStt = uniqueStt.filter(
            (num) => num < 1 || num > acceptedQuests.length,
          );
          if (invalidStt.length > 0) {
            return api.sendMessage(
              `⚠️ Có STT không hợp lệ: ${invalidStt.join(", ")}. Chỉ chọn từ 1 đến ${acceptedQuests.length} (theo quest check).`,
              threadID,
              messageID,
            );
          }

          const selectedQuestIDs = uniqueStt.map(
            (stt) => acceptedQuests[stt - 1].id,
          );
          const preview = await previewClaims(senderID, selectedQuestIDs);

          if (preview.totalReward > 0) {
            await execute(
              "UPDATE messenger_users SET credits = credits + ? WHERE psid = ?",
              [preview.totalReward, senderID],
            );
            const markResult = await markQuestsClaimed(
              senderID,
              preview.claimableIDs,
            );
            if (
              markResult.markedCount !== preview.claimableCount ||
              markResult.totalReward !== preview.totalReward
            ) {
              throw new Error("Quest claim mismatch after DB update");
            }
          }

          let rewardMsg = "🎁 KẾT QUẢ NHẬN THƯỞNG\n━{13}\n";
          rewardMsg += `✅ Nhận thành công: ${preview.claimableCount}\n`;
          rewardMsg += `💰 Tổng thưởng: +${preview.totalReward.toLocaleString()} xu\n`;
          if (preview.alreadyClaimedCount > 0)
            rewardMsg += `ℹ️ Đã nhận trước đó: ${preview.alreadyClaimedCount}\n`;
          if (preview.notCompleteCount > 0)
            rewardMsg += `⏳ Chưa hoàn thành: ${preview.notCompleteCount}\n`;
          rewardMsg += `💳 Số dư mới: ${(baseCredits + preview.totalReward).toLocaleString()} xu`;

          return api.sendMessage(rewardMsg, threadID, messageID);
        } catch (error) {
          console.error(error);
          return api.sendMessage(
            "❌ Lỗi nhận thưởng quest.",
            threadID,
            messageID,
          );
        }
      }

      if (subCommand === "check") {
        const acceptedQuests = quests.filter((quest) => quest.accepted);

        if (acceptedQuests.length === 0) {
          return api.sendMessage(
            "📭 Bạn chưa nhận nhiệm vụ nào. Gõ quest nhan để lấy quest random.",
            threadID,
            messageID,
          );
        }

        let checkMsg = `📌 NHIỆM VỤ ĐÃ NHẬN (${data.date})\n━{13}\n`;
        checkMsg += `🎯 Đã nhận: ${acceptedQuests.length}/${data.maxAccepted} quest${data.hasVip ? " (VIP)" : ""}\n\n`;

        acceptedQuests.forEach((quest, index) => {
          let status = "🔄 Đang làm";
          if (quest.claimed) status = "🏆 Đã nhận thưởng";
          else if (quest.progress >= quest.target) status = "✅ Hoàn thành";

          checkMsg += `${index + 1}. ${quest.title}\n`;
          checkMsg += `   - Nhiệm vụ: ${quest.description}\n`;
          checkMsg += `   - Tiến độ: ${Number(quest.progress).toLocaleString()}/${Number(quest.target).toLocaleString()}\n`;
          checkMsg += `   - Thưởng: ${Number(quest.reward).toLocaleString()} xu\n`;
          checkMsg += `   - Trạng thái: ${status}\n\n`;
        });

        checkMsg += "━{13}\n";
        checkMsg += "💡 Claim thưởng: quest claim all hoặc quest claim [STT].";

        return api.sendMessage(checkMsg, threadID, messageID);
      }

      if (["nhan", "accept", "random"].includes(subCommand)) {
        const result = await acceptRandomQuest(senderID);

        if (!result.ok && result.reason === "limit_reached") {
          return api.sendMessage(
            `📦 Bạn đã đạt giới hạn quest hôm nay: ${result.acceptedCount}/${result.maxAccepted}${result.hasVip ? " (VIP)" : ""}.\n` +
              "💡 Dùng quest check để xem tiến độ và quest claim all để nhận thưởng.",
            threadID,
            messageID,
          );
        }

        if (!result.ok && result.reason === "no_available") {
          return api.sendMessage(
            "📭 Không còn quest có thể nhận thêm hôm nay.\n" +
              "💡 Dùng quest check để xem tiến độ và quest claim all để nhận thưởng.",
            threadID,
            messageID,
          );
        }

        if (!result.ok) {
          return api.sendMessage(
            "❌ Không thể nhận quest lúc này, thử lại sau.",
            threadID,
            messageID,
          );
        }

        const tierLabel = getTierLabel(result.selectedTier);
        const quest = result.quest;

        let msg = "🎲 NHẬN QUEST NGẪU NHIÊN\n━{13}\n";
        msg += `📌 ${quest.title}\n`;
        msg += `- Mức độ: ${tierLabel}\n`;
        msg += `- ${quest.description}\n`;
        msg += `- Mục tiêu: ${Number(quest.target).toLocaleString()}\n`;
        msg += `- Thưởng: ${Number(quest.reward).toLocaleString()} xu\n`;
        msg += `🎯 Đã nhận: ${result.acceptedCount}/${result.maxAccepted}${result.hasVip ? " (VIP)" : ""}\n`;
        msg += `🎁 Slot còn lại: ${result.remainingSlots}\n`;
        msg += "━{13}\n";
        msg += "💡 Dùng quest check để theo dõi tiến độ.";

        return api.sendMessage(msg, threadID, messageID);
      }

      const availableQuests = quests.filter((quest) => !quest.accepted);
      const tierFilter = parseTierFilter(rawSubCommand);

      if (availableQuests.length === 0) {
        return api.sendMessage(
          `📭 Bạn đã nhận tối đa quest hôm nay (${data.acceptedCount}/${data.maxAccepted}${data.hasVip ? " VIP" : ""}).\n` +
            "💡 Dùng quest check để xem tiến độ và quest claim all để nhận thưởng.",
          threadID,
          messageID,
        );
      }

      let msg = `📜 QUEST HÔM NAY (${data.date})\n━{13}\n`;
      msg += `🎯 Đã nhận: ${data.acceptedCount}/${data.maxAccepted}${data.hasVip ? " (VIP)" : ""}\n`;
      msg += `🎁 Còn lại: ${data.remainingSlots} nhiệm vụ\n`;
      msg += "━{13}\n";
      msg += "👉 Nhận quest: quest nhan\n";
      msg += "👉 Xem tiến độ: quest check\n";
      msg += "👉 Nhận thưởng: quest claim all";

      if (tierFilter) {
        msg += `\n\nℹ️ Hiện tại không hiển thị danh sách quest theo mức ${getTierLabel(tierFilter)}.`;
      }

      return api.sendMessage(msg, threadID, messageID);
    } catch (error) {
      console.error("❌ Lỗi lệnh quest:", error);
      return api.sendMessage(
        "❌ Lỗi thực thi lệnh quest. Vui lòng thử lại trong vài giây.",
        threadID,
        messageID,
      );
    }
  },
};
