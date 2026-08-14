const fs = require("fs");
const path = require("path");
const { execute, getConnection } = require("./database");

const CONFIG_PATH = path.resolve(__dirname, "../../config.json");

const QUEST_DEFINITIONS = [
  {
    id: "work_3",
    action: "work",
    title: "Khởi Động Nhẹ",
    description: "Làm việc 3 lần",
    target: 3,
    reward: 60000,
  },
  {
    id: "work_5",
    action: "work",
    title: "Siêng Năng",
    description: "Làm việc 5 lần",
    target: 5,
    reward: 90000,
  },
  {
    id: "work_10",
    action: "work",
    title: "Chăm Chỉ",
    description: "Làm việc 10 lần",
    target: 10,
    reward: 180000,
  },
  {
    id: "work_15",
    action: "work",
    title: "Cày Cuốc",
    description: "Làm việc 15 lần",
    target: 15,
    reward: 280000,
  },
  {
    id: "work_20",
    action: "work",
    title: "Máy Cày",
    description: "Làm việc 20 lần",
    target: 20,
    reward: 380000,
  },
  {
    id: "work_earn_200k",
    action: "work_earn",
    title: "Lương Đầu Tay",
    description: "Kiếm 200,000 xu từ làm việc",
    target: 200000,
    reward: 80000,
  },
  {
    id: "work_earn_500k",
    action: "work_earn",
    title: "Tăng Ca",
    description: "Kiếm 500,000 xu từ làm việc",
    target: 500000,
    reward: 150000,
  },
  {
    id: "work_earn_1m",
    action: "work_earn",
    title: "Cày Hết Sức",
    description: "Kiếm 1,000,000 xu từ làm việc",
    target: 1000000,
    reward: 300000,
  },
  {
    id: "work_earn_2m",
    action: "work_earn",
    title: "Cỗ Máy In Tiền",
    description: "Kiếm 2,000,000 xu từ làm việc",
    target: 2000000,
    reward: 550000,
  },
  {
    id: "work_earn_3m",
    action: "work_earn",
    title: "Ông Trùm Lao Động",
    description: "Kiếm 3,000,000 xu từ làm việc",
    target: 3000000,
    reward: 800000,
  },
  {
    id: "work_earn_4m",
    action: "work_earn",
    title: "Huyền Thoại Cày",
    description: "Kiếm 4,000,000 xu từ làm việc",
    target: 4000000,
    reward: 1000000,
  },
  {
    id: "work_earn_5m",
    action: "work_earn",
    title: "Vua Cày Cuốc",
    description: "Kiếm 5,000,000 xu từ làm việc",
    target: 5000000,
    reward: 1200000,
  },
  {
    id: "bet_count_5",
    action: "bet_count",
    title: "Khởi Động Sòng",
    description: "Đặt cược 5 lần",
    target: 5,
    reward: 90000,
  },
  {
    id: "bet_count_10",
    action: "bet_count",
    title: "Khách Quen",
    description: "Đặt cược 10 lần",
    target: 10,
    reward: 180000,
  },
  {
    id: "bet_count_20",
    action: "bet_count",
    title: "Lì Đòn",
    description: "Đặt cược 20 lần",
    target: 20,
    reward: 380000,
  },
  {
    id: "bet_count_30",
    action: "bet_count",
    title: "Nghiện Sòng",
    description: "Đặt cược 30 lần",
    target: 30,
    reward: 550000,
  },
  {
    id: "bet_count_40",
    action: "bet_count",
    title: "Cao Thủ Đêm",
    description: "Đặt cược 40 lần",
    target: 40,
    reward: 750000,
  },
  {
    id: "bet_amount_500k",
    action: "bet_amount",
    title: "Đốt Lửa",
    description: "Cược tổng 500,000 xu",
    target: 500000,
    reward: 100000,
  },
  {
    id: "bet_amount_1m",
    action: "bet_amount",
    title: "Máu Cược",
    description: "Cược tổng 1,000,000 xu",
    target: 1000000,
    reward: 200000,
  },
  {
    id: "bet_amount_2m",
    action: "bet_amount",
    title: "Đại Gia Mini",
    description: "Cược tổng 2,000,000 xu",
    target: 2000000,
    reward: 350000,
  },
  {
    id: "bet_amount_4m",
    action: "bet_amount",
    title: "Đại Gia",
    description: "Cược tổng 4,000,000 xu",
    target: 4000000,
    reward: 600000,
  },
  {
    id: "bet_amount_6m",
    action: "bet_amount",
    title: "Bão Chip",
    description: "Cược tổng 6,000,000 xu",
    target: 6000000,
    reward: 800000,
  },
  {
    id: "bet_amount_8m",
    action: "bet_amount",
    title: "Cá Voi",
    description: "Cược tổng 8,000,000 xu",
    target: 8000000,
    reward: 1000000,
  },
  {
    id: "bet_amount_10m",
    action: "bet_amount",
    title: "Hủy Diệt Sòng",
    description: "Cược tổng 10,000,000 xu",
    target: 10000000,
    reward: 1200000,
  },
  {
    id: "bet_amount_12m",
    action: "bet_amount",
    title: "Bậc Thầy Casino",
    description: "Cược tổng 12,000,000 xu",
    target: 12000000,
    reward: 1400000,
  },
  {
    id: "bet_amount_15m",
    action: "bet_amount",
    title: "Trùm Sòng Bạc",
    description: "Cược tổng 15,000,000 xu",
    target: 15000000,
    reward: 1500000,
  },
  {
    id: "rob_success_1",
    action: "rob_success",
    title: "Ra Nghề",
    description: "Cướp thành công 1 lần",
    target: 1,
    reward: 100000,
  },
  {
    id: "rob_success_3",
    action: "rob_success",
    title: "Tay Giật Mới",
    description: "Cướp thành công 3 lần",
    target: 3,
    reward: 250000,
  },
  {
    id: "rob_success_5",
    action: "rob_success",
    title: "Đường Phố Gọi Tên",
    description: "Cướp thành công 5 lần",
    target: 5,
    reward: 400000,
  },
  {
    id: "rob_success_8",
    action: "rob_success",
    title: "Bóng Ma Thành Phố",
    description: "Cướp thành công 8 lần",
    target: 8,
    reward: 650000,
  },
  {
    id: "rob_success_12",
    action: "rob_success",
    title: "Ông Trùm Đêm",
    description: "Cướp thành công 12 lần",
    target: 12,
    reward: 900000,
  },
  {
    id: "rob_amount_300k",
    action: "rob_amount",
    title: "Giật Nhẹ",
    description: "Cướp thực nhận tổng 300,000 xu",
    target: 300000,
    reward: 100000,
  },
  {
    id: "rob_amount_1m",
    action: "rob_amount",
    title: "Săn Mồi",
    description: "Cướp thực nhận tổng 1,000,000 xu",
    target: 1000000,
    reward: 300000,
  },
  {
    id: "rob_amount_2m",
    action: "rob_amount",
    title: "Đột Kích",
    description: "Cướp thực nhận tổng 2,000,000 xu",
    target: 2000000,
    reward: 500000,
  },
  {
    id: "rob_amount_3m",
    action: "rob_amount",
    title: "Két Sắt Đêm",
    description: "Cướp thực nhận tổng 3,000,000 xu",
    target: 3000000,
    reward: 700000,
  },
  {
    id: "rob_amount_5m",
    action: "rob_amount",
    title: "Đêm Không Ngủ",
    description: "Cướp thực nhận tổng 5,000,000 xu",
    target: 5000000,
    reward: 900000,
  },
  {
    id: "rob_amount_7m",
    action: "rob_amount",
    title: "Cướp Huyền Thoại",
    description: "Cướp thực nhận tổng 7,000,000 xu",
    target: 7000000,
    reward: 1100000,
  },
  {
    id: "rob_amount_10m",
    action: "rob_amount",
    title: "Tử Thần Thành Phố",
    description: "Cướp thực nhận tổng 10,000,000 xu",
    target: 10000000,
    reward: 1400000,
  },
  {
    id: "transfer_1",
    action: "transfer",
    title: "Tấm Lòng Nhỏ",
    description: "Chuyển tiền thành công 1 lần",
    target: 1,
    reward: 50000,
  },
  {
    id: "transfer_3",
    action: "transfer",
    title: "Người Hào Phóng",
    description: "Chuyển tiền thành công 3 lần",
    target: 3,
    reward: 120000,
  },
  {
    id: "transfer_5",
    action: "transfer",
    title: "Nhà Tài Trợ",
    description: "Chuyển tiền thành công 5 lần",
    target: 5,
    reward: 250000,
  },
  {
    id: "transfer_amount_200k",
    action: "transfer_amount",
    title: "Chia Sẻ",
    description: "Chuyển tổng 200,000 xu",
    target: 200000,
    reward: 80000,
  },
  {
    id: "transfer_amount_1m",
    action: "transfer_amount",
    title: "Mạnh Thường Quân",
    description: "Chuyển tổng 1,000,000 xu",
    target: 1000000,
    reward: 250000,
  },
  {
    id: "transfer_amount_3m",
    action: "transfer_amount",
    title: "Quỹ Cộng Đồng",
    description: "Chuyển tổng 3,000,000 xu",
    target: 3000000,
    reward: 600000,
  },
  {
    id: "transfer_amount_5m",
    action: "transfer_amount",
    title: "Ngân Khố Di Động",
    description: "Chuyển tổng 5,000,000 xu",
    target: 5000000,
    reward: 900000,
  },
  {
    id: "transfer_amount_8m",
    action: "transfer_amount",
    title: "Cá Voi Từ Thiện",
    description: "Chuyển tổng 8,000,000 xu",
    target: 8000000,
    reward: 1200000,
  },
  {
    id: "combo_worker",
    action: "work",
    title: "Ngày Dài Lao Động",
    description: "Làm việc 25 lần",
    target: 25,
    reward: 600000,
  },
  {
    id: "combo_gambler",
    action: "bet_count",
    title: "Con Nghiện Sòng",
    description: "Đặt cược 50 lần",
    target: 50,
    reward: 900000,
  },
  {
    id: "combo_crime",
    action: "rob_success",
    title: "Đêm Hỗn Loạn",
    description: "Cướp thành công 15 lần",
    target: 15,
    reward: 1200000,
  },
  {
    id: "daily_allrounder",
    action: "bet_amount",
    title: "Dân Chơi Toàn Diện",
    description: "Cược tổng 3,000,000 xu",
    target: 3000000,
    reward: 700000,
  },
];

