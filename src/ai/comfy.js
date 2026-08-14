const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');

// Cấu hình URL của ComfyUI (mặc định running local)
const COMFY_HOST = process.env.COMFYUI_HOST || '127.0.0.1:8188';
const HTTP_BASE_URL = `http://${COMFY_HOST}`;
const WS_BASE_URL = `ws://${COMFY_HOST}`;

// Đường dẫn file Workflow.json ở thư mục gốc project
function getWorkflowPath() {
    const uppercasePath = path.resolve(process.cwd(), 'Workflow.json');
    if (fs.existsSync(uppercasePath)) {
        return uppercasePath;
    }
    return path.resolve(process.cwd(), 'workflow.json');
}

/**
 * Đọc workflow JSON từ file và cập nhật prompt cho node CLIP Text Encode.
 * @param {string} promptText - Nội dung prompt của người dùng.
 * @returns {object} - Object workflow đã thay đổi prompt.
 */
function prepareWorkflow(promptText) {
    const workflowPath = getWorkflowPath();
    if (!fs.existsSync(workflowPath)) {
        throw new Error(`File workflow JSON không tồn tại tại: ${workflowPath}`);
    }

    const rawData = fs.readFileSync(workflowPath, 'utf8');
    const workflow = JSON.parse(rawData);

    // Cập nhật prompt ở node "4" (CLIP Text Encode - Prompt)
    let promptUpdated = false;
    if (workflow['4'] && workflow['4'].inputs && workflow['4'].class_type === 'CLIPTextEncode') {
        workflow['4'].inputs.text = promptText;
        promptUpdated = true;
    } else {
        // Tìm node CLIP Text Encode liên kết với positive của KSampler
        let positiveNodeId = null;
        for (const node of Object.values(workflow)) {
            if (node.class_type === 'KSampler' && node.inputs && node.inputs.positive) {
                positiveNodeId = node.inputs.positive[0];
                break;
            }
        }

        if (positiveNodeId && workflow[positiveNodeId] && workflow[positiveNodeId].inputs) {
            workflow[positiveNodeId].inputs.text = promptText;
            promptUpdated = true;
        } else {
            // Thử tìm theo title hoặc class_type
            for (const [nodeId, node] of Object.entries(workflow)) {
                if (
                    node.class_type === 'CLIPTextEncode' &&
                    node._meta &&
                    node._meta.title &&
                    node._meta.title.includes('(Prompt)') &&
                    nodeId !== '5'
                ) {
                    node.inputs.text = promptText;
                    promptUpdated = true;
                    break;
                }
            }
        }
    }

    if (!promptUpdated) {
        throw new Error('Không tìm thấy node CLIP Text Encode (Prompt) trong file workflow JSON');
    }

    // Tự động tạo seed ngẫu nhiên cho KSampler (node "7" hoặc node KSampler bất kỳ)
    if (workflow['7'] && workflow['7'].inputs && 'seed' in workflow['7'].inputs) {
        workflow['7'].inputs.seed = Math.floor(Math.random() * 1000000000000);
    } else {
        for (const node of Object.values(workflow)) {
            if (node.class_type === 'KSampler' && node.inputs && 'seed' in node.inputs) {
                node.inputs.seed = Math.floor(Math.random() * 1000000000000);
                break;
            }
        }
    }

    return workflow;
}

/**
 * Gửi yêu cầu render tới ComfyUI và theo dõi tiến trình qua WebSocket.
 * @param {string} promptText - Prompt tạo ảnh.
 * @param {number} timeoutMs - Thời gian chờ tối đa (mặc định 120 giây).
 * @returns {Promise<Buffer>} - Buffer chứa file ảnh đã render.
 */
