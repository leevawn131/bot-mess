// Game Duoi Hinh Bat Chu

const puzzles = [
    {
        emoji: "🦁👑",
        answer: "Vua sư tử",
        hints: [
            "Phim hoạt hình Disney",
            "Bối cảnh thảo nguyên",
            "Nhân vật chính là Simba",
            "Có Mufasa",
            "Ca khuc Circle of Life"
        ]
    },
    {
        emoji: "🍎📱",
        answer: "Apple",
        aliases: ["iPhone", "Tao"],
        hints: [
            "Thương hiệu công nghệ",
            "Logo trái táo cắn dở",
            "Công ty của Steve Jobs",
            "Macbook",
            "Hệ điều hành iOS"
        ]
    },
    {
        emoji: "🐝🍯",
        answer: "Mật ong",
        hints: [
            "Con vật nhỏ có ngòi",
            "Món ngọt màu vàng",
            "Làm từ hoa",
            "Dùng trong trà",
            "Tổ ong"
        ]
    },
    {
        emoji: "🎣🐟",
        answer: "Câu cá",
        hints: [
            "Hoạt động giải trí",
            "Dùng cần câu",
            "Thường ở sông, hồ",
            "Có phao nổi",
            "Thu hoạch là cá"
        ]
    },
    {
        emoji: "✈️🎫",
        answer: "Vé máy bay",
        hints: [
            "Liên quan đến du lịch",
            "Cần khi đi hàng không",
            "Có số ghế",
            "Check-in",
            "Sân bay"
        ]
    },
    {
        emoji: "🚲⚡",
        answer: "Xe đạp điện",
        hints: [
            "Phương tiện di chuyển",
            "Không cần đổ xăng",
            "Có pin hoặc ắc quy",
            "Chạy êm",
            "Thường đi học"
        ]
    },
    {
        emoji: "👂🐘",
        answer: "Tai voi",
        hints: [
            "Bộ phận cơ thể",
            "Con vật to lớn",
            "Rất rộng và to",
            "Dùng quạt mát",
            "Có ngà"
        ]
    },
    {
        emoji: "🏫📚",
        answer: "Trường học",
        hints: [
            "Nơi học tập",
            "Có thầy cô và học sinh",
            "Có lớp học",
            "Có sân trường",
            "Có trống trường"
        ]
    },
    {
        emoji: "🌧️☂️",
        answer: "Trời mưa",
        hints: [
            "Thời tiết",
            "Cần dù khi ra đường",
            "Nước rơi từ trời",
            "Đường trơn",
            "Có thể nghe tiếng lộp độp"
        ]
    },
    {
        emoji: "🧠💡",
        answer: "Sáng tạo",
        hints: [
            "Ý tưởng mới",
            "Liên quan đến trí tuệ",
            "Khác biệt",
            "Không sao chép",
            "Đổi mới"
        ]
    },
    {
        emoji: "🏥💊",
        answer: "Bệnh viện",
        hints: [
            "Nơi chữa bệnh",
            "Có bác sĩ và y tá",
            "Có giường bệnh",
            "Có phòng cấp cứu",
            "Có thuốc"
        ]
    },
    {
        emoji: "⏰🏃",
        answer: "Chạy đua",
        hints: [
            "Hoạt động thể thao",
            "Liên quan đến tốc độ",
            "Có vạch đích",
            "Có đồng hồ bấm giờ",
            "Có nhiều vận động viên"
        ]
    },
    {
        emoji: "🌙🐺",
        answer: "Sói tru",
        hints: [
            "Con vật sống theo bầy",
            "Thường xuất hiện ban đêm",
            "Âm thanh vang xa",
            "Gắn với mặt trăng",
            "Không phải chó nhà"
        ]
    },
    {
        emoji: "🔥💧",
        answer: "Nước sôi",
        hints: [
            "Trạng thái của nước",
            "Nóng",
            "Có bong bóng",
            "Dùng pha trà",
            "100 do C"
        ]
    },
    {
        emoji: "🧊☕",
        answer: "Cà phê đá",
        hints: [
            "Do uong buoi sang",
            "Co da vien",
            "Mau nau",
            "Co the pha sua",
            "Tinh tao"
        ]
    },
    {
        emoji: "🐯🏹",
        answer: "Hổ báo",
        hints: [
            "Cụm từ quen thuộc",
            "Con vật hoang da",
            "Lien quan den rung",
            "Co van",
            "Nguy hiem"
        ]
    },
    {
        emoji: "🧱📱",
        answer: "Gạch đá",
        hints: [
            "Vat lieu xay dung",
            "Thường di chung",
            "Co vien gạch",
            "Co vien da",
            "Dung de xay nha"
        ]
    },
    {
        emoji: "🚦🐢",
        answer: "Chậm chạp",
        hints: [
            "Trai nguoc voi nhanh",
            "Con vat bo cham",
            "Lien quan den toc do",
            "Thuong bi nhac nho",
            "Khong kip gio"
        ]
    },
    {
        emoji: "🥇🏃",
        answer: "Về nhất",
        hints: [
            "Ket qua cuoc dua",
            "Dung cho nguoi chien thang",
            "Co huy chuong",
            "Thu hang cao nhat",
            "Dung de khen"
        ]
    },
    {
        emoji: "🧼🧤",
        answer: "Rửa tay",
        hints: [
            "Viec ve sinh",
            "Dung xà phòng",
            "Lam sach ban",
            "Thuong lam truoc khi an",
            "Phong benh"
        ]
    },
    {
        emoji: "🐱🐟",
        answer: "Mèo ăn cá",
        hints: [
            "Con vat nuoi trong nha",
            "Thich an do tanh",
            "Co ria meo",
            "Thich ngu nang",
            "Hay kieu meo meo"
        ]
    },
    {
        emoji: "🎧🌧️",
        answer: "Nghe nhạc",
        hints: [
            "Hoat dong giai tri",
            "Dung tai nghe",
            "Co ban nhac",
            "Thuong lam khi ranh",
            "Co loi bai hat"
        ]
    },
    {
        emoji: "🏖️☀️",
        answer: "Bãi biển",
        hints: [
            "Noi du lich",
            "Co cat vang",
            "Co song",
            "Co nang",
            "Thuong tam bien"
        ]
    },
    {
        emoji: "💤📚",
        answer: "Buồn ngủ",
        hints: [
            "Trang thai co the",
            "Hay gap khi khuya",
            "Co the ngap dau",
            "Mat ri diu",
            "Muốn di ngu"
        ]
    }
];

global.duoiHinhBatChuSessions = global.duoiHinhBatChuSessions || {};
const { checkCooldown } = require('../../utils/cooldown');

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
    description: "Game Đuổi Hình Bắt Chữ (Reply để trả lời)",

    execute: async ({ api, event, args }) => {
        const { threadID } = event;
        
        // Cooldown 5s
        const cooldown = checkCooldown({ command: "duoihinhbatchu", key: threadID, durationMs: 5000 });
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
        const { threadID, senderID, body, messageReply } = event;
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