const QUEST_MAP = new Map(QUEST_DEFINITIONS.map((quest) => [quest.id, quest]));

const QUEST_TIER_WEIGHTS = {
  easy: 60,
  medium: 30,
  hard: 9,
  rare: 1,
};

const QUEST_ACCEPT_LIMITS = {
  normal: 5,
  vip: 10,
};

function getQuestTier(quest) {
  if (quest?.tier === "easy") return "easy";
  if (quest?.tier === "medium") return "medium";
  if (quest?.tier === "hard") return "hard";
  if (quest?.tier === "rare") return "rare";

  const reward = Number(quest?.reward || 0);
  if (reward <= 150000) return "easy";
  if (reward <= 500000) return "medium";
  if (reward <= 1000000) return "hard";
  return "rare";
}

function getVNDateString(baseDate = new Date()) {
  const vn = new Date(baseDate.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().split("T")[0];
}

function getDBConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const db = config?.database;
    if (!db) return null;
    return {
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.name,
    };
  } catch {
    return null;
  }
}



function clampProgress(progress, target) {
  const numeric = Number(progress) || 0;
  if (numeric < 0) return 0;
  return Math.min(numeric, Number(target) || 0);
}

async function insertDailyRows(connection, userID, questDate, definitions) {
  if (!definitions || definitions.length === 0) return;

  const placeholders = definitions.map(() => "(?, ?, ?, 0, 0, 0)").join(", ");
  const params = [];

  definitions.forEach((quest) => {
    params.push(String(userID), questDate, quest.id);
  });

  await connection.execute(
    `INSERT OR IGNORE INTO quest_user_daily (psid, quest_date, quest_id, progress, accepted, claimed) VALUES ${placeholders}`,
    params,
  );
}

