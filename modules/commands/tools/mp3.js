const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

module.exports = {
    name: "mp3",
    description: "Tải nhạc từ YouTube/SoundCloud và gửi file MP3",
    usage: "[song name] hoặc [link YouTube/SoundCloud]",
    execute: async ({ api, event, args }) => {
        const { threadID, messageID, senderID } = event;
        
        if (args.length === 0) {
            return api.sendMessage("❌ Vui lòng nhập tên bài hát hoặc link (YouTube/SoundCloud)", threadID, messageID);
        }

        const input = args.join(" ");
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
                
                // Tạo stream và gán path property để sendMessage.js nhận diện đúng loại file
                const stream = fs.createReadStream(audioPath);
                stream.path = audioPath; // Quan trọng: gán path để nhận diện đúng filename
                
                await api.sendMessage({
                    body: "🎵 File MP3:",
                    attachment: stream
                }, threadID);

                // Xóa file sau khi gửi
                setTimeout(() => {
                    try { fs.unlinkSync(audioPath); } catch (e) {}
                }, 5000);

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

            // Nếu file đã tồn tại, trả về luôn
            if (fs.existsSync(audioPath)) {
                console.log("✅ Sử dụng file cache:", audioPath);
                return resolve(audioPath);
            }

            console.log("📥 Tải audio từ YouTube...");

            let command = null;
            
            // Thử yt-dlp trước
            try {
                execSync('which yt-dlp', { stdio: 'pipe' });
                command = `yt-dlp --js-runtimes node -x --audio-format mp3 --audio-quality 128K --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -o "${audioPath.replace('.mp3', '')}.%(ext)s" "${url}"`;
                console.log("📦 Sử dụng yt-dlp");
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
                
                if (fs.existsSync(audioPath)) {
                    console.log("✅ Tải và chuyển đổi thành công:", audioPath);
                    resolve(audioPath);
                } else {
                    reject(new Error("Không tạo được file MP3"));
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