async function sendToComfyUI(promptText, timeoutMs = 120000) {
    const clientId = crypto.randomUUID();
    const workflow = prepareWorkflow(promptText);

    return new Promise((resolve, reject) => {
        let ws;
        let timer;
        let outputImageInfo = null;
        let promptId = null;

        // Cleanup WebSocket và Timer khi kết thúc
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (ws) {
                ws.removeAllListeners();
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                }
            }
        };

        // Đặt timeout xử lý
        timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Quá thời gian render ComfyUI (${timeoutMs / 1000}s)`));
        }, timeoutMs);

        // Khởi tạo WebSocket kết nối ComfyUI
        ws = new WebSocket(`${WS_BASE_URL}/ws?clientId=${clientId}`);

        ws.on('open', async () => {
            try {
                // Gửi request HTTP POST /prompt tới ComfyUI
                const response = await axios.post(`${HTTP_BASE_URL}/prompt`, {
                    prompt: workflow,
                    client_id: clientId
                });

                if (!response.data || !response.data.prompt_id) {
                    cleanup();
                    return reject(new Error('ComfyUI không trả về prompt_id hợp lệ'));
                }

                promptId = response.data.prompt_id;
            } catch (err) {
                cleanup();
                const errMsg = err.response?.data?.error?.message || err.message || 'Lỗi gửi yêu cầu tới ComfyUI';
                return reject(new Error(`Lỗi khởi tạo render ComfyUI: ${errMsg}`));
            }
        });

        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());

                // Lưu thông tin ảnh khi node SaveImage (executed) hoàn thành
                if (message.type === 'executed' && message.data?.prompt_id === promptId) {
                    const images = message.data.output?.images;
                    if (Array.isArray(images) && images.length > 0) {
                        outputImageInfo = images[0]; // Lấy ảnh đầu tiên trong output
                    }
                }

                // Khi nhận được sự kiện executing với node = null -> Quá trình render promptId đã hoàn thành
                if (message.type === 'executing' && message.data?.prompt_id === promptId && message.data?.node === null) {
                    cleanup();

                    if (!outputImageInfo) {
                        // Thử lấy thông tin từ /history nếu không lấy được từ event executed
                        try {
                            const historyRes = await axios.get(`${HTTP_BASE_URL}/history/${promptId}`);
                            const historyData = historyRes.data?.[promptId];
                            const outputs = historyData?.outputs;
                            if (outputs) {
                                for (const nodeOut of Object.values(outputs)) {
                                    if (nodeOut.images && nodeOut.images.length > 0) {
                                        outputImageInfo = nodeOut.images[0];
                                        break;
                                    }
                                }
                            }
                        } catch (histErr) {
                            console.error('Lỗi khi lấy history ComfyUI:', histErr.message);
                        }
                    }

                    if (!outputImageInfo) {
                        return reject(new Error('Render thành công nhưng không tìm thấy thông tin tệp ảnh output'));
                    }

                    // Tải ảnh trực tiếp từ API ComfyUI (/view)
                    const { filename, subfolder, type } = outputImageInfo;
                    const imageUrl = `${HTTP_BASE_URL}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || '')}&type=${encodeURIComponent(type || 'output')}`;

                    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                    const buffer = Buffer.from(imgResponse.data);
                    return resolve(buffer);
                }

                // Lỗi thực thi workflow
                if (message.type === 'execution_error' && message.data?.prompt_id === promptId) {
                    cleanup();
                    const exceptionMsg = message.data?.exception_message || 'Lỗi thực thi node ComfyUI';
                    return reject(new Error(`ComfyUI Execution Error: ${exceptionMsg}`));
                }
            } catch (parseErr) {
                // Ignore JSON parse errors for non-JSON ws messages
            }
        });

        ws.on('error', (err) => {
            cleanup();
            reject(new Error(`Lỗi WebSocket kết nối tới ComfyUI: ${err.message}`));
        });
    });
}

/**
 * Hàm chính tạo ảnh từ prompt với cơ chế Retry khi bận hoặc lỗi kết nối.
 * @param {string} prompt - Prompt văn bản mô tả ảnh.
 * @param {number} maxRetries - Số lần thử lại (mặc định 2 lần).
 * @returns {Promise<Buffer>} - Trả về Buffer ảnh.
 */
async function generateImage(prompt, maxRetries = 2) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            const imageBuffer = await sendToComfyUI(prompt);
            return imageBuffer;
        } catch (error) {
            lastError = error;
            console.error(`[ComfyUI] Lần thử ${attempt}/${maxRetries + 1} thất bại:`, error.message);

            if (attempt <= maxRetries) {
                // Chờ 2 giây trước khi thử lại
                await new Promise((res) => setTimeout(res, 2000));
            }
        }
    }

    throw lastError;
}

module.exports = {
    generateImage
};