async function ensureUserDailyState(connection, userID, questDate) {
  const [existingRows] = await connection.execute(
    "SELECT quest_id, progress, accepted, claimed FROM quest_user_daily WHERE psid = ? AND quest_date = ?",
    [String(userID), questDate],
  );

  if (existingRows.length === 0) {
    await insertDailyRows(connection, userID, questDate, QUEST_DEFINITIONS);
  } else {
    const existingIDs = new Set(
      existingRows.map((row) => String(row.quest_id)),
    );
    const missing = QUEST_DEFINITIONS.filter(
      (quest) => !existingIDs.has(quest.id),
    );
    if (missing.length > 0) {
      await insertDailyRows(connection, userID, questDate, missing);
    }

    for (const row of existingRows) {
      const definition = QUEST_MAP.get(String(row.quest_id));
      if (!definition) continue;

      const nextProgress = clampProgress(row.progress, definition.target);
      const accepted = row.accepted ? 1 : 0;
      const claimed = row.claimed ? 1 : 0;

      if (
        nextProgress !== Number(row.progress) ||
        accepted !== Number(row.accepted) ||
        claimed !== Number(row.claimed)
      ) {
        await connection.execute(
          "UPDATE quest_user_daily SET progress = ?, accepted = ?, claimed = ? WHERE psid = ? AND quest_date = ? AND quest_id = ?",
          [
            nextProgress,
            accepted,
            claimed,
            String(userID),
            questDate,
            String(row.quest_id),
          ],
        );
      }
    }
  }
}

