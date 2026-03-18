const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mysql = require('mysql2/promise');
const { checkCooldown } = require('../../utils/cooldown');
const { consumeEnergy, getDBConfigFromRuntime } = require('../../utils/energySystem');

module.exports = {
    name: "mp3",
    description: "Tải nhạc từ YouTube/SoundCloud và gửi file MP3",
    usage: "[song name] hoặc [link YouTube/SoundCloud]",
    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;

        // Cooldown 20s
        const cooldown = checkCooldown({ command: "mp3", key: senderID, durationMs: 20000 });
        if (!cooldown.allowed) {
            return api.sendMessage(`⏳ Vui lòng chờ ${cooldown.timeLeft}s trước khi dùng lại lệnh này.`, threadID, messageID);
        }
        
        if (args.length === 0) {
            return api.sendMessage("❌ Vui lòng nhập tên bài hát hoặc link (YouTube/SoundCloud)", threadID, messageID);
        }

        const input = args.join(" ");
        if (input.includes("soundcloud.com")) {
            return api.sendMessage("⚠️ SoundCloud chưa được hỗ trợ. Vui lòng dùng link YouTube!", threadID, messageID);
        }

        const dbConfig = getDBConfigFromRuntime(config);
        if (!dbConfig) {
            return api.sendMessage("❌ Lỗi cấu hình Database.", threadID, messageID);
        }

        let energyUse;
        let energyConnection;
        try {
            energyConnection = await mysql.createConnection(dbConfig);
            energyUse = await consumeEnergy(energyConnection, senderID, 20);
            if (!energyUse.ok) {
                if (energyUse.reason === 'not_enough') {
                    return api.sendMessage(energyUse.message, threadID, messageID);
                }
                return api.sendMessage("❌ Không thể kiểm tra thể lực lúc này.", threadID, messageID);
            }
        } catch (error) {
            console.error("Energy check error (mp3):", error);
            return api.sendMessage("❌ Lỗi hệ thống thể lực.", threadID, messageID);
        } finally {
            if (energyConnection) await energyConnection.end();
        }

        const cacheDir = path.resolve(__dirname, '../../../cache/mp3');
        
        // Tạo thư mục cache nếu chưa tồn tại
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        try {
            api.sendMessage("⏳ Đang xử lý...", threadID, messageID);

            let videoUrl = input;
            let songTitle = "";

            // Kiểm tra nếu input là link
            if (!input.includes("youtube.com") && !input.includes("youtu.be") && 
                !input.includes("soundcloud.com")) {
                // Nếu không phải link, tìm kiếm trên YouTube
                console.log("🔍 Tìm kiếm:", input);
                videoUrl = await searchYouTube(input);
                if (!videoUrl) {
                    return api.sendMessage("❌ Không tìm thấy bài hát!", threadID, messageID);
                }
            }

            // Xử lý YouTube
            if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
                console.log("📹 Xử lý YouTube:", videoUrl);
                const audioPath = await downloadYouTubeToMP3(videoUrl, cacheDir);
                
                if (!audioPath || !fs.existsSync(audioPath)) {
                    return api.sendMessage("❌ Lỗi tải video từ YouTube", threadID, messageID);
                }
                
                // Kiểm tra kích thước file
                const fileStats = fs.statSync(audioPath);
                const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(2);
                
                if (fileStats.size === 0) {
                    // Xóa file lỗi
                    try { fs.unlinkSync(audioPath); } catch (e) {}
                    return api.sendMessage("❌ File audio rỗng", threadID, messageID);
                }
                
                // Facebook Messenger có giới hạn 25MB cho file đính kèm
                if (fileStats.size > 25 * 1024 * 1024) {
                    // Xóa file quá lớn ngay lập tức
                    try { 
                        fs.unlinkSync(audioPath); 
                        console.log(`🗑️ Đã xóa file quá lớn: ${fileSizeMB} MB`);
                    } catch (e) {}
                    return api.sendMessage(
                        `❌ File quá lớn!\n` +
                        `📊 Kích thước: ${fileSizeMB} MB\n` +
                        `⚠️ Giới hạn Facebook: 25 MB\n\n` +
                        `💡 Đề xuất:\n` +
                        `• Tìm video ngắn hơn\n`, 
                        threadID, 
                        messageID
                    );
                }
                
                console.log(`📊 File size: ${fileSizeMB} MB`);
                
                // Lấy extension của file
                const fileExt = path.extname(audioPath).toUpperCase().replace('.', '');
                
                // Gửi file audio - sử dụng array và đường dẫn trực tiếp
                await api.sendMessage({
                    body: `🎵 File ${fileExt}:\n📁 Kích thước: ${fileSizeMB} MB\n⚡ Thể lực: -20 (${energyUse.energy}/${energyUse.maxEnergy})`,
                    attachment: fs.createReadStream(audioPath)
                }, threadID);

                // Xóa file sau khi gửi
                setTimeout(() => {
                    try { 
                        if (fs.existsSync(audioPath)) {
                            fs.unlinkSync(audioPath);
                            console.log("🗑️ Đã xóa file cache:", audioPath);
                        }
                    } catch (e) {
                        console.error("❌ Lỗi xóa file:", e);
                    }
                }, 10000);

            } 
            // Xử lý SoundCloud
            else if (videoUrl.includes("soundcloud.com")) {
                console.log("🎵 Xử lý SoundCloud:", videoUrl);
                api.sendMessage("⚠️ SoundCloud chưa được hỗ trợ. Vui lòng dùng link YouTube!", threadID, messageID);
            }

        } catch (error) {
            console.error("❌ Lỗi mp3:", error);
            api.sendMessage(`❌ Lỗi: ${error.message}`, threadID, messageID);
        }
    }
};

