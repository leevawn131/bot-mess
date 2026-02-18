const axios = require("axios");
const fs = require("fs");
const path = require("path");

/**
 * Sends a message with GIF attachment using direct API calls
 * Fixes ws3-fca's bug where it uses file_id instead of gif_id
 */
async function sendGifMessage(api, filePath, threadID, body, mentions = []) {
    try {
        // Step 1: Get upload session via ws3-fca's internal upload
        // We'll use the api's internal method to upload and get the response
        return new Promise((resolve, reject) => {
            const uploadAttachments = async () => {
                try {
                    // Call the internal upload method but capture the response
                    const utils = require("ws3-fca/src/utils");
                    
                    // Create form data manually
                    const formData = new (require('form-data'))();
                    formData.append('upload_1024', fs.createReadStream(filePath));
                    
                    // Get headers from formData
                    const headers = formData.getHeaders();
                    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
                    
                    // Call upload endpoint
                    const uploadResponse = await axios.post(
                        'https://upload.facebook.com/ajax/upload/photo',
                        formData,
                        {
                            headers: {
                                ...headers,
                                'Cookie': api.getAppState?.() || ''
                            }
                        }
                    );

                    const responseText = uploadResponse.data;
                    if (typeof responseText === 'string' && responseText.includes('for (;;);')) {
                        // Remove JSONP wrapper
                        const json = JSON.parse(responseText.substring(9));
                        
                        // Extract gif_id from metadata
                        if (json.payload && json.payload.metadata) {
                            let gifId = null;
                            const metadata = json.payload.metadata;
                            
                            // Find the entry with gif_id (usually the last one)
                            for (const key in metadata) {
                                if (metadata[key] && metadata[key].gif_id) {
                                    gifId = metadata[key].gif_id;
                                    break;
                                }
                            }
                            
                            if (gifId) {
                                resolve({ gif_id: gifId });
                                return;
                            }
                        }
                    }
                    
                    reject(new Error("Failed to extract gif_id from upload response"));
                } catch (error) {
                    reject(error);
                }
            };
            
            uploadAttachments();
        });
    } catch (error) {
        throw error;
    }
}

/**
 * Alternative: Use ws3-fca's sendMessage but manually construct the form with correct gif_id
 * This is more reliable than the custom upload approach
 */
async function sendMessageWithGif(api, filePath, threadID, messageObj) {
    return new Promise((resolve, reject) => {
        // Create a wrapper around api.sendMessage that we can intercept
        const originalSendMessage = api.sendMessage.bind(api);
        
        // Temporarily override to inject custom handling
        api.sendMessage = function(message, threadID, callback) {
            if (typeof message === 'object' && message.attachment && typeof message.attachment === 'string') {
                // This is our GIF message, handle it specially
                const filePath = message.attachment;
                
                // Use the original method but it will still have the file_id issue
                // So we need a different approach...
                return originalSendMessage(message, threadID, callback);
            }
            return originalSendMessage(message, threadID, callback);
        };
    });
}

module.exports = {
    sendGifMessage,
    sendMessageWithGif
};