async function loadDailyQuestRows(connection, userID, questDate) {
  const [rows] = await connection.execute(
    "SELECT quest_id, progress, accepted, claimed FROM quest_user_daily WHERE psid = ? AND quest_date = ?",
    [String(userID), questDate],
  );
  return rows;
}

async function getUserQuestLimit(connection, userID, threadID = null) {
  let rows = [];
  if (threadID) {
    [rows] = await connection.execute(
      "SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ? LIMIT 1",
      [String(threadID), String(userID)],
    );
  } else {
    [rows] = await connection.execute(
      "SELECT vip_until FROM messenger_users WHERE psid = ? LIMIT 1",
      [String(userID)],
    );
  }

  const now = new Date();
  const vipUntil = rows[0]?.vip_until ? new Date(rows[0].vip_until) : null;
  const hasVip = !!(vipUntil && vipUntil > now);

  return {
    hasVip,
    maxAccepted: hasVip ? QUEST_ACCEPT_LIMITS.vip : QUEST_ACCEPT_LIMITS.normal,
  };
}

function buildQuestList(rows) {
  const rowMap = new Map(rows.map((row) => [String(row.quest_id), row]));

  return QUEST_DEFINITIONS.map((definition) => {
    const row = rowMap.get(definition.id) || {};
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      action: definition.action,
      tier: definition.tier || null,
      target: definition.target,
      reward: definition.reward,
      progress: clampProgress(row.progress || 0, definition.target),
      accepted: !!row.accepted,
      claimed: !!row.claimed,
    };
  });
}

