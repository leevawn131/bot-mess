const { execute, getConnection } = require('../../utils/database');
const { checkCooldown } = require('../../utils/cooldown');
const { consumeEnergy } = require('../../utils/energySystem');
const prefix = process.env.BOT_PREFIX || '!';

// Danh sách các loài cá phân theo Độ hiếm (Đã được cân bằng giá bán kiềm chế lạm phát)
const FISH_DATABASE = {
  THUONG: [
    { name: 'Cá Rô Đồng', emoji: '🐟', minSize: 10, maxSize: 25, baseWeight: 0.2, basePrice: 1500 },
    { name: 'Cá Chép', emoji: '🐟', minSize: 20, maxSize: 45, baseWeight: 1.2, basePrice: 2500 },
    { name: 'Cá Trắm Cỏ', emoji: '🐟', minSize: 25, maxSize: 55, baseWeight: 2.0, basePrice: 3500 },
    { name: 'Cá Lóc Đồng', emoji: '🐟', minSize: 20, maxSize: 50, baseWeight: 1.5, basePrice: 3000 },
    { name: 'Cá Mè Vinh', emoji: '🐟', minSize: 15, maxSize: 40, baseWeight: 0.8, basePrice: 2000 }
  ],
  HIEM: [
    { name: 'Cá Hồi Đại Tây Dương', emoji: '🐠', minSize: 40, maxSize: 85, baseWeight: 4.5, basePrice: 12000 },
    { name: 'Cá Tầm Hoàng Gia', emoji: '🐠', minSize: 50, maxSize: 120, baseWeight: 8.0, basePrice: 18000 },
    { name: 'Cá Ngừ Vây Xanh', emoji: '🐠', minSize: 60, maxSize: 150, baseWeight: 25.0, basePrice: 28000 },
    { name: 'Cá Chình Biển', emoji: '🐍', minSize: 50, maxSize: 130, baseWeight: 6.0, basePrice: 15000 }
  ],
  CUC_HIEM: [
    { name: 'Cá Mập Trắng', emoji: '🦈', minSize: 120, maxSize: 320, baseWeight: 180.0, basePrice: 70000 },
    { name: 'Cá Voi Sát Thủ', emoji: '🐋', minSize: 200, maxSize: 480, baseWeight: 450.0, basePrice: 120000 },
    { name: 'Cá Hố Rồng', emoji: '🐉', minSize: 150, maxSize: 350, baseWeight: 120.0, basePrice: 180000 }
  ],
  HUYEN_THOAI: [
    { name: 'Cá Rồng Hoàng Kim', emoji: '✨', minSize: 100, maxSize: 250, baseWeight: 80.0, basePrice: 450000 },
    { name: 'Cá Thần Tài Ngà Ngọc', emoji: '🔱', minSize: 120, maxSize: 280, baseWeight: 110.0, basePrice: 850000 }
  ],
  THAN_THOAI: [
    { name: 'Quái Vật Leviathan', emoji: '🦑', minSize: 500, maxSize: 1500, baseWeight: 2500.0, basePrice: 2500000 },
    { name: 'Thần Biển Poseidon', emoji: '🔱', minSize: 600, maxSize: 1800, baseWeight: 4000.0, basePrice: 5000000 }
  ]
};

function generateFishSize(minSize, maxSize) {
  const u = (Math.random() + Math.random() + Math.random()) / 3;
  const size = minSize + u * (maxSize - minSize);
  return Math.round(size * 10) / 10;
}