/**
 * Tìm kiếm YouTube
 */
async function searchYouTube(query) {
    try {
        const response = await axios.get(`https://www.youtube.com/results`, {
            params: { search_query: query }
        });

        // Tìm video ID từ HTML
        const videoIdMatch = response.data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        if (videoIdMatch) {
            return `https://www.youtube.com/watch?v=${videoIdMatch[1]}`;
        }
        return null;
    } catch (error) {
        console.error("Lỗi tìm kiếm YouTube:", error);
        return null;
    }
}

/**
 * Tải video từ YouTube và convert thành MP3 bằng youtube-dl hoặc yt-dlp
 */
async function downloadYouTubeToMP3(url, cacheDir) {
    return new Promise((resolve, reject) => {
        try {
            const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
            if (!videoId) {
                return reject(new Error("URL YouTube không hợp lệ"));
            }

            const audioPath = path.join(cacheDir, `${videoId}.mp3`);
            const m4aPath = path.join(cacheDir, `${videoId}.m4a`);

            // Nếu file đã tồn tại (MP3 hoặc M4A), trả về luôn
            if (fs.existsSync(audioPath)) {
                console.log("✅ Sử dụng MP3 cache:", audioPath);
                return resolve(audioPath);
            }
            if (fs.existsSync(m4aPath)) {
                console.log("✅ Sử dụng M4A cache:", m4aPath);
                return resolve(m4aPath);
            }

            console.log("📥 Tải audio từ YouTube...");

            let command = null;
            
            // Thử yt-dlp trước với format M4A (Facebook hỗ trợ tốt hơn)
            try {
                execSync('which yt-dlp', { stdio: 'pipe' });
                // Tải trực tiếp dạng M4A thay vì convert từ MP3
                command = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -o "${m4aPath}" "${url}"`;
                console.log("📦 Sử dụng yt-dlp (M4A format)");
                
                try {
                    execSync(command, { stdio: 'pipe', timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
                    
                    if (fs.existsSync(m4aPath)) {
                        console.log("✅ Tải M4A thành công:", m4aPath);
                        return resolve(m4aPath);
                    }
                } catch (e) {
                    console.log("⚠️ Tải M4A thất bại, thử MP3...");
                }
                
                // Nếu M4A thất bại, thử MP3
                command = `yt-dlp -x --audio-format mp3 --audio-quality 128K -o "${audioPath.replace('.mp3', '')}.%(ext)s" "${url}"`;
                console.log("📦 Sử dụng yt-dlp (MP3 format)");
            } catch (e) {
                // Nếu không có yt-dlp, thử youtube-dl
                try {
                    execSync('which youtube-dl', { stdio: 'pipe' });
                    command = `youtube-dl -x -f bestaudio --audio-format mp3 --audio-quality 128K -o "${audioPath.replace('.mp3', '')}.%(ext)s" "${url}"`;
                    console.log("📦 Sử dụng youtube-dl");
                } catch (e2) {
                    return reject(new Error("Cần cài đặt yt-dlp hoặc youtube-dl"));
                }
            }
            
            try {
                execSync(command, { stdio: 'pipe', timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
                
                // Kiểm tra file nào được tạo (M4A hoặc MP3)
                if (fs.existsSync(m4aPath)) {
                    console.log("✅ Tải và chuyển đổi thành công:", m4aPath);
                    resolve(m4aPath);
                } else if (fs.existsSync(audioPath)) {
                    console.log("✅ Tải và chuyển đổi thành công:", audioPath);
                    resolve(audioPath);
                } else {
                    reject(new Error("Không tạo được file audio"));
                }
            } catch (execError) {
                console.error("Lỗi tải video:", execError.message);
                reject(new Error("Lỗi tải video: " + execError.message));
            }

        } catch (error) {
            reject(error);
        }
    });
}