async function getUserQuests(userID, threadID = null) {
  const questDate = getVNDateString();

  // Ensure quest table exists
  await execute(`
    CREATE TABLE IF NOT EXISTS quest_user_daily (
      psid VARCHAR(50) NOT NULL,
      quest_date DATE NOT NULL,
      quest_id VARCHAR(64) NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (psid, quest_date, quest_id)
    )
  `);

  // Ensure user daily state
  const connection = await getConnection();
  try {
    await ensureUserDailyState(connection, userID, questDate);
  } finally {
    connection.release();
  }

  // Load daily quest rows
  const rows = await execute(`
    SELECT quest_id, progress, accepted, claimed
    FROM quest_user_daily
    WHERE psid = ? AND quest_date = ?
  `, [userID, questDate]);

  // Get user quest limit
  let userRows;
  if (threadID) {
    userRows = await execute(`
      SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?
    `, [String(threadID), userID]);
  } else {
    userRows = await execute(`
      SELECT vip_until FROM messenger_users WHERE psid = ?
    `, [userID]);
  }

  const hasVip = userRows.length > 0 && userRows[0].vip_until && new Date(userRows[0].vip_until) > new Date();
  const maxAccepted = hasVip ? 5 : 3;
  const acceptedCount = rows.filter((row) => !!row.accepted).length;

  return {
    date: questDate,
    quests: buildQuestList(rows),
    acceptedCount,
    maxAccepted,
    remainingSlots: Math.max(0, maxAccepted - acceptedCount),
    hasVip,
  };
}

function recordAction(userID, action, amount = 1) {
  const increment = Number(amount) || 0;
  if (increment <= 0) return Promise.resolve(false);

  return (async () => {
    try {
      // Ensure quest table exists
      await execute(`
        CREATE TABLE IF NOT EXISTS quest_user_daily (
          psid VARCHAR(50) NOT NULL,
          quest_date DATE NOT NULL,
          quest_id VARCHAR(64) NOT NULL,
          progress BIGINT NOT NULL DEFAULT 0,
          accepted BOOLEAN NOT NULL DEFAULT FALSE,
          claimed BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (psid, quest_date, quest_id)
        )
      `);

      const questDate = getVNDateString();

      // Ensure user daily state
      const connection = await getConnection();
      try {
        await ensureUserDailyState(connection, userID, questDate);
      } finally {
        connection.release();
      }

      const questIDs = QUEST_DEFINITIONS.filter(
        (quest) => quest.action === action,
      ).map((quest) => quest.id);
      if (questIDs.length === 0) return false;

      for (const questID of questIDs) {
        const definition = QUEST_MAP.get(questID);
        if (!definition) continue;

        await execute(
          `UPDATE quest_user_daily
                   SET progress = MIN(?, progress + ?)
                   WHERE psid = ? AND quest_date = ? AND quest_id = ?
                     AND accepted = 1 AND claimed = 0`,
          [
            Number(definition.target),
            increment,
            String(userID),
            questDate,
            questID,
          ],
        );
      }

      return true;
    } catch (e) {
      return false;
    }
  })();
}

async function acceptQuests(userID, questIDs = [], threadID = null) {
  // Ensure quest table exists
  await execute(`
    CREATE TABLE IF NOT EXISTS quest_user_daily (
      psid VARCHAR(50) NOT NULL,
      quest_date DATE NOT NULL,
      quest_id VARCHAR(64) NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (psid, quest_date, quest_id)
    )
  `);

  const questDate = getVNDateString();

  // Ensure user daily state
  const connection = await getConnection();
  try {
    await ensureUserDailyState(connection, userID, questDate);
  } finally {
    connection.release();
  }

  // Load daily quest rows
  const rows = await execute(`
    SELECT quest_id, progress, accepted, claimed
    FROM quest_user_daily
    WHERE psid = ? AND quest_date = ?
  `, [userID, questDate]);

  // Get user quest limit
  let userRows;
  if (threadID) {
    userRows = await execute(`
      SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?
    `, [String(threadID), userID]);
  } else {
    userRows = await execute(`
      SELECT vip_until FROM messenger_users WHERE psid = ?
    `, [userID]);
  }

  const hasVip = userRows.length > 0 && userRows[0].vip_until && new Date(userRows[0].vip_until) > new Date();
  const maxAccepted = hasVip ? 5 : 3;
  const acceptedNow = rows.filter((row) => !!row.accepted).length;
  let remainingSlots = Math.max(0, maxAccepted - acceptedNow);

  const rowMap = new Map(rows.map((row) => [String(row.quest_id), row]));
  const idSet = new Set((questIDs || []).map((id) => String(id)));

  let acceptedCount = 0;
  let alreadyAcceptedCount = 0;
  let notFoundCount = 0;
  let overLimitCount = 0;
  const acceptedIDs = [];
  const alreadyAcceptedIDs = [];

  for (const questID of idSet) {
    const row = rowMap.get(questID);
    if (!row) {
      notFoundCount += 1;
      continue;
    }
    if (row.accepted) {
      alreadyAcceptedCount += 1;
      alreadyAcceptedIDs.push(questID);
      continue;
    }

    if (remainingSlots <= 0) {
      overLimitCount += 1;
      continue;
    }

    await execute(
      "UPDATE quest_user_daily SET accepted = 1 WHERE psid = ? AND quest_date = ? AND quest_id = ?",
      [String(userID), questDate, questID],
    );
    acceptedCount += 1;
    remainingSlots -= 1;
    acceptedIDs.push(questID);
  }

  return {
    acceptedCount,
    alreadyAcceptedCount,
    notFoundCount,
    overLimitCount,
    acceptedIDs,
    alreadyAcceptedIDs,
    maxAccepted,
    hasVip,
    acceptedTotal: acceptedNow + acceptedCount,
    remainingSlots,
  };
}