module.exports = {
  name: "cauca",
  description: "Buông cần câu cá giải trí và kiếm xu",
  usage: `${prefix}cauca → Tiến hành thả cần câu cá`,

  execute: async ({ api, event }) => {
    const { threadID, messageID, senderID } = event;
    const stringThreadID = String(threadID);
    const stringSenderID = String(senderID);

    // 1. COOLDOWN 45s
    const cooldown = checkCooldown({ command: "cauca", key: senderID, durationMs: 45000 });
    if (!cooldown.allowed) {
      return api.sendMessage(`⏳ Vui lòng nghỉ tay ${cooldown.timeLeft}s trước khi quăng cần tiếp.`, threadID, messageID);
    }

    try {
      // 2. KÍCH HOẠT VÀ TRỪ THỂ LỰC (-8 Thể lực) theo (thread_id, psid)
      let connection;
      let energyUse;
      try {
        connection = await getConnection();
        energyUse = await consumeEnergy(connection, stringThreadID, stringSenderID, 8);
      } catch (err) {
        console.error(err);
        return api.sendMessage("❌ Không thể kiểm tra thể lực lúc này.", threadID, messageID);
      } finally {
        if (connection) connection.release();
      }

      if (!energyUse.ok) {
        if (energyUse.reason === "not_enough") {
          return api.sendMessage(energyUse.message, threadID, messageID);
        }
        return api.sendMessage("❌ Không thể trừ thể lực lúc này.", threadID, messageID);
      }

      // 3. KIỂM TRA CẦN CÂU & MỒI CÂU TRONG TÚI ĐỒ (THẾ GIỚI NÀY)
      const userItems = await execute(
        `SELECT ui.item_key, ui.uses_left, si.name, si.type, si.effect_value 
         FROM user_inventory ui 
         JOIN shop_items si ON ui.item_key = si.item_key 
         WHERE ui.thread_id = ? AND ui.psid = ? AND ui.uses_left > 0 AND si.type IN ('fishing_rod', 'fishing_bait')`,
        [stringThreadID, stringSenderID]
      );

      const rod = userItems.find(i => i.type === 'fishing_rod');
      const bait = userItems.find(i => i.type === 'fishing_bait');

      if (!rod) {
        return api.sendMessage(
          `❌ Bạn chưa có Cần câu ở nhóm này!\n👉 Gõ ${prefix}shop cauca để mua cần câu phù hợp.`,
          threadID,
          messageID
        );
      }

      if (!bait) {
        return api.sendMessage(
          `❌ Bạn chưa có Mồi câu ở nhóm này!\n👉 Gõ ${prefix}shop cauca để mua mồi câu.`,
          threadID,
          messageID
        );
      }

      // 4. TRỪ LƯỢT SỬ DỤNG CẦN CÂU & MỒI CÂU
      await execute(
        `UPDATE user_inventory SET uses_left = uses_left - 1 WHERE thread_id = ? AND psid = ? AND item_key = ?`,
        [stringThreadID, stringSenderID, rod.item_key]
      );
      await execute(
        `UPDATE user_inventory SET uses_left = uses_left - 1 WHERE thread_id = ? AND psid = ? AND item_key = ?`,
        [stringThreadID, stringSenderID, bait.item_key]
      );

      await execute(`DELETE FROM user_inventory WHERE thread_id = ? AND psid = ? AND uses_left <= 0`, [stringThreadID, stringSenderID]);

      const remainingRodUses = rod.uses_left - 1;
      const remainingBaitUses = bait.uses_left - 1;

      // 5. TÍNH TOÁN MAY MẮN & SỰ KIỆN ĐẶC BIỆT
      const randEvent = Math.random() * 100;

      // Event A: 7% Đứt dây câu / Cá sổng
      if (randEvent < 7) {
        return api.sendMessage(
          `💥 Ôi không! Một con cá quá khỏe đã giật mạnh làm ĐỨT DÂY CÂU và sổng mất!\n` +
          `⚡ Thể lực: -8 (${energyUse.energy}/${energyUse.maxEnergy})\n` +
          `🎒 Cần câu (${rod.name}): Còn ${remainingRodUses} lượt | Mồi (${bait.name}): Còn ${remainingBaitUses} lượt`,
          threadID,
          messageID
        );
      }

      // Event B: 5% Rương Báu hoặc Rác biển
      if (randEvent >= 7 && randEvent < 12) {
        const isTreasure = Math.random() < 0.5;
        if (isTreasure) {
          const goldBonus = Math.floor(Math.random() * 45000) + 15000;

          const userExist = await execute("SELECT * FROM messenger_users WHERE thread_id = ? AND psid = ?", [stringThreadID, stringSenderID]);
          if (userExist.length > 0) {
            await execute(
              `UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?`,
              [goldBonus, stringThreadID, stringSenderID]
            );
          } else {
            const userName = (global.data && global.data.userName && global.data.userName.get(stringSenderID)) || "Người dùng";
            await execute(
              `INSERT INTO messenger_users (thread_id, psid, name, credits) VALUES (?, ?, ?, ?)`,
              [stringThreadID, stringSenderID, userName, 10000 + goldBonus]
            );
          }

          return api.sendMessage(
            `🧰 BẠN VỪA VỚT ĐƯỢC MỘT RƯƠNG BÁU BIỂN CỔ!\n` +
            `━━━━━━━━━━━━━\n` +
            `💰 Bên trong chứa: +${goldBonus.toLocaleString('vi-VN')} xu!\n` +
            `⚡ Thể lực: -8 (${energyUse.energy}/${energyUse.maxEnergy})\n` +
            `🎒 Cần câu: ${remainingRodUses} lượt | Mồi: ${remainingBaitUses} lượt`,
            threadID,
            messageID
          );
        } else {
          await execute(
            `INSERT INTO user_caught_fish (psid, thread_id, fish_name, rarity, size_cm, weight_kg, price, is_king) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
            [stringSenderID, stringThreadID, 'Lốp Xe Cũ Phế Liệu', 'Rác Biển', 80.0, 15.0, 500]
          );

          return api.sendMessage(
            `👟 Ẹp... Bạn vừa kéo lên được một chiếc... LỐP XE CŨ PHẾ LIỆU!\n` +
            `━━━━━━━━━━━━━\n` +
            `💵 Giá ve ve phế liệu: 500 xu.\n` +
            `⚡ Thể lực: -8 (${energyUse.energy}/${energyUse.maxEnergy})\n` +
            `🎒 Cần câu: ${remainingRodUses} lượt | Mồi: ${remainingBaitUses} lượt`,
            threadID,
            messageID
          );
        }
      }

      // Event C: Câu trúng cá!
      const luckBonus = ((rod.effect_value || 0) + (bait.effect_value || 0)) / 100;

      const rarityRoll = Math.random() * 100;
      let selectedRarity = 'THUONG';
      let rarityText = '🟢 Thường';

      if (rarityRoll < 0.5 + luckBonus * 0.8) {
        selectedRarity = 'THAN_THOAI';
        rarityText = '🔴 Thần Thoại';
      } else if (rarityRoll < 4 + luckBonus * 2) {
        selectedRarity = 'HUYEN_THOAI';
        rarityText = '🟡 Huyền Thoại';
      } else if (rarityRoll < 13 + luckBonus * 4) {
        selectedRarity = 'CUC_HIEM';
        rarityText = '🟣 Cực Hiếm';
      } else if (rarityRoll < 35 + luckBonus * 6) {
        selectedRarity = 'HIEM';
        rarityText = '🔵 Hiếm';
      }

      const fishList = FISH_DATABASE[selectedRarity];
      const fishSpec = fishList[Math.floor(Math.random() * fishList.length)];

      const sizeCm = generateFishSize(fishSpec.minSize, fishSpec.maxSize);
      const avgSize = (fishSpec.minSize + fishSpec.maxSize) / 2;

      const weightKg = Math.round((fishSpec.baseWeight * Math.pow(sizeCm / avgSize, 2.5)) * 10) / 10;

      const isKing = sizeCm >= (fishSpec.minSize + 0.88 * (fishSpec.maxSize - fishSpec.minSize)) ? 1 : 0;
      const kingMultiplier = isKing ? (1.5 + Math.random() * 0.5) : 1.0;

      const rawPrice = fishSpec.basePrice * Math.pow(sizeCm / avgSize, 1.5) * kingMultiplier;
      const finalPrice = Math.round(rawPrice / 100) * 100;

      await execute(
        `INSERT INTO user_caught_fish (psid, thread_id, fish_name, rarity, size_cm, weight_kg, price, is_king) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [stringSenderID, stringThreadID, fishSpec.name, rarityText, sizeCm, weightKg, finalPrice, isKing]
      );

      let msg = `🎣 BẠN VỪA GIẬT CẦU THÀNH CÔNG (THẾ GIỚI NÀY)!\n`;
      msg += `━━━━━━━━━━━━━\n`;
      if (isKing) {
        msg += `👑👑 CÁ KỶ LỤC (KING SIZE)! 👑👑\n`;
      }
      msg += `${fishSpec.emoji} Tên cá: ${fishSpec.name}\n`;
      msg += `🏷️ Độ hiếm: ${rarityText}\n`;
      msg += `📏 Kích thước: ${sizeCm} cm | ⚖️ Cân nặng: ${weightKg} kg\n`;
      msg += `💰 Giá ước tính: ${finalPrice.toLocaleString('vi-VN')} xu\n`;
      msg += `⚡ Thể lực: -8 (${energyUse.energy}/${energyUse.maxEnergy})\n`;
      msg += `━━━━━━━━━━━━━\n`;
      msg += `🎒 Cần (${rod.name}): Còn ${remainingRodUses} lượt\n`;
      msg += `🎒 Mồi (${bait.name}): Còn ${remainingBaitUses} lượt\n`;
      msg += `👉 Gõ ${prefix}shop banca để bán toàn bộ cá thu về xu!`;

      return api.sendMessage(msg, threadID, messageID);

    } catch (err) {
      console.error("Lỗi khi thực hiện lệnh câu cá:", err);
      return api.sendMessage("❌ Có lỗi xảy ra khi buông cần câu.", threadID, messageID);
    }
  }
};
