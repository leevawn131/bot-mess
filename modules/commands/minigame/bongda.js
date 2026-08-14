const axios = require("axios");
const { execute, getConnection, ensureUserAccount } = require("../../utils/database");
const { checkCooldown } = require("../../utils/cooldown");
const { parseMoneyAmount } = require("../../utils/parseMoney");
const { getAdminBotUIDs } = require("../../utils/checkPermission");

// Hạn khóa cược rung (live bet): Sau phút 80
const LIVE_BET_MAX_MINUTE = 80;
// Thuế nhà cái khi thắng cược (5% trên lợi nhuận)
const TAX_RATE = 0.05;

// Các giải đấu bóng đá thực tế từ ESPN
const LEAGUE_IDS = ["eng.1", "uefa.champions", "fifa.world", "esp.1", "ita.1", "ger.1", "fra.1"];

// Danh sách đội bóng và giải đấu giả lập làm Fallback (nếu không có mạng)
const MOCK_LEAGUES = ["PREMIER LEAGUE", "WORLD CUP", "UEFA CHAMPIONS LEAGUE", "LA LIGA"];
const MOCK_TEAMS = [
  "Manchester City", "Real Madrid", "Liverpool", "Arsenal", "Bayern Munich",
  "PSG", "Barcelona", "Manchester United", "Chelsea", "Juventus",
  "Argentina", "Brazil", "Pháp", "Anh", "Đức", "Tây Ban Nha", "Bồ Đào Nha", "Ý", "Việt Nam", "Thái Lan"
];

// Hàm chuyển đổi American Odds sang Decimal Odds
function americanToDecimal(americanStr) {
  if (!americanStr) return 1.90;
  const val = parseInt(String(americanStr).replace("+", ""));
  if (isNaN(val)) return 1.90;
  if (val < 0) {
    return +(1 + 100 / Math.abs(val)).toFixed(2);
  } else {
    return +(1 + val / 100).toFixed(2);
  }
}

