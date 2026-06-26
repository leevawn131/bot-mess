// Game Đuổi Hình Bắt Chữ

const puzzles = [
    { emoji: "🌧️🧥", answer: "Áo mưa", hints: ["Dùng khi trời mưa", "Mặc bên ngoài", "Giữ cơ thể khô ráo"] },
    { emoji: "📖👓", answer: "Đọc sách", hints: ["Hoạt động học tập", "Có trang giấy", "Tăng kiến thức"] },
    { emoji: "🍚🐟", answer: "Cơm cá", hints: ["Món ăn gia đình", "Có tinh bột", "Ăn bằng đũa"] },
    { emoji: "🚗💨", answer: "Lái xe", hints: ["Điều khiển phương tiện", "Có vô lăng", "Di chuyển trên đường"] },
    { emoji: "🌞🕶️", answer: "Kính râm", hints: ["Phụ kiện thời trang", "Dùng khi nắng", "Bảo vệ mắt"] },
    { emoji: "🏠🧹", answer: "Dọn nhà", hints: ["Việc nội trợ", "Làm sạch không gian", "Nhà cửa gọn gàng"] },
    { emoji: "🔥🍳", answer: "Nấu ăn", hints: ["Ở trong bếp", "Dùng nồi chảo", "Tạo ra món ăn"] },
    { emoji: "🚌🏫", answer: "Đi học", hints: ["Đến trường", "Có thầy cô", "Có bài tập"] },
    { emoji: "💰🏦", answer: "Gửi tiết kiệm", hints: ["Liên quan ngân hàng", "Tích lũy tiền", "Có lãi suất"] },
    { emoji: "⚽🥅", answer: "Ghi bàn", hints: ["Trong bóng đá", "Bóng vào lưới", "Mang điểm số"] },
    { emoji: "🎂🕯️", answer: "Sinh nhật", hints: ["Có bánh kem", "Có nến", "Mỗi năm một lần"] },
    { emoji: "🎁💌", answer: "Quà tặng", hints: ["Thể hiện tình cảm", "Gói đẹp", "Trao trong dịp đặc biệt"] },
    { emoji: "🚲🏞️", answer: "Đạp xe", hints: ["Xe hai bánh", "Tốt cho sức khỏe", "Có bàn đạp"] },
    { emoji: "📷🌄", answer: "Chụp ảnh", hints: ["Lưu khoảnh khắc", "Dùng máy ảnh", "Có khung hình"] },
    { emoji: "🛏️🌙", answer: "Ngủ ngon", hints: ["Diễn ra ban đêm", "Nằm trên giường", "Nghỉ ngơi cơ thể"] },
    { emoji: "🧃🧊", answer: "Nước lạnh", hints: ["Đồ uống giải khát", "Có đá", "Mát cổ"] },
    { emoji: "🌳💨", answer: "Gió mát", hints: ["Cảm giác dễ chịu", "Ở ngoài trời", "Lay động lá cây"] },
    { emoji: "☕🥐", answer: "Bữa sáng", hints: ["Bữa ăn đầu ngày", "Giúp có năng lượng", "Không nên bỏ"] },
    { emoji: "🧠📝", answer: "Ghi nhớ", hints: ["Liên quan trí não", "Giúp học tốt", "Tránh quên"] },
    { emoji: "🔒🚪", answer: "Khóa cửa", hints: ["Đảm bảo an toàn", "Dùng chìa", "Làm trước khi ra ngoài"] },
    { emoji: "💻📶", answer: "Kết nối mạng", hints: ["Dùng internet", "Có Wi-Fi", "Phục vụ làm việc"] },
    { emoji: "📱🔋", answer: "Sạc pin", hints: ["Dành cho điện thoại", "Cắm dây", "Tăng phần trăm pin"] },
    { emoji: "🧴🧼", answer: "Rửa mặt", hints: ["Chăm sóc cá nhân", "Làm sạch da", "Thường làm sáng tối"] },
    { emoji: "🦷🪥", answer: "Đánh răng", hints: ["Vệ sinh cá nhân", "Dùng bàn chải", "Giữ hơi thở thơm"] },
    { emoji: "👕🧺", answer: "Giặt đồ", hints: ["Việc nhà", "Dùng bột giặt", "Phơi sau khi giặt"] },
    { emoji: "🌸🐝", answer: "Hoa nở", hints: ["Hiện tượng tự nhiên", "Thường mùa xuân", "Có ong bướm"] },
    { emoji: "🌊🏄", answer: "Lướt sóng", hints: ["Thể thao biển", "Dùng ván", "Cần thăng bằng"] },
    { emoji: "🗺️🧭", answer: "Chỉ đường", hints: ["Giúp tìm nơi", "Có bản đồ", "Có phương hướng"] },
    { emoji: "🚦🚶", answer: "Qua đường", hints: ["Người đi bộ", "Có đèn giao thông", "Cần an toàn"] },
    { emoji: "🍜🥢", answer: "Ăn mì", hints: ["Món có sợi", "Dùng đũa", "Ăn nhanh"] },
    { emoji: "🍉🔪", answer: "Cắt dưa", hints: ["Dùng dao", "Trái cây mùa hè", "Ruột đỏ"] },
    { emoji: "🌋🔥", answer: "Núi lửa", hints: ["Hiện tượng địa chất", "Phun dung nham", "Rất nóng"] },
    { emoji: "❄️⛰️", answer: "Núi tuyết", hints: ["Khung cảnh lạnh", "Màu trắng", "Vùng cao"] },
    { emoji: "🎤🎶", answer: "Ca sĩ", hints: ["Người biểu diễn", "Dùng micro", "Có bài hát"] },
    { emoji: "🎻🎵", answer: "Chơi đàn", hints: ["Âm nhạc", "Có giai điệu", "Cần luyện tập"] },
    { emoji: "📺🛋️", answer: "Xem phim", hints: ["Giải trí", "Có màn hình", "Có cốt truyện"] },
    { emoji: "🐶🦴", answer: "Cho chó ăn", hints: ["Chăm thú cưng", "Con vật trung thành", "Làm hằng ngày"] },
    { emoji: "🐱🧶", answer: "Mèo chơi len", hints: ["Thú cưng", "Có cuộn len", "Rất dễ thương"] },
    { emoji: "🌙⭐", answer: "Đêm sao", hints: ["Khung cảnh ban đêm", "Bầu trời lấp lánh", "Lãng mạn"] },
    { emoji: "🌅🏃", answer: "Chạy bộ", hints: ["Môn thể dục", "Không cần dụng cụ", "Tốt cho tim mạch"] },
    { emoji: "🍞🧈", answer: "Bánh mì bơ", hints: ["Bữa sáng nhanh", "Có bánh mì", "Có bơ"] },
    { emoji: "🍲🥄", answer: "Canh nóng", hints: ["Món nước", "Dùng muỗng", "Ăn cùng cơm"] },
    { emoji: "🧂🍲", answer: "Nêm muối", hints: ["Bước nấu ăn", "Gia vị mặn", "Tăng đậm đà"] },
    { emoji: "🧯🔥", answer: "Chữa cháy", hints: ["Tình huống khẩn", "Dùng bình cứu hỏa", "Dập lửa"] },
    { emoji: "🚑🏥", answer: "Cấp cứu", hints: ["Y tế khẩn cấp", "Có xe cứu thương", "Cần nhanh"] },
    { emoji: "🚓👮", answer: "Cảnh sát", hints: ["Giữ trật tự", "Mặc đồng phục", "Liên quan pháp luật"] },
    { emoji: "🚒💦", answer: "Xe cứu hỏa", hints: ["Phương tiện chuyên dụng", "Màu đỏ", "Có vòi nước"] },
    { emoji: "🧑‍🍳🍰", answer: "Làm bánh", hints: ["Trong bếp", "Có bột và đường", "Món tráng miệng"] },
    { emoji: "🏊‍♂️🏅", answer: "Bơi lội", hints: ["Thể thao nước", "Có hồ bơi", "Tốt cho sức khỏe"] },
    { emoji: "🏸🏟️", answer: "Đánh cầu lông", hints: ["Dùng vợt", "Có quả cầu", "Chơi đối kháng"] },
    { emoji: "🏀⛹️", answer: "Bóng rổ", hints: ["Có rổ", "Có bóng cam", "Ném để ghi điểm"] },
    { emoji: "🎯🏹", answer: "Bắn cung", hints: ["Có cung tên", "Ngắm mục tiêu", "Cần tập trung"] },
    { emoji: "🚴‍♂️⛰️", answer: "Đua xe đạp", hints: ["Môn thể thao", "Thi tốc độ", "Cần sức bền"] },
    { emoji: "🧗‍♂️🪨", answer: "Leo núi", hints: ["Mạo hiểm", "Có vách đá", "Rèn thể lực"] },
    { emoji: "🥋🏆", answer: "Võ sĩ", hints: ["Người tập võ", "Có thi đấu", "Kỷ luật cao"] },
    { emoji: "🧘‍♀️🕯️", answer: "Thiền định", hints: ["Giữ tâm tĩnh", "Tập trung hơi thở", "Giảm căng thẳng"] },
    { emoji: "📦🚚", answer: "Giao hàng", hints: ["Dịch vụ vận chuyển", "Có kiện hàng", "Đến đúng địa chỉ"] },
    { emoji: "🛒🧾", answer: "Đi chợ", hints: ["Mua thực phẩm", "Có giỏ hàng", "Chuẩn bị bữa ăn"] },
    { emoji: "🍅🥗", answer: "Làm salad", hints: ["Món rau", "Ăn mát", "Ít dầu mỡ"] },
    { emoji: "🧁🍓", answer: "Bánh ngọt", hints: ["Món tráng miệng", "Có vị ngọt", "Hợp tiệc"] },
    { emoji: "🧊🥤", answer: "Trà đá", hints: ["Đồ uống quen thuộc", "Có đá", "Giải khát"] },
    { emoji: "🍋🍯", answer: "Chanh mật ong", hints: ["Vị chua ngọt", "Tốt cho cổ", "Có thể pha ấm"] },
    { emoji: "🍌🥛", answer: "Sinh tố chuối", hints: ["Đồ uống xay", "Có chuối", "Có sữa"] },
    { emoji: "🥥🥤", answer: "Nước dừa", hints: ["Đồ uống tự nhiên", "Mát", "Lấy từ quả dừa"] },
    { emoji: "🌽🔥", answer: "Bắp nướng", hints: ["Món ăn vặt", "Nướng trên lửa", "Mùi thơm"] },
    { emoji: "🍢🔥", answer: "Xiên nướng", hints: ["Món đường phố", "Có que", "Ăn nóng"] },
    { emoji: "🍣🐟", answer: "Sushi", hints: ["Món Nhật", "Có cơm", "Có cá"] },
    { emoji: "🍱🥢", answer: "Cơm hộp", hints: ["Bữa trưa tiện lợi", "Đựng trong hộp", "Mang đi làm"] },
    { emoji: "🍛🍗", answer: "Cà ri gà", hints: ["Món nước sánh", "Có gà", "Màu vàng"] },
    { emoji: "🥟♨️", answer: "Há cảo", hints: ["Món hấp", "Có vỏ bột", "Có nhân"] },
    { emoji: "🧳✈️", answer: "Du lịch", hints: ["Đi xa", "Chuẩn bị hành lý", "Khám phá nơi mới"] },
    { emoji: "🏨🛎️", answer: "Khách sạn", hints: ["Nơi lưu trú", "Có lễ tân", "Có phòng nghỉ"] },
    { emoji: "🧭🏕️", answer: "Cắm trại", hints: ["Ngoài trời", "Có lều", "Gần thiên nhiên"] },
    { emoji: "🔦🌌", answer: "Soi đêm", hints: ["Dùng đèn pin", "Trời tối", "Quan sát xung quanh"] },
    { emoji: "🌧️⛰️", answer: "Mưa rừng", hints: ["Thời tiết", "Ở vùng núi", "Ẩm ướt"] },
    { emoji: "🌈☀️", answer: "Cầu vồng", hints: ["Nhiều màu", "Thường sau mưa", "Trên bầu trời"] },
    { emoji: "🌪️🏠", answer: "Bão tố", hints: ["Thời tiết xấu", "Gió mạnh", "Nguy hiểm"] },
    { emoji: "🌊🚢", answer: "Đi biển", hints: ["Hoạt động du lịch", "Có sóng", "Có tàu"] },
    { emoji: "⛵🌬️", answer: "Thuyền buồm", hints: ["Trên nước", "Dùng gió", "Có buồm"] },
    { emoji: "🚆🛤️", answer: "Tàu hỏa", hints: ["Phương tiện công cộng", "Chạy đường ray", "Có toa"] },
    { emoji: "🚕📍", answer: "Bắt taxi", hints: ["Gọi xe", "Có điểm đón", "Di chuyển nhanh"] },
    { emoji: "🛵🛣️", answer: "Chạy xe máy", hints: ["Hai bánh", "Đội mũ bảo hiểm", "Đi trên đường"] },
    { emoji: "⛽🚗", answer: "Đổ xăng", hints: ["Ở cây xăng", "Cho phương tiện", "Có vòi bơm"] },
    { emoji: "🧰🔧", answer: "Sửa xe", hints: ["Công việc kỹ thuật", "Dùng dụng cụ", "Khắc phục hỏng hóc"] },
    { emoji: "🏦💳", answer: "Rút tiền", hints: ["Dùng thẻ", "Có ATM", "Nhận tiền mặt"] },
    { emoji: "🧾💸", answer: "Thanh toán", hints: ["Sau khi mua", "Có hóa đơn", "Kết thúc giao dịch"] },
    { emoji: "💼🏢", answer: "Đi làm", hints: ["Đến công ty", "Có giờ giấc", "Có lương"] },
    { emoji: "🗂️🖊️", answer: "Văn phòng", hints: ["Nơi làm việc", "Có hồ sơ", "Có bàn ghế"] },
    { emoji: "🧑‍🏫📘", answer: "Giáo viên", hints: ["Người dạy học", "Đứng lớp", "Chấm bài"] },
    { emoji: "👩‍⚕️💉", answer: "Bác sĩ", hints: ["Khám chữa bệnh", "Ngành y", "Làm ở bệnh viện"] },
    { emoji: "👨‍🌾🌾", answer: "Nông dân", hints: ["Làm nông", "Có ruộng", "Trồng lúa"] },
    { emoji: "👷‍♂️🧱", answer: "Công nhân", hints: ["Lao động", "Có mũ bảo hộ", "Làm công trình"] },
    { emoji: "🎨🖌️", answer: "Họa sĩ", hints: ["Vẽ tranh", "Dùng cọ", "Nghệ thuật"] },
    { emoji: "📚✍️", answer: "Tác giả", hints: ["Người viết", "Có sách", "Có độc giả"] },
    { emoji: "🎬🎞️", answer: "Đạo diễn", hints: ["Làm phim", "Chỉ đạo cảnh quay", "Làm việc với diễn viên"] },
    { emoji: "🎮🏆", answer: "Game thủ", hints: ["Chơi trò chơi", "Có kỹ năng", "Có thể thi đấu"] },
    { emoji: "🤖💡", answer: "Trí tuệ nhân tạo", hints: ["Công nghệ hiện đại", "Gọi tắt AI", "Liên quan máy học"] },
    { emoji: "🌐🔐", answer: "Bảo mật mạng", hints: ["Liên quan internet", "Bảo vệ dữ liệu", "Chống tấn công"] },
    { emoji: "☁️💾", answer: "Lưu trữ đám mây", hints: ["Lưu dữ liệu online", "Gọi là cloud", "Đồng bộ nhiều thiết bị"] },
    { emoji: "📡🛰️", answer: "Vệ tinh", hints: ["Ngoài không gian", "Thu phát tín hiệu", "Quay quanh Trái Đất"] },
    { emoji: "🌾🌞", answer: "Mùa gặt", hints: ["Nông nghiệp", "Lúa chín", "Thu hoạch trên đồng"] },
    { emoji: "🪁🌬️", answer: "Thả diều", hints: ["Trò chơi dân gian", "Cần gió", "Bay trên trời"] },
    { emoji: "🌕🏮", answer: "Trung thu", hints: ["Tết thiếu nhi", "Có lồng đèn", "Có trăng rằm"] },
    { emoji: "🥮🍵", answer: "Bánh trung thu", hints: ["Món bánh lễ hội", "Ăn dịp rằm", "Thường uống trà"] },
    { emoji: "🧧🎉", answer: "Lì xì", hints: ["Phong tục đầu năm", "Phong bao đỏ", "Mang may mắn"] },
    { emoji: "🌸🧹", answer: "Dọn Tết", hints: ["Cuối năm", "Làm sạch nhà", "Chuẩn bị đón xuân"] },
    { emoji: "🏮🐉", answer: "Múa lân", hints: ["Biểu diễn lễ hội", "Có trống", "Mang ý nghĩa may mắn"] },
    { emoji: "🎆🌃", answer: "Pháo hoa", hints: ["Ban đêm", "Nhiều màu", "Nổ trên trời"] },
    { emoji: "📚🏫", answer: "Trường học", hints: ["Nơi học tập", "Có lớp học", "Có thầy cô"] },
    { emoji: "🩺🏥", answer: "Khám bệnh", hints: ["Liên quan y tế", "Có bác sĩ", "Dùng ống nghe"] },
    { emoji: "🍲🍚", answer: "Bữa cơm", hints: ["Bữa ăn gia đình", "Có cơm", "Có món mặn"] },
    { emoji: "🌤️🧺", answer: "Đi picnic", hints: ["Hoạt động ngoài trời", "Có giỏ đồ", "Đi chơi thư giãn"] },
    { emoji: "🧠🏆", answer: "Thi trí tuệ", hints: ["Cần suy luận", "Có thi đấu", "Tranh giải thưởng"] },
    { emoji: "📱📸", answer: "Tự sướng", hints: ["Chụp ảnh bản thân", "Dùng điện thoại", "Hay đăng mạng xã hội"] },
    { emoji: "🧑‍🤝‍🧑🎉", answer: "Tiệc bạn bè", hints: ["Có nhiều người", "Không khí vui", "Có ăn uống"] },
    { emoji: "🏖️🏐", answer: "Bóng chuyền bãi biển", hints: ["Môn thể thao", "Chơi trên cát", "Có lưới"] },
    { emoji: "🕰️📖", answer: "Lịch sử", hints: ["Môn học", "Liên quan quá khứ", "Có mốc thời gian"] },
    { emoji: "🔬🧪", answer: "Thí nghiệm", hints: ["Trong phòng lab", "Có dụng cụ", "Phục vụ nghiên cứu"] },
    { emoji: "🧭🌍", answer: "Khám phá", hints: ["Đi đến nơi mới", "Tìm hiểu thế giới", "Có tính phiêu lưu"] },
    { emoji: "🎓📜", answer: "Nhận bằng", hints: ["Cột mốc học tập", "Có lễ tốt nghiệp", "Giấy chứng nhận"] },
    { emoji: "🛫🌏", answer: "Xuất ngoại", hints: ["Đi nước ngoài", "Bằng máy bay", "Cần hộ chiếu"] },
    { emoji: "📦🎁", answer: "Gói quà", hints: ["Chuẩn bị quà tặng", "Có hộp", "Có giấy gói"] },
    { emoji: "🧑‍💼🤝", answer: "Phỏng vấn", hints: ["Liên quan xin việc", "Có nhà tuyển dụng", "Trao đổi trực tiếp"] },
    { emoji: "🛡️⚔️", answer: "Chiến binh", hints: ["Nhân vật mạnh mẽ", "Có giáp", "Có vũ khí"] }
];