function pickWeightedTier(availableByTier) {
  const weightedTiers = Object.entries(QUEST_TIER_WEIGHTS).filter(
    ([tier]) => (availableByTier[tier] || []).length > 0,
  );

  if (weightedTiers.length === 0) return null;

  const totalWeight = weightedTiers.reduce(
    (sum, [, weight]) => sum + weight,
    0,
  );
  let roll = Math.random() * totalWeight;

  for (const [tier, weight] of weightedTiers) {
    roll -= weight;
    if (roll <= 0) return tier;
  }

  return weightedTiers[weightedTiers.length - 1][0];
}

async function acceptRandomQuest(userID, targetTier = null, threadID = null) {
  // Ensure quest table exists
  await execute(`
    CREATE TABLE IF NOT EXISTS quest_user_daily (
      psid VARCHAR(50) NOT NULL,
      quest_date DATE NOT NULL,
      quest_id VARCHAR(64) NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (psid, quest_date, quest_id)
    )
  `);

  const questDate = getVNDateString();

  // Ensure user daily state
  const connection = await getConnection();
  try {
    await ensureUserDailyState(connection, userID, questDate);
  } finally {
    connection.release();
  }

  // Load daily quest rows
  const rows = await execute(`
    SELECT quest_id, progress, accepted, claimed
    FROM quest_user_daily
    WHERE psid = ? AND quest_date = ?
  `, [userID, questDate]);

  // Get user quest limit
  let userRows;
  if (threadID) {
    userRows = await execute(`
      SELECT vip_until FROM messenger_users WHERE thread_id = ? AND psid = ?
    `, [String(threadID), userID]);
  } else {
    userRows = await execute(`
      SELECT vip_until FROM messenger_users WHERE psid = ?
    `, [userID]);
  }

  const hasVip = userRows.length > 0 && userRows[0].vip_until && new Date(userRows[0].vip_until) > new Date();
  const maxAccepted = hasVip ? 5 : 3;
  const acceptedCount = rows.filter((row) => !!row.accepted).length;
  const remainingSlots = Math.max(0, maxAccepted - acceptedCount);

  if (remainingSlots <= 0) {
    return {
      ok: false,
      reason: "limit_reached",
      hasVip,
      maxAccepted,
      acceptedCount,
      remainingSlots: 0,
    };
  }

  const rowMap = new Map(rows.map((row) => [String(row.quest_id), row]));
  const availableDefinitions = QUEST_DEFINITIONS.filter((quest) => {
    const row = rowMap.get(quest.id);
    return row && !row.accepted;
  });

  if (availableDefinitions.length === 0) {
    return {
      ok: false,
      reason: "no_available",
      hasVip,
      maxAccepted,
      acceptedCount,
      remainingSlots,
    };
  }

  const availableByTier = { easy: [], medium: [], hard: [], rare: [] };
  availableDefinitions.forEach((quest) => {
    const tier = getQuestTier(quest);
    if (availableByTier[tier]) availableByTier[tier].push(quest);
  });

  let selectedTier = null;
  if (targetTier) {
    if (!availableByTier[targetTier] || availableByTier[targetTier].length === 0) {
      return {
        ok: false,
        reason: "no_available_tier",
        requestedTier: targetTier,
        hasVip,
        maxAccepted,
        acceptedCount,
        remainingSlots,
      };
    }
    selectedTier = targetTier;
  } else {
    selectedTier = pickWeightedTier(availableByTier);
  }

  if (!selectedTier) {
    return {
      ok: false,
      reason: "no_available",
      hasVip,
      maxAccepted,
      acceptedCount,
      remainingSlots,
    };
  }

  const tierQuests = availableByTier[selectedTier];
  const randomIndex = Math.floor(Math.random() * tierQuests.length);
  const selectedQuest = tierQuests[randomIndex];

  await execute(
    "UPDATE quest_user_daily SET accepted = 1 WHERE psid = ? AND quest_date = ? AND quest_id = ?",
    [String(userID), questDate, selectedQuest.id],
  );

  return {
    ok: true,
    hasVip,
    maxAccepted,
    acceptedCount: acceptedCount + 1,
    remainingSlots: Math.max(0, remainingSlots - 1),
    selectedTier,
    weights: { ...QUEST_TIER_WEIGHTS },
    quest: {
      id: selectedQuest.id,
      title: selectedQuest.title,
      description: selectedQuest.description,
      action: selectedQuest.action,
      tier: selectedTier,
      target: selectedQuest.target,
      reward: selectedQuest.reward,
    },
  };
}