// Hàm format thời gian UTC sang Việt Nam (UTC+7)
function formatToVNTime(isoStr) {
  const d = new Date(isoStr);
  const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${vnTime.getUTCFullYear()}-${pad(vnTime.getUTCMonth() + 1)}-${pad(vnTime.getUTCDate())} ${pad(vnTime.getUTCHours())}:${pad(vnTime.getUTCMinutes())}:${pad(vnTime.getUTCSeconds())}`;
}

// Hàm chuyển đổi từ khóa viết tắt sang tên giải đấu tương ứng trong CSDL
function getLeagueSearchQuery(arg) {
  if (!arg) return "%";
  const clean = arg.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (clean === "wc" || clean === "worldcup" || clean === "world cup") {
    return "%World Cup%";
  }
  if (clean === "c1" || clean === "champions" || clean === "cpl") {
    return "%Champions%";
  }
  if (clean === "epl" || clean === "premier" || clean === "anh" || clean === "ngoai hang anh") {
    return "%Premier%";
  }
  if (clean === "laliga" || clean === "la liga") {
    return "%LALIGA%";
  }
  if (clean === "seriea" || clean === "serie a") {
    return "%Serie A%";
  }
  if (clean === "bundesliga") {
    return "%Bundesliga%";
  }
  if (clean === "ligue1" || clean === "ligue 1") {
    return "%Ligue 1%";
  }
  return `%${arg}%`;
}

// Khởi tạo bảng CSDL SQLite
async function initTables() {
  try {
    // 1. Trận đấu
    await execute(`
      CREATE TABLE IF NOT EXISTS bet_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT DEFAULT NULL,
        league_id TEXT DEFAULT NULL,
        league TEXT NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        match_time TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', -- 'open' (chưa đá), 'live' (đang đá/live cược), 'closed' (khóa cược), 'finished' (kết thúc), 'refunded' (hủy)
        result_home INTEGER DEFAULT NULL,
        result_away INTEGER DEFAULT NULL,
        first_scorer TEXT DEFAULT NULL, -- 'home', 'away', 'none'
        live_clock TEXT DEFAULT NULL, -- Phút đang đá (e.g. "65'")
        handicap REAL NOT NULL,
        ou REAL NOT NULL,
        odds_1 REAL NOT NULL, odds_2 REAL NOT NULL, odds_3 REAL NOT NULL,
        odds_4 REAL NOT NULL, odds_5 REAL NOT NULL,
        odds_6 REAL NOT NULL, odds_7 REAL NOT NULL,
        odds_8 REAL NOT NULL, odds_9 REAL NOT NULL, odds_10 REAL NOT NULL,
        odds_11 REAL NOT NULL, odds_12 REAL NOT NULL, odds_13 REAL NOT NULL,
        odds_14 REAL NOT NULL, odds_15 REAL NOT NULL, odds_16 REAL NOT NULL,
        odds_17 REAL NOT NULL, odds_18 REAL NOT NULL, odds_19 REAL NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    // Tạo Index duy nhất cho external_id trong SQLite
    await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_bet_matches_external_id ON bet_matches (external_id)");

    // Nâng cấp thêm các cột nếu chạy trên database cũ
    try {
      await execute("ALTER TABLE bet_matches ADD COLUMN external_id TEXT DEFAULT NULL");
    } catch(e){}
    try {
      await execute("ALTER TABLE bet_matches ADD COLUMN league_id TEXT DEFAULT NULL");
    } catch(e){}
    try {
      await execute("ALTER TABLE bet_matches ADD COLUMN live_clock TEXT DEFAULT NULL");
    } catch(e){}
    try {
      await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_bet_matches_external_id ON bet_matches (external_id)");
    } catch(e){}

    // 2. Vé cược
    await execute(`
      CREATE TABLE IF NOT EXISTS bet_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        thread_id TEXT NOT NULL,
        psid TEXT NOT NULL,
        username TEXT NOT NULL,
        chosen_option INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        odds REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payout INTEGER DEFAULT 0,
        message_id TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(match_id, psid, chosen_option)
      )
    `);

    // 3. Người chơi
    await execute(`
      CREATE TABLE IF NOT EXISTS bet_players (
        psid TEXT PRIMARY KEY,
        total_bets INTEGER DEFAULT 0,
        won_bets INTEGER DEFAULT 0,
        lost_bets INTEGER DEFAULT 0,
        total_profit INTEGER DEFAULT 0,
        current_streak INTEGER DEFAULT 0,
        max_streak INTEGER DEFAULT 0,
        total_wagered INTEGER DEFAULT 0
      )
    `);

    // 4. Logs giao dịch
    await execute(`
      CREATE TABLE IF NOT EXISTS bet_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        psid TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    // Di cư cấu trúc bet_tickets nếu đang dùng ràng buộc cũ UNIQUE(match_id, psid)
    try {
      const [{ sql }] = await execute("SELECT sql FROM sqlite_schema WHERE name = 'bet_tickets'");
      if (sql && sql.includes("UNIQUE(match_id, psid)") && !sql.includes("UNIQUE(match_id, psid, chosen_option)")) {
        console.log("[Cá độ Di cư] Phát hiện cấu trúc UNIQUE(match_id, psid) cũ. Đang nâng cấp lên UNIQUE(match_id, psid, chosen_option)...");
        await execute("ALTER TABLE bet_tickets RENAME TO bet_tickets_old");
        await execute(`
          CREATE TABLE bet_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            thread_id TEXT NOT NULL,
            psid TEXT NOT NULL,
            username TEXT NOT NULL,
            chosen_option INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            odds REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            payout INTEGER DEFAULT 0,
            message_id TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE(match_id, psid, chosen_option)
          )
        `);
        await execute(`
          INSERT INTO bet_tickets (id, match_id, thread_id, psid, username, chosen_option, amount, odds, status, payout, message_id, created_at)
          SELECT id, match_id, thread_id, psid, username, chosen_option, amount, odds, status, payout, message_id, created_at FROM bet_tickets_old
        `);
        await execute("DROP TABLE bet_tickets_old");
        console.log("[Cá độ Di cư] Nâng cấp bảng bet_tickets thành công!");
      }
    } catch (e) {
      // Bỏ qua nếu lỗi hoặc bảng chưa tồn tại
    }
  } catch (err) {
    console.error("[Cá độ] Lỗi khởi tạo cơ sở dữ liệu:", err);
  }
}

// Gọi khởi tạo bảng khi nạp module
initTables().catch(() => {});

// Tên hiển thị của lựa chọn kèo
function getOptionName(optionNum, homeTeam, awayTeam, handicapVal, ouVal) {
  const handicapText = handicapVal < 0 
    ? `${homeTeam} chấp ${Math.abs(handicapVal)}` 
    : (handicapVal > 0 ? `${awayTeam} chấp ${handicapVal}` : "Đồng banh");
  switch (optionNum) {
    case 1: return `${homeTeam} thắng`;
    case 2: return "Hòa (1X2)";
    case 3: return `${awayTeam} thắng`;
    case 4: return `${homeTeam} (${handicapText})`;
    case 5: return `${awayTeam} (${handicapText})`;
    case 6: return `Tài ${ouVal} bàn thắng`;
    case 7: return `Xỉu ${ouVal} bàn thắng`;
    case 8: return `${homeTeam} ghi bàn đầu`;
    case 9: return "Không bàn thắng (0-0)";
    case 10: return `${awayTeam} ghi bàn đầu`;
    case 11: return "Tỉ số 1-0";
    case 12: return "Tỉ số 2-0";
    case 13: return "Tỉ số 2-1";
    case 14: return "Tỉ số 0-0";
    case 15: return "Tỉ số 1-1";
    case 16: return "Tỉ số 0-1";
    case 17: return "Tỉ số 0-2";
    case 18: return "Tỉ số 1-2";
    case 19: return "Tỉ số khác";
    default: return "Chưa xác định";
  }
}

// Hàm điều chỉnh Odds động dựa trên Tỉ số và Phút (dành cho giả lập Live Match)
function calculateLiveOdds(baseOdds, homeScore, awayScore, elapsedMinutes, option) {
  const timeFactor = elapsedMinutes / 90;
  const goalDiff = homeScore - awayScore;

  switch (option) {
    // 1X2
    case 1:
      if (goalDiff > 0) return Math.max(1.01, +(1.40 - timeFactor * 0.39).toFixed(2));
      if (goalDiff < 0) return +(baseOdds * (1 + timeFactor * 5)).toFixed(2);
      return +(baseOdds * (1 + timeFactor * 1.5)).toFixed(2);
    case 2:
      if (goalDiff === 0) return Math.max(1.05, +(3.00 - timeFactor * 1.95).toFixed(2));
      return +(baseOdds * (1 + timeFactor * 4)).toFixed(2);
    case 3:
      if (goalDiff < 0) return Math.max(1.01, +(1.40 - timeFactor * 0.39).toFixed(2));
      if (goalDiff > 0) return +(baseOdds * (1 + timeFactor * 5)).toFixed(2);
      return +(baseOdds * (1 + timeFactor * 1.5)).toFixed(2);

    // Over/Under 2.5
    case 6:
      const totalGoals = homeScore + awayScore;
      if (totalGoals >= 3) return 1.01;
      return +(baseOdds * (1 + timeFactor * 8)).toFixed(2);
    case 7:
      const total = homeScore + awayScore;
      if (total >= 3) return 99.0;
      return Math.max(1.01, +(1.80 - timeFactor * 0.79).toFixed(2));

    default:
      return baseOdds;
  }
}

// Hàm Fallback tự sinh trận đấu giả lập (nếu offline hoặc API lỗi)
async function generateMockMatches(count = 3) {
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const league = MOCK_LEAGUES[Math.floor(Math.random() * MOCK_LEAGUES.length)];
    let home = MOCK_TEAMS[Math.floor(Math.random() * MOCK_TEAMS.length)];
    let away = MOCK_TEAMS[Math.floor(Math.random() * MOCK_TEAMS.length)];
    while (home === away) {
      away = MOCK_TEAMS[Math.floor(Math.random() * MOCK_TEAMS.length)];
    }

    let startMinutes = 30;
    let status = "open";
    let liveClock = null;
    let resultHome = null;
    let resultAway = null;

    if (i === 0) {
      startMinutes = -10;
      status = "live";
      liveClock = "10'";
      resultHome = 0;
      resultAway = 0;
    } else if (i === 2) {
      startMinutes = 120;
    }
    const matchTime = new Date(now.getTime() + startMinutes * 60 * 1000);

    const handicapOptions = [-1.5, -1.25, -1.0, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5];
    const handicap = handicapOptions[Math.floor(Math.random() * handicapOptions.length)];
    
    const ouOptions = [1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5];
    const ou = ouOptions[Math.floor(Math.random() * ouOptions.length)];

    const odds_1 = +(1.40 + Math.random() * 1.5).toFixed(2);
    const odds_3 = +(1.40 + Math.random() * 2.5).toFixed(2);
    const odds_2 = +(3.00 + Math.random() * 1.5).toFixed(2);

    const odds_4 = +(1.80 + Math.random() * 0.25).toFixed(2);
    const odds_5 = +(1.80 + Math.random() * 0.25).toFixed(2);

    const odds_6 = +(1.80 + Math.random() * 0.25).toFixed(2);
    const odds_7 = +(1.80 + Math.random() * 0.25).toFixed(2);

    const odds_8 = +(1.50 + Math.random() * 1.0).toFixed(2);
    const odds_9 = +(6.00 + Math.random() * 6.0).toFixed(2);
    const odds_10 = +(1.80 + Math.random() * 1.2).toFixed(2);

    const odds_11 = +(6.00 + Math.random() * 4).toFixed(2);
    const odds_12 = +(8.00 + Math.random() * 6).toFixed(2);
    const odds_13 = +(7.50 + Math.random() * 5).toFixed(2);
    const odds_14 = +(7.00 + Math.random() * 7).toFixed(2);
    const odds_15 = +(5.50 + Math.random() * 4).toFixed(2);
    const odds_16 = +(7.00 + Math.random() * 5).toFixed(2);
    const odds_17 = +(9.00 + Math.random() * 8).toFixed(2);
    const odds_18 = +(8.50 + Math.random() * 7).toFixed(2);
    const odds_19 = 5.0;

    const pad = (n) => String(n).padStart(2, "0");
    const timeStr = `${matchTime.getFullYear()}-${pad(matchTime.getMonth() + 1)}-${pad(matchTime.getDate())} ${pad(matchTime.getHours())}:${pad(matchTime.getMinutes())}:${pad(matchTime.getSeconds())}`;

    const extId = `mock_${Date.now()}_${i}`;

    await execute(`
      INSERT INTO bet_matches (
        external_id, league, home_team, away_team, match_time, status, result_home, result_away, live_clock, handicap, ou,
        odds_1, odds_2, odds_3, odds_4, odds_5, odds_6, odds_7, odds_8, odds_9, odds_10,
        odds_11, odds_12, odds_13, odds_14, odds_15, odds_16, odds_17, odds_18, odds_19
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      extId, league, home, away, timeStr, status, resultHome, resultAway, liveClock, handicap, ou,
      odds_1, odds_2, odds_3, odds_4, odds_5, odds_6, odds_7, odds_8, odds_9, odds_10,
      odds_11, odds_12, odds_13, odds_14, odds_15, odds_16, odds_17, odds_18, odds_19
    ]);
  }
}

// Giả lập cập nhật tiến trình của trận giả lập (Tăng phút, ghi bàn, cập nhật odds)
async function updateMockMatchesLive(api) {
  const matches = await execute("SELECT * FROM bet_matches WHERE external_id LIKE 'mock_%' AND status IN ('open', 'live')");
  const now = new Date();

  for (const match of matches) {
    const matchDate = new Date(match.match_time);
    const timeElapsedMs = now.getTime() - matchDate.getTime();
    const elapsedMinutes = Math.floor(timeElapsedMs / (60 * 1000));

    if (elapsedMinutes >= 90) {
      const finalHome = match.result_home !== null ? match.result_home : Math.floor(Math.random() * 3);
      const finalAway = match.result_away !== null ? match.result_away : Math.floor(Math.random() * 3);
      let firstScorer = "none";
      if (finalHome > 0 || finalAway > 0) {
        firstScorer = Math.random() > 0.5 ? "home" : "away";
      }
      await settleMatch(api, match, finalHome, finalAway, firstScorer);
      console.log(`[Cá độ Fallback] Đã tự động kết thúc trận đấu giả lập ID: ${match.id} (Tỉ số: ${finalHome}-${finalAway}).`);
    } 
    else if (elapsedMinutes >= 0) {
      const currentHome = match.result_home !== null ? match.result_home : 0;
      const currentAway = match.result_away !== null ? match.result_away : 0;
      
      let nextHome = currentHome;
      let nextAway = currentAway;

      if (Math.random() < 0.06) nextHome++;
      if (Math.random() < 0.06) nextAway++;

      const newClock = `${elapsedMinutes}'`;
      const isPastLimit = elapsedMinutes > LIVE_BET_MAX_MINUTE;
      const nextStatus = isPastLimit ? "closed" : "live";

      const odds_1 = calculateLiveOdds(match.odds_1, nextHome, nextAway, elapsedMinutes, 1);
      const odds_2 = calculateLiveOdds(match.odds_2, nextHome, nextAway, elapsedMinutes, 2);
      const odds_3 = calculateLiveOdds(match.odds_3, nextHome, nextAway, elapsedMinutes, 3);
      const odds_6 = calculateLiveOdds(match.odds_6, nextHome, nextAway, elapsedMinutes, 6);
      const odds_7 = calculateLiveOdds(match.odds_7, nextHome, nextAway, elapsedMinutes, 7);

      await execute(`
        UPDATE bet_matches 
        SET status = ?, result_home = ?, result_away = ?, live_clock = ?,
            odds_1 = ?, odds_2 = ?, odds_3 = ?, odds_6 = ?, odds_7 = ?
        WHERE id = ?
      `, [nextStatus, nextHome, nextAway, newClock, odds_1, odds_2, odds_3, odds_6, odds_7, match.id]);
    }
  }
}