global.duoiHinhBatChuSessions = global.duoiHinhBatChuSessions || {};
const { checkCooldown } = require('../../utils/cooldown');
const prefix = process.env.BOT_PREFIX;

const normalizeAnswer = (text) => {
    if (!text) return "";
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
};

const buildAcceptedList = (puzzle) => {
    const answers = [puzzle.answer, ...(puzzle.aliases || [])];
    const normalized = answers.map(normalizeAnswer);
    return Array.from(new Set(normalized));
};

module.exports = {
    name: "duoihinhbatchu",
    description: "Game Đuổi Hình Bắt Chữ",
    usage: `\n${prefix}dhbc → Bắt đầu câu đố emoji mới\n━━━━━━━━━━━━━\n🎮 Reply đáp án để trả lời\n💡 Gợi ý xuất hiện nếu không ai đoán đúng\n🏆 Trả lời đúng sẽ nhận xu thưởng`,

    execute: async ({ api, event }) => {
        const { threadID } = event;

        const cooldown = checkCooldown({ command: "duoihinhbatchu", key: threadID, durationMs: 10000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi chơi tiếp!`, threadID);
        }

        const session = global.duoiHinhBatChuSessions[threadID];
        if (session) {
            return api.sendMessage("Đang có câu đố đang chờ. Reply tin nhắn câu đố để trả lời.", threadID);
        }

        const puzzle = puzzles[Math.floor(Math.random() * puzzles.length)];

        const message = "🧩 ĐUỔI HÌNH BẮT CHỮ\n" +
            `Câu đố: ${puzzle.emoji}\n` +
            "Reply tin nhắn này với đáp án.\n" +
            "Reply: gợi ý (để xin gợi ý) | đáp án (để xem đáp án)";

        const info = await api.sendMessage(message, threadID);

        global.duoiHinhBatChuSessions[threadID] = {
            messageID: info.messageID,
            puzzle,
            hintIndex: 0,
            accepted: buildAcceptedList(puzzle)
        };
    },

    handleReply: async ({ api, event }) => {
        const { threadID, body, messageReply } = event;
        const session = global.duoiHinhBatChuSessions[threadID];

        if (!session) return;
        if (!messageReply) return;
        if (String(messageReply.senderID) !== String(api.getCurrentUserID())) return;
        if (String(messageReply.messageID) !== String(session.messageID)) return;

        const normalized = normalizeAnswer(body);
        if (normalized === "goiy" || normalized === "hint") {
            const hint = session.puzzle.hints?.[session.hintIndex];
            if (!hint) return api.sendMessage("Hết gợi ý rồi!", threadID);
            session.hintIndex += 1;
            return api.sendMessage(`Gợi ý: ${hint}`, threadID);
        }

        if (normalized === "dapan" || normalized === "dap" || normalized === "end" || normalized === "stop") {
            const answer = session.puzzle.answer;
            delete global.duoiHinhBatChuSessions[threadID];
            return api.sendMessage(`Đáp án: ${answer}`, threadID);
        }

        if (session.accepted.includes(normalized)) {
            const answer = session.puzzle.answer;
            delete global.duoiHinhBatChuSessions[threadID];
            return api.sendMessage(`✅ Chính xác! Đáp án là: ${answer}`, threadID);
        }

        return api.sendMessage("❌ Sai rồi. Thử lại nhé!", threadID);
    }
};