async function previewClaims(userID, questIDs = []) {
  // Ensure quest table exists
  await execute(`
    CREATE TABLE IF NOT EXISTS quest_user_daily (
      psid VARCHAR(50) NOT NULL,
      quest_date DATE NOT NULL,
      quest_id VARCHAR(64) NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (psid, quest_date, quest_id)
    )
  `);

  const questDate = getVNDateString();

  // Ensure user daily state
  const connection = await getConnection();
  try {
    await ensureUserDailyState(connection, userID, questDate);
  } finally {
    connection.release();
  }

  // Load daily quest rows
  const rows = await execute(`
    SELECT quest_id, progress, accepted, claimed
    FROM quest_user_daily
    WHERE psid = ? AND quest_date = ?
  `, [userID, questDate]);

  const rowMap = new Map(rows.map((row) => [String(row.quest_id), row]));
  const uniqueIDs = [...new Set((questIDs || []).map((id) => String(id)))];

  let totalReward = 0;
  let claimableCount = 0;
  let alreadyClaimedCount = 0;
  let notCompleteCount = 0;
  let notAcceptedCount = 0;
  let notFoundCount = 0;

  const claimableIDs = [];

  uniqueIDs.forEach((questID) => {
    const row = rowMap.get(questID);
    const definition = QUEST_MAP.get(questID);

    if (!row || !definition) {
      notFoundCount += 1;
      return;
    }
    if (!row.accepted) {
      notAcceptedCount += 1;
      return;
    }
    if (row.claimed) {
      alreadyClaimedCount += 1;
      return;
    }
    if (Number(row.progress) < Number(definition.target)) {
      notCompleteCount += 1;
      return;
    }

    claimableCount += 1;
    totalReward += Number(definition.reward) || 0;
    claimableIDs.push(definition.id);
  });

  return {
    claimableIDs,
    claimableCount,
    totalReward,
    alreadyClaimedCount,
    notCompleteCount,
    notAcceptedCount,
    notFoundCount,
  };
}