// Tự động kiểm tra và quyết toán kết quả các trận đấu cũ đang bị kẹt trạng thái open/live
async function syncPastMatches(api) {
  const pastMatches = await execute(`
    SELECT * FROM bet_matches 
    WHERE status IN ('open', 'live') 
      AND external_id IS NOT NULL 
      AND external_id NOT LIKE 'mock_%'
  `);

  const LEAGUE_MAPPINGS = {
    "English Premier League": "eng.1",
    "UEFA Champions League": "uefa.champions",
    "FIFA World Cup": "fifa.world",
    "Spanish LALIGA": "esp.1",
    "Italian Serie A": "ita.1",
    "German Bundesliga": "ger.1",
    "French Ligue 1": "fra.1"
  };

  const now = new Date();

  for (const match of pastMatches) {
    try {
      // Đổi định dạng ngày giờ bắt đầu để so sánh
      const matchDate = new Date(match.match_time.replace(" ", "T") + "+07:00");
      if (matchDate > now) continue; // Chưa đá, bỏ qua check dọn dẹp

      const leagueId = match.league_id || LEAGUE_MAPPINGS[match.league] || "fifa.world";
      
      const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueId}/summary?event=${match.external_id}`, {
        timeout: 5000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      const data = response.data;
      const header = data.header;
      if (!header || !header.competitions || header.competitions.length === 0) continue;

      const comp = header.competitions[0];
      const state = comp.status && comp.status.type && comp.status.type.state;
      const competitors = comp.competitors || [];
      const homeComp = competitors.find(c => c.homeAway === "home");
      const awayComp = competitors.find(c => c.homeAway === "away");
      if (!homeComp || !awayComp) continue;

      const liveClock = comp.status && comp.status.type && comp.status.type.detail;
      const currentMinutes = comp.status && comp.status.clock;

      if (state === "in") {
        const liveHomeScore = parseInt(homeComp.score || 0);
        const liveAwayScore = parseInt(awayComp.score || 0);
        
        let nextStatus = "live";
        if (currentMinutes && currentMinutes > LIVE_BET_MAX_MINUTE) {
          nextStatus = "closed";
        }

        await execute(`
          UPDATE bet_matches 
          SET status = ?, result_home = ?, result_away = ?, live_clock = ?
          WHERE id = ?
        `, [nextStatus, liveHomeScore, liveAwayScore, liveClock || "Đang đá", match.id]);
      } 
      else if (state === "post") {
        const resultHome = parseInt(homeComp.score);
        const resultAway = parseInt(awayComp.score);

        if (!isNaN(resultHome) && !isNaN(resultAway)) {
          let firstScorer = "none";
          if (resultHome > 0 && resultAway === 0) {
            firstScorer = "home";
          } else if (resultHome === 0 && resultAway > 0) {
            firstScorer = "away";
          } else if (resultHome > 0 && resultAway > 0) {
            firstScorer = Math.random() > 0.5 ? "home" : "away";
          }

          await settleMatch(api, match, resultHome, resultAway, firstScorer);
          console.log(`[Cá độ Tự động Dọn dẹp] Đã settle thành công trận đấu cũ bị kẹt ID: ${match.id} (${match.home_team} vs ${match.away_team})`);
        }
      }
    } catch (e) {
      console.error(`[Cá độ Dọn dẹp] Lỗi cập nhật trận đấu ID ${match.id}:`, e.message);
    }
  }
}

// Đồng bộ các trận đấu thực tế và odds từ ESPN scoreboard API
async function syncRealMatches(api) {
  const now = new Date();

  // Chạy giả lập live cho các trận mock trước
  await updateMockMatchesLive(api);

  // Tự động kiểm tra và dọn dẹp/quyết toán các trận đấu trong quá khứ bị kẹt
  try {
    await syncPastMatches(api);
  } catch (err) {
    console.error("[Cá độ Dọn dẹp] Lỗi chạy tác vụ dọn dẹp trận cũ:", err.message);
  }

  for (const leagueId of LEAGUE_IDS) {
    try {
      const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueId}/scoreboard`, {
        timeout: 5000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      const data = response.data;
      if (!data || !data.events || data.events.length === 0) continue;

      for (const event of data.events) {
        const extId = String(event.id);
        const competition = event.competitions && event.competitions[0];
        if (!competition) continue;

        const competitors = competition.competitors || [];
        const homeComp = competitors.find(c => c.homeAway === "home");
        const awayComp = competitors.find(c => c.homeAway === "away");
        if (!homeComp || !awayComp) continue;

        const homeTeam = homeComp.team.displayName;
        const awayTeam = awayComp.team.displayName;
        const matchTimeISO = event.date;
        const matchDate = new Date(matchTimeISO);

        const leagueName = data.leagues && data.leagues[0] ? data.leagues[0].name : "FOOTBALL MATCH";
        const state = event.status.type.state; // "pre" | "in" | "post"

        // Kiểm tra trận đấu trong CSDL
        const [existing] = await execute("SELECT * FROM bet_matches WHERE external_id = ?", [extId]);

        if (!existing) {
          // Trận mới: Nhận cả trận sắp đá (pre) và trận đang diễn ra (in)
          if ((state === "pre" && matchDate > now) || state === "in") {
            let handicap = 0;
            let ou = 2.5;

            let odds_1 = 1.90, odds_2 = 3.20, odds_3 = 1.90;
            let odds_4 = 1.90, odds_5 = 1.90;
            let odds_6 = 1.90, odds_7 = 1.90;

            const oddsObj = competition.odds && competition.odds[0];
            if (oddsObj) {
              if (oddsObj.overUnder) ou = parseFloat(oddsObj.overUnder);
              if (oddsObj.pointSpread && oddsObj.pointSpread.home && oddsObj.pointSpread.home.close) {
                handicap = parseFloat(oddsObj.pointSpread.home.close.line);
              }
              
              if (oddsObj.moneyline) {
                if (oddsObj.moneyline.home && oddsObj.moneyline.home.close) {
                  odds_1 = americanToDecimal(oddsObj.moneyline.home.close.odds);
                }
                if (oddsObj.moneyline.draw && oddsObj.moneyline.draw.close) {
                  odds_2 = americanToDecimal(oddsObj.moneyline.draw.close.odds);
                }
                if (oddsObj.moneyline.away && oddsObj.moneyline.away.close) {
                  odds_3 = americanToDecimal(oddsObj.moneyline.away.close.odds);
                }
              }

              if (oddsObj.pointSpread) {
                if (oddsObj.pointSpread.home && oddsObj.pointSpread.home.close) {
                  odds_4 = americanToDecimal(oddsObj.pointSpread.home.close.odds);
                }
                if (oddsObj.pointSpread.away && oddsObj.pointSpread.away.close) {
                  odds_5 = americanToDecimal(oddsObj.pointSpread.away.close.odds);
                }
              }

              if (oddsObj.total) {
                if (oddsObj.total.over && oddsObj.total.over.close) {
                  odds_6 = americanToDecimal(oddsObj.total.over.close.odds);
                }
                if (oddsObj.total.under && oddsObj.total.under.close) {
                  odds_7 = americanToDecimal(oddsObj.total.under.close.odds);
                }
              }
            }

            const odds_8 = +(odds_1 * 0.9).toFixed(2);
            const odds_9 = +(odds_2 * 2.5).toFixed(2);
            const odds_10 = +(odds_3 * 0.9).toFixed(2);

            const odds_11 = +(odds_1 * 4.0).toFixed(2);
            const odds_12 = +(odds_1 * 5.0).toFixed(2);
            const odds_13 = +(odds_1 * 4.5).toFixed(2);
            const odds_14 = +(odds_2 * 2.5).toFixed(2);
            const odds_15 = +(odds_2 * 1.8).toFixed(2);
            const odds_16 = +(odds_3 * 4.0).toFixed(2);
            const odds_17 = +(odds_3 * 5.0).toFixed(2);
            const odds_18 = +(odds_3 * 4.5).toFixed(2);
            const odds_19 = 5.0;

            const formattedTime = formatToVNTime(matchTimeISO);
            
            const initialStatus = state === "in" ? "live" : "open";
            const initialHomeScore = state === "in" ? parseInt(homeComp.score || 0) : null;
            const initialAwayScore = state === "in" ? parseInt(awayComp.score || 0) : null;
            const liveClock = state === "in" ? (event.status.displayClock || "Đang đá") : null;

            await execute(`
              INSERT INTO bet_matches (
                external_id, league_id, league, home_team, away_team, match_time, status, result_home, result_away, live_clock, handicap, ou,
                odds_1, odds_2, odds_3, odds_4, odds_5, odds_6, odds_7, odds_8, odds_9, odds_10,
                odds_11, odds_12, odds_13, odds_14, odds_15, odds_16, odds_17, odds_18, odds_19
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              extId, leagueId, leagueName, homeTeam, awayTeam, formattedTime, initialStatus, initialHomeScore, initialAwayScore, liveClock, handicap, ou,
              odds_1, odds_2, odds_3, odds_4, odds_5, odds_6, odds_7, odds_8, odds_9, odds_10,
              odds_11, odds_12, odds_13, odds_14, odds_15, odds_16, odds_17, odds_18, odds_19
            ]);
            console.log(`[Cá độ] Đã đồng bộ trận đấu mới: ${homeTeam} vs ${awayTeam} (${leagueName})`);
          }
        } else {
          // Trận đấu đã có trong CSDL: Cập nhật tỉ số, Odds live và đồng hồ rung
          if (existing.status === "open" || existing.status === "live") {
            const currentClock = event.status.displayClock || "";
            const currentMinutes = parseInt(currentClock.replace("'", ""));

            if (state === "in") {
              const liveHomeScore = parseInt(homeComp.score || 0);
              const liveAwayScore = parseInt(awayComp.score || 0);

              // Khóa cược live sau phút 80
              let nextStatus = "live";
              if (!isNaN(currentMinutes) && currentMinutes > LIVE_BET_MAX_MINUTE) {
                nextStatus = "closed";
              }

              // Đồng bộ tỉ lệ cược live mới nhất từ API
              let odds_1 = existing.odds_1, odds_2 = existing.odds_2, odds_3 = existing.odds_3;
              let odds_6 = existing.odds_6, odds_7 = existing.odds_7;

              const oddsObj = competition.odds && competition.odds[0];
              if (oddsObj) {
                if (oddsObj.moneyline) {
                  if (oddsObj.moneyline.home && oddsObj.moneyline.home.close) odds_1 = americanToDecimal(oddsObj.moneyline.home.close.odds);
                  if (oddsObj.moneyline.draw && oddsObj.moneyline.draw.close) odds_2 = americanToDecimal(oddsObj.moneyline.draw.close.odds);
                  if (oddsObj.moneyline.away && oddsObj.moneyline.away.close) odds_3 = americanToDecimal(oddsObj.moneyline.away.close.odds);
                }
                if (oddsObj.total) {
                  if (oddsObj.total.over && oddsObj.total.over.close) odds_6 = americanToDecimal(oddsObj.total.over.close.odds);
                  if (oddsObj.total.under && oddsObj.total.under.close) odds_7 = americanToDecimal(oddsObj.total.under.close.odds);
                }
              }

              await execute(`
                UPDATE bet_matches 
                SET status = ?, result_home = ?, result_away = ?, live_clock = ?,
                    odds_1 = ?, odds_2 = ?, odds_3 = ?, odds_6 = ?, odds_7 = ?
                WHERE id = ?
              `, [nextStatus, liveHomeScore, liveAwayScore, currentClock, odds_1, odds_2, odds_3, odds_6, odds_7, existing.id]);
            } 
            else if (state === "post") {
              // Trận đấu kết thúc
              const resultHome = parseInt(homeComp.score);
              const resultAway = parseInt(awayComp.score);

              if (!isNaN(resultHome) && !isNaN(resultAway)) {
                let firstScorer = "none";
                if (resultHome > 0 && resultAway === 0) {
                  firstScorer = "home";
                } else if (resultHome === 0 && resultAway > 0) {
                  firstScorer = "away";
                } else if (resultHome > 0 && resultAway > 0) {
                  firstScorer = Math.random() > 0.5 ? "home" : "away";
                }

                await settleMatch(api, existing, resultHome, resultAway, firstScorer);
                console.log(`[Cá độ] Đã kết thúc và trả thưởng trận đấu ID: ${existing.id} (${homeTeam} ${resultHome}-${resultAway} ${awayTeam}).`);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`[Cá độ] Lỗi đồng bộ giải đấu ${leagueId}:`, e.message);
    }
  }

  // FALLBACK LOGIC
  const activeMatches = await execute("SELECT COUNT(*) as count FROM bet_matches WHERE status IN ('open', 'live')");
  if (activeMatches && activeMatches[0] && activeMatches[0].count === 0) {
    console.log("[Cá độ Fallback] Không có trận đấu thực tế nào đang mở cược. Tiến hành sinh trận giả lập...");
    await generateMockMatches(3);
  }
}

// Gửi bảng đấu chi tiết
function formatMatchBoard(match, config) {
  const handicapText = match.handicap < 0 
    ? `${match.home_team} chấp ${Math.abs(match.handicap)}` 
    : (match.handicap > 0 ? `${match.away_team} chấp ${match.handicap}` : "Đồng banh");

  let clockText = `🕒 Bắt đầu: ${match.match_time.slice(11, 16)} (Mở cược)`;
  let titleEmoji = "⚽";
  let scoreText = "";

  if (match.status === "live") {
    titleEmoji = "🔴";
    clockText = `⏱️ Live: Phút ${match.live_clock || "Đang đá"}`;
    scoreText = `👉 TỈ SỐ LIVE: ${match.home_team} ${match.result_home} 🆚 ${match.result_away} ${match.away_team}\n`;
  }

  return `${titleEmoji} [ID: ${match.id}] ${match.league}
⚔️ ${match.home_team} 🆚 ${match.away_team}
${clockText}
${scoreText}━━━━━━━━━━━━━━
🏆 KÈO TRẬN ĐẤU (1X2)
① ${match.home_team} thắng: ${match.odds_1.toFixed(2)}
② Hòa: ${match.odds_2.toFixed(2)}
③ ${match.away_team} thắng: ${match.odds_3.toFixed(2)}

🔮 KÈO CHẤP (Handicap: ${handicapText})
④ ${match.home_team} (Chủ): ${match.odds_4.toFixed(2)}
⑤ ${match.away_team} (Khách): ${match.odds_5.toFixed(2)}

⚽ TÀI XỈU BÀN THẮNG (Mốc: ${match.ou} bàn)
⑥ Tài (Over): ${match.odds_6.toFixed(2)}
⑦ Xỉu (Under): ${match.odds_7.toFixed(2)}

🎯 ĐỘI GHI BÀN ĐẦU TIÊN
⑧ ${match.home_team}: ${match.odds_8.toFixed(2)}
⑨ Không bàn thắng (0-0): ${match.odds_9.toFixed(2)}
⑩ ${match.away_team}: ${match.odds_10.toFixed(2)}

📊 ĐOÁN TỈ SỐ CHÍNH XÁC
⑪ 1-0: ${match.odds_11.toFixed(2)} | ⑫ 2-0: ${match.odds_12.toFixed(2)}
⑬ 2-1: ${match.odds_13.toFixed(2)} | ⑭ 0-0: ${match.odds_14.toFixed(2)}
⑮ 1-1: ${match.odds_15.toFixed(2)} | ⑯ 0-1: ${match.odds_16.toFixed(2)}
⑰ 0-2: ${match.odds_17.toFixed(2)} | ⑱ 1-2: ${match.odds_18.toFixed(2)}
⑲ Khác: ${match.odds_19.toFixed(2)}
━━━━━━━━━━━━━━
💰 Hướng dẫn đặt cược:
Reply tin nhắn này theo cú pháp: [Số_Kèo] [Số_Tiền]

💡 Ví dụ:
• 1 50k ( Cược cửa số ① 50.000$)
• 6 all ( Cược Tài tất tay)
• 4 half ( Cược cửa ④ nửa tiền ví)
• 11 25% ( Đoán tỉ số 1-0 bằng 25% số dư)

💡 Có thể đặt cược nhiều cửa khác nhau cho cùng một trận đấu!
Để hủy toàn bộ vé cược của bạn cho trận này, reply: "hủy" hoặc "cancel" trước khi đóng cược.`;
}

// Settle match bet calculators
function calculateBetOutcome(option, resultHome, resultAway, firstScorer, handicap, ou) {
  const totalGoals = resultHome + resultAway;
  
  switch (option) {
    // 1X2
    case 1: return resultHome > resultAway ? "won" : "lost";
    case 2: return resultHome === resultAway ? "won" : "lost";
    case 3: return resultHome < resultAway ? "won" : "lost";

    // Handicap
    case 4: {
      const diff = resultHome + handicap - resultAway;
      if (diff > 0.25) return "won";
      if (diff === 0.25) return "won_half";
      if (diff === 0) return "refunded";
      if (diff === -0.25) return "lost_half";
      return "lost";
    }
    case 5: {
      const diff = resultHome + handicap - resultAway;
      if (diff < -0.25) return "won";
      if (diff === -0.25) return "won_half";
      if (diff === 0) return "refunded";
      if (diff === 0.25) return "lost_half";
      return "lost";
    }

    // Over/Under
    case 6: {
      const diff = totalGoals - ou;
      if (diff > 0.25) return "won";
      if (diff === 0.25) return "won_half";
      if (diff === 0) return "refunded";
      if (diff === -0.25) return "lost_half";
      return "lost";
    }
    case 7: {
      const diff = totalGoals - ou;
      if (diff < -0.25) return "won";
      if (diff === -0.25) return "won_half";
      if (diff === 0) return "refunded";
      if (diff === 0.25) return "lost_half";
      return "lost";
    }

    // First Scorer
    case 8: return firstScorer === "home" ? "won" : "lost";
    case 9: return resultHome === 0 && resultAway === 0 ? "won" : "lost";
    case 10: return firstScorer === "away" ? "won" : "lost";

    // Correct Scores
    case 11: return resultHome === 1 && resultAway === 0 ? "won" : "lost";
    case 12: return resultHome === 2 && resultAway === 0 ? "won" : "lost";
    case 13: return resultHome === 2 && resultAway === 1 ? "won" : "lost";
    case 14: return resultHome === 0 && resultAway === 0 ? "won" : "lost";
    case 15: return resultHome === 1 && resultAway === 1 ? "won" : "lost";
    case 16: return resultHome === 0 && resultAway === 1 ? "won" : "lost";
    case 17: return resultHome === 0 && resultAway === 2 ? "won" : "lost";
    case 18: return resultHome === 1 && resultAway === 2 ? "won" : "lost";
    case 19: {
      const knownCS = [
        resultHome === 1 && resultAway === 0,
        resultHome === 2 && resultAway === 0,
        resultHome === 2 && resultAway === 1,
        resultHome === 0 && resultAway === 0,
        resultHome === 1 && resultAway === 1,
        resultHome === 0 && resultAway === 1,
        resultHome === 0 && resultAway === 2,
        resultHome === 1 && resultAway === 2
      ];
      return knownCS.some(c => c) ? "lost" : "won";
    }
    default: return "lost";
  }
}

// Settle Match Transaction
async function settleMatch(api, match, resultHome, resultAway, firstScorer) {
  await execute(`
    UPDATE bet_matches 
    SET status = 'finished', result_home = ?, result_away = ?, first_scorer = ?
    WHERE id = ? AND status != 'finished'
  `, [resultHome, resultAway, firstScorer, match.id]);

  const tickets = await execute("SELECT * FROM bet_tickets WHERE match_id = ? AND status = 'pending'", [match.id]);
  if (!tickets || tickets.length === 0) return;

  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    const threadMessages = {};

    for (const ticket of tickets) {
      const outcome = calculateBetOutcome(
        ticket.chosen_option,
        resultHome,
        resultAway,
        firstScorer,
        match.handicap,
        match.ou
      );

      let payout = 0;
      let profit = 0;

      if (outcome === "won") {
        const netWin = Math.floor(ticket.amount * (ticket.odds - 1));
        const tax = Math.floor(netWin * TAX_RATE);
        profit = netWin - tax;
        payout = ticket.amount + profit;
      } else if (outcome === "won_half") {
        const netWin = Math.floor(ticket.amount * (ticket.odds - 1) * 0.5);
        const tax = Math.floor(netWin * TAX_RATE);
        profit = netWin - tax;
        payout = ticket.amount + profit;
      } else if (outcome === "refunded") {
        payout = ticket.amount;
        profit = 0;
      } else if (outcome === "lost_half") {
        payout = Math.floor(ticket.amount * 0.5);
        profit = -payout;
      } else {
        payout = 0;
        profit = -ticket.amount;
      }

      if (payout > 0) {
        await connection.execute(
          "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
          [payout, ticket.thread_id, ticket.psid]
        );
      }

      await connection.execute(
        "UPDATE bet_tickets SET status = ?, payout = ? WHERE id = ?",
        [outcome, payout, ticket.id]
      );

      const [playerRows] = await connection.execute("SELECT * FROM bet_players WHERE psid = ?", [ticket.psid]);
      if (playerRows.length === 0) {
        await connection.execute(
          "INSERT INTO bet_players (psid, total_bets, won_bets, lost_bets, total_profit, current_streak, max_streak, total_wagered) VALUES (?, 0, 0, 0, 0, 0, 0, 0)",
          [ticket.psid]
        );
      }

      const isWin = outcome === "won" || outcome === "won_half";
      const isLose = outcome === "lost" || outcome === "lost_half";
      
      await connection.execute(`
        UPDATE bet_players
        SET total_bets = total_bets + 1,
            won_bets = won_bets + ?,
            lost_bets = lost_bets + ?,
            total_profit = total_profit + ?,
            total_wagered = total_wagered + ?,
            current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
            max_streak = CASE WHEN ? = 1 AND current_streak + 1 > max_streak THEN current_streak + 1 ELSE max_streak END
        WHERE psid = ?
      `, [
        isWin ? 1 : 0,
        isLose ? 1 : 0,
        profit,
        ticket.amount,
        isWin ? 1 : 0,
        isWin ? 1 : 0,
        ticket.psid
      ]);

      await connection.execute(
        "INSERT INTO bet_logs (psid, action, details) VALUES (?, 'settle', ?)",
        [ticket.psid, `Settle match ${match.id}, option ${ticket.chosen_option}, outcome ${outcome}, payout ${payout}`]
      );

      if (!threadMessages[ticket.thread_id]) {
        threadMessages[ticket.thread_id] = { wins: [], losses: [], refunds: [] };
      }

      const optName = getOptionName(ticket.chosen_option, match.home_team, match.away_team, match.handicap, match.ou);
      const detailStr = `• @${ticket.username}: ${ticket.amount.toLocaleString('vi-VN')}$ cược cửa "${optName}" (Odds ${ticket.odds.toFixed(2)})`;

      if (isWin) {
        threadMessages[ticket.thread_id].wins.push(`${detailStr} -> Nhận +${payout.toLocaleString('vi-VN')}$ (${outcome === "won_half" ? "Thắng nửa" : "Thắng cả"})`);
      } else if (isLose) {
        threadMessages[ticket.thread_id].losses.push(`${detailStr} -> Mất ${outcome === "lost_half" ? "nửa tiền (-" + (ticket.amount/2).toLocaleString('vi-VN') + "$)" : "hết tiền"}`);
      } else {
        threadMessages[ticket.thread_id].refunds.push(`${detailStr} -> Hoàn tiền cược (+${ticket.amount.toLocaleString('vi-VN')}$)`);
      }
    }

    await connection.commit();

    for (const threadId of Object.keys(threadMessages)) {
      const data = threadMessages[threadId];
      let msg = `🏁 KẾT QUẢ TRẬN ĐẤU [ID: ${match.id}]
🏆 ${match.league}
👉 ${match.home_team} ${resultHome} 🆚 ${resultAway} ${match.away_team}
🎯 Đội ghi bàn đầu: ${firstScorer === "home" ? match.home_team : (firstScorer === "away" ? match.away_team : "Không có")}
━━━━━━━━━━━━━━\n`;

      if (data.wins.length > 0) {
        msg += `🎉 THẮNG CƯỢC:\n${data.wins.join("\n")}\n\n`;
      }
      if (data.losses.length > 0) {
        msg += `💀 THUA CƯỢC:\n${data.losses.join("\n")}\n\n`;
      }
      if (data.refunds.length > 0) {
        msg += `🤝 HOÀN TIỀN:\n${data.refunds.join("\n")}\n`;
      }
      msg += `━━━━━━━━━━━━━━\nSố tiền thắng/thua đã được cộng/trừ trực tiếp vào tài khoản ví của bạn!`;

      api.sendMessage(msg, threadId);
    }

  } catch (err) {
    await connection.rollback();
    console.error("[Cá độ] Lỗi xử lý giao dịch Settle:", err);
  } finally {
    connection.release();
  }
}

// BỘ LẬP LỊCH TỰ ĐỘNG CHẠY NGẦM (CẬP NHẬT 3 PHÚT / 1 LẦN)
function startBetScheduler(api) {
  if (global.betSyncInterval) clearInterval(global.betSyncInterval);
  global.betSyncInterval = setInterval(async () => {
    try {
      await syncRealMatches(api);
    } catch (e) {
      console.error("[Cá độ Scheduler] Lỗi tác vụ lập lịch 3 phút:", e);
    }
  }, 3 * 60 * 1000);

  // Chạy ngay lập tức khi khởi tạo
  syncRealMatches(api).catch(e => console.error("[Cá độ Scheduler] Lỗi đồng bộ khởi chạy:", e));
}

let schedulerStarted = false;

module.exports = {
  name: "bongda",
  aliases: ["wc", "worldcup", "cado"],
  description: "Hệ thống cá độ bóng đá thực tế & RUNG (Live Bet) trong trận tự động cập nhật tỉ lệ 3 phút/lần.",
  usage: `\n• /bongda -> Xem các trận đấu đang mở cược (Pre-match & RUNG LIVE)\n• /bongda profile -> Xem tài khoản, ROI, chuỗi thắng & thành tựu\n• /bongda top -> Xem bảng xếp hạng các đại gia cá độ\n• Reply tin nhắn trận đấu: [Mã_Số_Kèo] [Số_Tiền] để đặt cược\n• Reply tin nhắn trận đấu: "hủy" hoặc "cancel" để hủy cược và hoàn tiền.`,

  execute: async ({ api, event, args, config }) => {
    const { threadID, senderID, messageID } = event;

    if (!schedulerStarted) {
      startBetScheduler(api);
      schedulerStarted = true;
    }

    const subCommand = args[0]?.toLowerCase();

    // 1. XEM PROFILE CÁ CƯỢC
    if (subCommand === "profile" || subCommand === "bet") {
      try {
        const [playerRows] = await execute("SELECT * FROM bet_players WHERE psid = ?", [senderID]);
        const [userRows] = await execute("SELECT credits, name FROM messenger_users WHERE thread_id = ? AND psid = ?", [String(threadID), senderID]);
        
        let credits = 10000;
        let uName = "Người dùng";
        if (userRows.length > 0) {
          credits = userRows[0].credits;
          uName = userRows[0].name;
        }

        const stats = playerRows[0] || { total_bets: 0, won_bets: 0, lost_bets: 0, total_profit: 0, current_streak: 0, max_streak: 0, total_wagered: 0 };
        const winRate = stats.total_bets > 0 ? ((stats.won_bets / stats.total_bets) * 100).toFixed(1) : "0.0";
        const roi = stats.total_wagered > 0 ? ((stats.total_profit / stats.total_wagered) * 100).toFixed(1) : "0.0";

        const achievements = [];
        if (stats.won_bets >= 10) achievements.push("🏆 Thần Bài Tập Sự (Thắng 10 vé)");
        if (stats.won_bets >= 100) achievements.push("👑 Vua Cờ Bạc (Thắng 100 vé)");
        if (stats.total_bets >= 100) achievements.push("👟 Chiến Binh Sân Cỏ (Cược 100 trận)");
        if (stats.max_streak >= 20) achievements.push("🔥 Tiên Tri Vũ Trụ (Thắng liên tiếp 20 trận)");

        const msg = `👤 THÔNG TIN CÁ CƯỢC: @${uName}
━━━━━━━━━━━━━━
💰 Số dư hiện tại: ${credits.toLocaleString('vi-VN')}$
🎫 Số vé đã đặt: ${stats.total_bets} trận
📈 Tỷ lệ thắng: ${winRate}% (${stats.won_bets} thắng / ${stats.lost_bets} thua)
💵 Tổng lợi nhuận: ${stats.total_profit >= 0 ? "+" : ""}${stats.total_profit.toLocaleString('vi-VN')}$
🔥 Chuỗi thắng hiện tại: ${stats.current_streak} (Kỷ lục: ${stats.max_streak})
📊 Chỉ số ROI: ${roi}%

🎖️ THÀNH TỰU:
${achievements.length > 0 ? achievements.map(a => `• ${a}`).join("\n") : "• Chưa đạt thành tựu nào, hãy tiếp tục đặt cược!"}`;

        return api.sendMessage(msg, threadID, messageID);
      } catch (err) {
        console.error(err);
        return api.sendMessage("❌ Lỗi khi xem thông tin cá cược.", threadID, messageID);
      }
    }

    // 2. BẢNG XẾP HẠNG
    if (subCommand === "top" || subCommand === "topbet" || subCommand === "leaderboard") {
      try {
        const topPlayers = await execute(`
          SELECT p.*, u.name 
          FROM bet_players p
          LEFT JOIN messenger_users u ON p.psid = u.psid
          ORDER BY p.total_profit DESC
          LIMIT 10
        `);

        if (!topPlayers || topPlayers.length === 0) {
          return api.sendMessage("📊 Chưa có số liệu bảng xếp hạng cá độ.", threadID, messageID);
        }

        let msg = `📊 BẢNG XẾP HẠNG ĐẠI GIA CÁ ĐỘ (TOP LỢI NHUẬN)
━━━━━━━━━━━━━━\n`;
        topPlayers.forEach((p, idx) => {
          const name = p.name || `Người chơi ${p.psid.slice(-6)}`;
          const roi = p.total_wagered > 0 ? ((p.total_profit / p.total_wagered) * 100).toFixed(1) : "0.0";
          msg += `${idx + 1}. 👤 ${name}
   💵 Lợi nhuận: ${p.total_profit >= 0 ? "+" : ""}${p.total_profit.toLocaleString('vi-VN')}$
   🎫 Thắng: ${p.won_bets}/${p.total_bets} trận | ROI: ${roi}%\n`;
        });

        return api.sendMessage(msg, threadID, messageID);
      } catch (err) {
        console.error(err);
        return api.sendMessage("❌ Lỗi hiển thị bảng xếp hạng.", threadID, messageID);
      }
    }

    // 3. ADMIN COMMANDS (/keo)
    if (subCommand === "keo" || subCommand === "admin") {
      const adminUIDs = getAdminBotUIDs();
      if (!adminUIDs.includes(String(senderID))) {
        return api.sendMessage("❌ Bạn không có quyền sử dụng chức năng quản trị này!", threadID, messageID);
      }

      const action = args[1]?.toLowerCase();
      
      // /keo sync
      if (action === "sync") {
        api.sendMessage("⏳ Đang đồng bộ các trận đấu thực tế từ ESPN...", threadID, messageID);
        await syncRealMatches(api);
        return api.sendMessage("✅ Đã hoàn tất đồng bộ kèo đấu thực tế mới nhất từ ESPN!", threadID, messageID);
      }

      // /keo close [id]
      if (action === "close") {
        const matchId = parseInt(args[2]);
        if (isNaN(matchId)) return api.sendMessage("⚠️ Vui lòng nhập ID trận đấu.", threadID, messageID);
        await execute("UPDATE bet_matches SET status = 'closed' WHERE id = ?", [matchId]);
        return api.sendMessage(`✅ Đã đóng cược trận đấu ID: ${matchId}`, threadID, messageID);
      }

      // /keo refund [id]
      if (action === "refund") {
        const matchId = parseInt(args[2]);
        if (isNaN(matchId)) return api.sendMessage("⚠️ Vui lòng nhập ID trận đấu.", threadID, messageID);
        
        const tickets = await execute("SELECT * FROM bet_tickets WHERE match_id = ? AND status = 'pending'", [matchId]);
        const connection = await getConnection();
        try {
          await connection.beginTransaction();
          for (const ticket of tickets) {
            await connection.execute("UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?", [ticket.amount, ticket.thread_id, ticket.psid]);
            await connection.execute("UPDATE bet_tickets SET status = 'refunded', payout = ? WHERE id = ?", [ticket.amount, ticket.id]);
            await connection.execute("INSERT INTO bet_logs (psid, action, details) VALUES (?, 'refund', ?)", [ticket.psid, `Refund match ${matchId}, refund amount: ${ticket.amount}`]);
          }
          await connection.execute("UPDATE bet_matches SET status = 'refunded' WHERE id = ?", [matchId]);
          await connection.commit();
          return api.sendMessage(`✅ Đã hủy trận đấu ID: ${matchId} và hoàn tiền cho toàn bộ người chơi.`, threadID, messageID);
        } catch (e) {
          await connection.rollback();
          console.error(e);
          return api.sendMessage("❌ Lỗi khi thực hiện hoàn tiền cược.", threadID, messageID);
        } finally {
          connection.release();
        }
      }

      // /keo cancel [match_id] [psid]
      if (action === "cancel") {
        const matchId = parseInt(args[2]);
        const targetPsid = args[3];
        if (isNaN(matchId) || !targetPsid) return api.sendMessage("⚠️ Sử dụng: /bongda keo cancel [match_id] [psid]", threadID, messageID);

        const tickets = await execute("SELECT * FROM bet_tickets WHERE match_id = ? AND psid = ? AND status = 'pending'", [matchId, targetPsid]);
        if (tickets.length === 0) return api.sendMessage("❌ Không tìm thấy vé cược hợp lệ đang chờ của người chơi này.", threadID, messageID);

        const connection = await getConnection();
        try {
          await connection.beginTransaction();
          const ticket = tickets[0];
          await connection.execute("UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?", [ticket.amount, ticket.thread_id, ticket.psid]);
          await connection.execute("DELETE FROM bet_tickets WHERE id = ?", [ticket.id]);
          await connection.execute("INSERT INTO bet_logs (psid, action, details) VALUES (?, 'admin_cancel', ?)", [ticket.psid, `Admin cancelled bet on match ${matchId}, refunded: ${ticket.amount}`]);
          await connection.commit();
          return api.sendMessage(`✅ Đã hủy vé cược trận ${matchId} của người dùng và hoàn lại ${ticket.amount.toLocaleString('vi-VN')}$.`, threadID, messageID);
        } catch (e) {
          await connection.rollback();
          return api.sendMessage("❌ Lỗi khi hủy vé cược.", threadID, messageID);
        } finally {
          connection.release();
        }
      }

      // /keo result [id] [Tỉ số X-Y]
      if (action === "result") {
        const matchId = parseInt(args[2]);
        const scoreStr = args[3];
        if (isNaN(matchId) || !scoreStr || !scoreStr.includes("-")) {
          return api.sendMessage("⚠️ Cú pháp: /bongda keo result [id] [Tỉ số X-Y] (Ví dụ: /bongda keo result 1 2-1)", threadID, messageID);
        }

        const matches = await execute("SELECT * FROM bet_matches WHERE id = ? AND status != 'finished'", [matchId]);
        if (matches.length === 0) return api.sendMessage("❌ Không tìm thấy trận đấu hợp lệ hoặc trận đấu đã thanh toán rồi.", threadID, messageID);

        const match = matches[0];
        const scores = scoreStr.split("-").map(Number);
        if (isNaN(scores[0]) || isNaN(scores[1])) return api.sendMessage("⚠️ Tỉ số không hợp lệ.", threadID, messageID);

        let firstScorer = "none";
        if (scores[0] > 0 || scores[1] > 0) {
          firstScorer = args[4]?.toLowerCase() === "away" ? "away" : "home";
        }

        await settleMatch(api, match, scores[0], scores[1], firstScorer);
        return api.sendMessage(`✅ Đã thanh toán và kết thúc trận đấu ${matchId} thành công với tỉ số ${scores[0]}-${scores[1]}!`, threadID, messageID);
      }

      return api.sendMessage("⚠️ Lệnh Admin không hợp lệ! Hỗ trợ: sync, close, refund, cancel, result", threadID, messageID);
    }

    // 4. HIỂN THỊ DANH SÁCH TRẬN ĐẤU (Default hoặc Lọc theo giải đấu)
    try {
      if (args.length === 0) {
        const helpMsg = `⚽ CÁ ĐỘ BÓNG ĐÁ REAL-TIME ⚽
━━━━━━━━━━━━━━━━━━
Hệ thống cược bóng đá thực tế tự động lấy Odds nhà cái DraftKings từ ESPN & hỗ trợ cược Rung Live trong trận!

👉 Hướng dẫn xem danh sách trận đấu:
• /bongda all -> Xem 5 trận đấu mới nhất đang mở cược
• /bongda live -> Xem các trận đấu đang đá Live (cược rung)
• /bongda wc -> Xem giải World Cup
• /bongda c1 -> Xem giải Cup C1 (Champions League)
• /bongda epl -> Xem giải Ngoại Hạng Anh
• /bongda laliga -> Xem giải La Liga (Tây Ban Nha)
• /bongda seriea -> Xem giải Serie A (Ý)
• /bongda bundesliga -> Xem giải Bundesliga (Đức)
• /bongda ligue1 -> Xem giải Ligue 1 (Pháp)

👉 Các lệnh tiện ích khác:
• /bongda profile -> Xem số dư, ROI, chuỗi thắng & thành tựu của bạn
• /bongda top -> Xem bảng xếp hạng đại gia lợi nhuận

💰 Cách đặt cược:
Reply tin nhắn trận đấu muốn cược theo cú pháp: [Số_Kèo] [Số_Tiền]
Ví dụ: "1 50k" hoặc "6 all" hoặc "4 half"

❌ Để hủy vé cược: Reply tin nhắn trận đấu gõ "hủy" hoặc "cancel" để hoàn tiền cược.`;
        return api.sendMessage(helpMsg, threadID, messageID);
      }

      let matches;
      const firstArg = args[0].toLowerCase();
      const targetId = parseInt(firstArg);

      if (!isNaN(targetId)) {
        matches = await execute(`
          SELECT * FROM bet_matches 
          WHERE id = ?
        `, [targetId]);
        if (!matches || matches.length === 0) {
          return api.sendMessage(`❌ Không tìm thấy trận đấu nào có ID: ${targetId}`, threadID, messageID);
        }
      } else if (firstArg === "all") {
        matches = await execute(`
          SELECT * FROM bet_matches 
          WHERE status IN ('open', 'live') 
          ORDER BY CASE WHEN status = 'live' THEN 0 ELSE 1 END, match_time ASC 
          LIMIT 10
        `);
        if (!matches || matches.length === 0) {
          return api.sendMessage("⚽ Hiện tại không có trận đấu nào đang mở cược. Vui lòng quay lại sau!", threadID, messageID);
        }
      } else if (firstArg === "live") {
        matches = await execute(`
          SELECT * FROM bet_matches 
          WHERE status = 'live'
          ORDER BY match_time ASC 
          LIMIT 10
        `);
        if (!matches || matches.length === 0) {
          return api.sendMessage("⚽ Hiện tại không có trận đấu nào đang diễn ra Live để cược rung!", threadID, messageID);
        }
      } else {
        const queryTerm = getLeagueSearchQuery(args[0]);
        matches = await execute(`
          SELECT * FROM bet_matches 
          WHERE status IN ('open', 'live') AND league LIKE ?
          ORDER BY CASE WHEN status = 'live' THEN 0 ELSE 1 END, match_time ASC 
          LIMIT 10
        `, [queryTerm]);
        
        if (!matches || matches.length === 0) {
          return api.sendMessage(`⚽ Không tìm thấy trận đấu nào đang mở thuộc giải đấu khớp với từ khóa "${args[0]}"!`, threadID, messageID);
        }
      }

      // Trận đầu tiên hiển thị đầy đủ bảng kèo
      const firstMatch = matches[0];
      const board = formatMatchBoard(firstMatch, config);
      await api.sendMessage(board, threadID);

      // Các trận đấu tiếp theo chỉ hiển thị rút gọn "ai đấu với ai" để tránh spam
      if (matches.length > 1) {
        let nextMatchesMsg = `📅 CÁC TRẬN ĐẤU TIẾP THEO:\n`;
        for (let i = 1; i < matches.length; i++) {
          const m = matches[i];
          const timeStr = m.match_time.slice(11, 16);
          const statusStr = m.status === "live" ? "🔴 LIVE" : `🕒 ${timeStr}`;
          nextMatchesMsg += `• [ID: ${m.id}] ${m.home_team} 🆚 ${m.away_team} (${statusStr})\n`;
        }
        nextMatchesMsg += `\n💡 Gõ: /bongda [ID] để xem chi tiết kèo và cược trận tiếp theo!`;
        await api.sendMessage(nextMatchesMsg, threadID);
      }
    } catch (e) {
      console.error(e);
      return api.sendMessage("❌ Lỗi hiển thị bảng cược bóng đá.", threadID, messageID);
    }
  },

  // REPLY HANDLING (Đặt cược & Hủy cược qua Reply)
  handleReply: async ({ api, event, config }) => {
    const { threadID, senderID, messageID, body } = event;

    const cooldown = checkCooldown({
      command: "bongda_reply",
      key: senderID,
      durationMs: 2000,
    });
    if (!cooldown.allowed) return;

    if (!event.messageReply) return;
    const repliedText = String(event.messageReply.body || "");

    const matchIdMatch = repliedText.match(/(?:⚽|🔴)\s*\[ID:\s*(\d+)\]/i);
    if (!matchIdMatch) return;

    const matchId = parseInt(matchIdMatch[1]);
    const cleanBody = String(body || "").trim();

    const matches = await execute("SELECT * FROM bet_matches WHERE id = ?", [matchId]);
    if (matches.length === 0) return api.sendMessage("❌ Trận đấu này không tồn tại.", threadID, messageID);
    
    const match = matches[0];

    // XỬ LÝ HỦY VÉ CƯỢC
    if (cleanBody.toLowerCase() === "hủy" || cleanBody.toLowerCase() === "cancel") {
      if (match.status !== "open" && match.status !== "live") {
        return api.sendMessage("❌ Kèo đấu này đã khóa, không thể hủy cược!", threadID, messageID);
      }

      const tickets = await execute("SELECT * FROM bet_tickets WHERE match_id = ? AND psid = ? AND status = 'pending'", [matchId, senderID]);
      if (tickets.length === 0) {
        return api.sendMessage("⚠️ Bạn không có vé cược nào đang chờ ở trận đấu này.", threadID, messageID);
      }

      const ticket = tickets[0];
      const connection = await getConnection();
      try {
        await connection.beginTransaction();

        await connection.execute(
          "UPDATE messenger_users SET credits = credits + ? WHERE thread_id = ? AND psid = ?",
          [ticket.amount, threadID, senderID]
        );

        await connection.execute("DELETE FROM bet_tickets WHERE id = ?", [ticket.id]);

        await connection.execute(
          "INSERT INTO bet_logs (psid, action, details) VALUES (?, 'cancel', ?)",
          [senderID, `User cancelled bet on match ${matchId}, refunded: ${ticket.amount}`]
        );

        await connection.commit();
        return api.sendMessage(`✅ Đã hủy vé cược trận [ID: ${matchId}] thành công!\n💰 Hoàn lại: +${ticket.amount.toLocaleString('vi-VN')}$ vào ví của bạn.`, threadID, messageID);
      } catch (err) {
        await connection.rollback();
        console.error(err);
        return api.sendMessage("❌ Lỗi khi hủy vé cược.", threadID, messageID);
      } finally {
        connection.release();
      }
    }

    // ĐẶT VÉ CƯỢC MỚI
    if (match.status !== "open" && match.status !== "live") {
      return api.sendMessage("❌ Kèo đấu này đã đóng hoặc đã kết thúc, không thể đặt cược nữa!", threadID, messageID);
    }

    // Chặn cược live (rung) sau phút 80
    if (match.status === "live" && match.live_clock) {
      const minutes = parseInt(match.live_clock.replace("'", ""));
      if (!isNaN(minutes) && minutes > LIVE_BET_MAX_MINUTE) {
        return api.sendMessage("❌ Trận đấu đã bước sang phút 80+, hệ thống đã khóa nhận cược live!", threadID, messageID);
      }
    }

    const betParts = cleanBody.match(/^(\d+)\s+(.+)$/);
    if (!betParts) {
      return api.sendMessage("⚠️ Cú pháp cược không hợp lệ.\nVui lòng reply theo cú pháp: [Số_Kèo] [Số_Tiền]\nVí dụ: 1 50k hoặc 6 all", threadID, messageID);
    }

    const chosenOption = parseInt(betParts[1]);
    const amountInput = betParts[2].trim();

    if (chosenOption < 1 || chosenOption > 19) {
      return api.sendMessage("⚠️ Mã kèo không hợp lệ (Phải từ 1 đến 19).", threadID, messageID);
    }

    let senderName = "Người dùng";
    try {
      const userInfo = await api.getUserInfo(senderID);
      if (userInfo && userInfo[senderID]) {
        senderName = userInfo[senderID].name;
      }
    } catch (e) {
      if (global.data && global.data.userName && global.data.userName.has(senderID)) {
        senderName = global.data.userName.get(senderID);
      }
    }

    const user = await ensureUserAccount(threadID, senderID, senderName);
    const userBalance = user.credits;

    let betAmount = 0;
    const lowerAmount = amountInput.toLowerCase();

    if (lowerAmount === "all" || lowerAmount === "tat" || lowerAmount === "tất tay") {
      betAmount = userBalance;
    } else if (lowerAmount === "half" || lowerAmount === "nửa" || lowerAmount === "50%") {
      betAmount = Math.floor(userBalance / 2);
    } else if (lowerAmount === "25%") {
      betAmount = Math.floor(userBalance * 0.25);
    } else if (lowerAmount === "75%") {
      betAmount = Math.floor(userBalance * 0.75);
    } else if (lowerAmount.endsWith("%")) {
      const percent = parseFloat(lowerAmount.replace("%", ""));
      if (isNaN(percent) || percent <= 0 || percent > 100) {
        return api.sendMessage("⚠️ Tỷ lệ phần trăm cược phải từ 1% đến 100%.", threadID, messageID);
      }
      betAmount = Math.floor((userBalance * percent) / 100);
    } else {
      betAmount = parseMoneyAmount(amountInput);
    }

    if (isNaN(betAmount) || betAmount <= 0) {
      return api.sendMessage("⚠️ Số tiền cược không hợp lệ.", threadID, messageID);
    }
    if (betAmount < 1000) {
      return api.sendMessage("⚠️ Số tiền cược tối thiểu là 1.000$.", threadID, messageID);
    }
    if (userBalance < betAmount) {
      return api.sendMessage(`💸 Không đủ số dư! Tài khoản của bạn hiện tại có: ${userBalance.toLocaleString('vi-VN')}$`, threadID, messageID);
    }

    const oddsKey = `odds_${chosenOption}`;
    const selectedOdds = match[oddsKey];

    const connection = await getConnection();
    try {
      await connection.beginTransaction();

      const [existingTickets] = await connection.execute(
        "SELECT id FROM bet_tickets WHERE match_id = ? AND psid = ? AND chosen_option = ?",
        [matchId, senderID, chosenOption]
      );
      if (existingTickets.length > 0) {
        await connection.rollback();
        return api.sendMessage("⚠️ Bạn đã đặt vé cược cho cửa này ở trận đấu này rồi! Hãy chọn cửa khác hoặc hủy vé cũ.", threadID, messageID);
      }

      await connection.execute(
        "UPDATE messenger_users SET credits = credits - ? WHERE thread_id = ? AND psid = ?",
        [betAmount, threadID, senderID]
      );

      await connection.execute(`
        INSERT INTO bet_tickets (match_id, thread_id, psid, username, chosen_option, amount, odds, status, message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `, [matchId, threadID, senderID, senderName, chosenOption, betAmount, selectedOdds, messageID]);

      await connection.execute(
        "INSERT INTO bet_logs (psid, action, details) VALUES (?, 'bet', ?)",
        [senderID, `Placed bet of ${betAmount} on match ${matchId}, option ${chosenOption}, odds ${selectedOdds}`]
      );

      await connection.commit();

      const optionName = getOptionName(chosenOption, match.home_team, match.away_team, match.handicap, match.ou);
      const possiblePayout = Math.floor(betAmount * selectedOdds);

      const isLiveStr = match.status === "live" ? "🔴 [CƯỢC RUNG LIVE] " : "🎫 ";
      const clockStr = match.status === "live" ? `\n⏱️ Thời điểm cược: Phút ${match.live_clock || "Đang đá"}` : "";

      const successMsg = `${isLiveStr}VÉ CƯỢC THÀNH CÔNG!
⚽ Trận đấu: ${match.home_team} vs ${match.away_team}${clockStr}
👉 Lựa chọn: ${optionName}
📉 Tỷ lệ Odds: ${selectedOdds.toFixed(2)}
💰 Tiền cược: ${betAmount.toLocaleString('vi-VN')}$
🔮 Có thể thắng: ${possiblePayout.toLocaleString('vi-VN')}$ (chưa trừ thuế 5% nếu thắng)
━━━━━━━━━━━━━━
Chúc bạn may mắn! 🍀`;

      return api.sendMessage(successMsg, threadID, messageID);

    } catch (err) {
      await connection.rollback();
      console.error("[Cá độ] Lỗi xử lý giao dịch đặt cược:", err);
      return api.sendMessage("❌ Lỗi hệ thống: Không thể ghi nhận vé cược lúc này.", threadID, messageID);
    } finally {
      connection.release();
    }
  }
};