async function previewClaimAll(userID) {
  // Ensure quest table exists
  await execute(`
    CREATE TABLE IF NOT EXISTS quest_user_daily (
      psid VARCHAR(50) NOT NULL,
      quest_date DATE NOT NULL,
      quest_id VARCHAR(64) NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (psid, quest_date, quest_id)
    )
  `);

  const questDate = getVNDateString();

  // Ensure user daily state
  const connection = await getConnection();
  try {
    await ensureUserDailyState(connection, userID, questDate);
  } finally {
    connection.release();
  }

  // Load daily quest rows
  const rows = await execute(`
    SELECT quest_id, progress, accepted, claimed
    FROM quest_user_daily
    WHERE psid = ? AND quest_date = ?
  `, [userID, questDate]);

  let totalReward = 0;
  const claimableIDs = [];

  rows.forEach((row) => {
    const definition = QUEST_MAP.get(String(row.quest_id));
    if (!definition) return;

    if (
      row.accepted &&
      !row.claimed &&
      Number(row.progress) >= Number(definition.target)
    ) {
      claimableIDs.push(definition.id);
      totalReward += Number(definition.reward) || 0;
    }
  });

  return {
    claimableIDs,
    claimableCount: claimableIDs.length,
    totalReward,
  };
}

async function markQuestsClaimed(userID, questIDs = []) {
  // Ensure quest table exists
  await execute(`
    CREATE TABLE IF NOT EXISTS quest_user_daily (
      psid VARCHAR(50) NOT NULL,
      quest_date DATE NOT NULL,
      quest_id VARCHAR(64) NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (psid, quest_date, quest_id)
    )
  `);

  const questDate = getVNDateString();

  // Ensure user daily state
  const connection = await getConnection();
  try {
    await ensureUserDailyState(connection, userID, questDate);
  } finally {
    connection.release();
  }

  const idSet = new Set((questIDs || []).map((id) => String(id)));

  let markedCount = 0;
  let totalReward = 0;
  const markedIDs = [];

  for (const questID of idSet) {
    const definition = QUEST_MAP.get(questID);
    if (!definition) continue;

    const rows = await execute(
      "SELECT progress, accepted, claimed FROM quest_user_daily WHERE psid = ? AND quest_date = ? AND quest_id = ?",
      [String(userID), questDate, questID],
    );
    if (rows.length === 0) continue;

    const row = rows[0];
    if (
      !row.accepted ||
      row.claimed ||
      Number(row.progress) < Number(definition.target)
    )
      continue;

    await execute(
      "UPDATE quest_user_daily SET claimed = 1 WHERE psid = ? AND quest_date = ? AND quest_id = ?",
      [String(userID), questDate, questID],
    );
    markedCount += 1;
    totalReward += Number(definition.reward) || 0;
    markedIDs.push(questID);
  }

  return {
    markedCount,
    totalReward,
    markedIDs,
  };
}

async function claimQuest(userID, questID) {
  const preview = await previewClaims(userID, [questID]);
  if (preview.notFoundCount > 0) return { ok: false, reason: "not_found" };
  if (preview.notAcceptedCount > 0)
    return { ok: false, reason: "not_accepted" };
  if (preview.alreadyClaimedCount > 0)
    return { ok: false, reason: "already_claimed" };
  if (preview.notCompleteCount > 0 || preview.claimableCount === 0)
    return { ok: false, reason: "not_complete" };

  const marked = await markQuestsClaimed(userID, [questID]);
  if (marked.markedCount === 0) return { ok: false, reason: "not_complete" };

  return {
    ok: true,
    reward: marked.totalReward,
    quest: { id: questID },
  };
}

async function claimAllAvailable(userID) {
  const preview = await previewClaimAll(userID);
  if (preview.claimableCount === 0) return { totalReward: 0, claimedCount: 0 };

  const marked = await markQuestsClaimed(userID, preview.claimableIDs);
  return {
    totalReward: marked.totalReward,
    claimedCount: marked.markedCount,
  };
}

module.exports = {
  getUserQuests,
  acceptQuests,
  acceptRandomQuest,
  recordAction,
  previewClaims,
  previewClaimAll,
  markQuestsClaimed,
  claimQuest,
  claimAllAvailable,
  QUEST_DEFINITIONS,
  QUEST_TIER_WEIGHTS,
  QUEST_ACCEPT_LIMITS,
};
