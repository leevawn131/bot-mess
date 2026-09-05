"use strict";

var utils = require("../utils");
var log = require("npmlog");

function formatAttachment(att) {
    if (!att) return null;
    var blob = att.blob_attachment || att;
    var type = blob.__typename || att.attach_type || att.__typename;

    switch (type) {
        case "MessageImage":
            return {
                type: "photo",
                ID: blob.legacy_attachment_id || null,
                filename: blob.filename || null,
                thumbnailUrl: blob.thumbnail ? blob.thumbnail.uri : null,
                previewUrl: blob.preview ? blob.preview.uri : null,
                previewWidth: blob.preview ? blob.preview.width : null,
                previewHeight: blob.preview ? blob.preview.height : null,
                largePreviewUrl: blob.large_preview ? blob.large_preview.uri : null,
                largePreviewWidth: blob.large_preview ? blob.large_preview.width : null,
                largePreviewHeight: blob.large_preview ? blob.large_preview.height : null,
                url: (blob.large_preview && blob.large_preview.uri) || (blob.preview && blob.preview.uri) || (blob.thumbnail && blob.thumbnail.uri) || null,
                width: blob.original_dimensions ? blob.original_dimensions.x : (blob.large_preview ? blob.large_preview.width : null),
                height: blob.original_dimensions ? blob.original_dimensions.y : (blob.large_preview ? blob.large_preview.height : null),
                name: blob.filename || null,
                raw: att
            };
        case "MessageVideo":
            return {
                type: "video",
                ID: blob.legacy_attachment_id || null,
                filename: blob.filename || null,
                previewUrl: blob.large_image ? blob.large_image.uri : null,
                previewWidth: blob.large_image ? blob.large_image.width : null,
                previewHeight: blob.large_image ? blob.large_image.height : null,
                url: blob.playable_url || null,
                width: blob.original_dimensions ? blob.original_dimensions.x : null,
                height: blob.original_dimensions ? blob.original_dimensions.y : null,
                duration: blob.playable_duration_in_ms || null,
                videoType: blob.video_type ? blob.video_type.toLowerCase() : "video",
                raw: att
            };
        case "MessageAudio":
            return {
                type: "audio",
                ID: blob.url_shimhash || blob.legacy_attachment_id || null,
                filename: blob.filename || null,
                audioType: blob.audio_type || null,
                duration: blob.playable_duration_in_ms || null,
                url: blob.playable_url || null,
                isVoiceMail: !!blob.is_voicemail,
                raw: att
            };
        case "MessageAnimatedImage":
            return {
                type: "animated_image",
                ID: blob.legacy_attachment_id || null,
                filename: blob.filename || null,
                previewUrl: blob.preview_image ? blob.preview_image.uri : null,
                url: blob.animated_image ? blob.animated_image.uri : null,
                width: blob.animated_image ? blob.animated_image.width : null,
                height: blob.animated_image ? blob.animated_image.height : null,
                raw: att
            };
        case "MessageFile":
            return {
                type: "file",
                ID: blob.message_file_fbid || blob.legacy_attachment_id || null,
                filename: blob.filename || null,
                url: blob.url || null,
                isMalicious: !!blob.is_malicious,
                contentType: blob.content_type || null,
                raw: att
            };
        case "StickerAttachment":
            return {
                type: "sticker",
                ID: blob.id || (blob.metadata && blob.metadata.stickerID) || null,
                url: blob.url || null,
                packID: blob.pack ? blob.pack.id : null,
                raw: att
            };
        default:
            try {
                return utils._formatAttachment({ blob_attachment: blob });
            } catch (ex) {
                return {
                    type: type || "unknown",
                    raw: att
                };
            }
    }
}

module.exports = function(defaultFuncs, api, ctx) {
    return function getMessage(threadID, messageID, callback) {
        var resolveFunc = function() {};
        var rejectFunc = function() {};
        var returnPromise = new Promise(function(resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (!callback) {
            callback = function(err, data) {
                if (err) return rejectFunc(err);
                resolveFunc(data);
            };
        }

        if (!threadID || !messageID) {
            var err = { error: "getMessage: threadID and messageID are required" };
            log.error("getMessage", err);
            callback(err);
            return returnPromise;
        }

        const form = {
            av: ctx.userID,
            queries: JSON.stringify({
                o0: {
                    doc_id: "1768656253222505",
                    query_params: {
                        thread_and_message_id: {
                            thread_id: String(threadID),
                            message_id: String(messageID)
                        }
                    }
                }
            })
        };

        defaultFuncs
            .post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, form)
            .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
            .then(function(resData) {
                if (!resData || !Array.isArray(resData) || resData.length === 0) {
                    throw { error: "getMessage: Empty or invalid response from Facebook", res: resData };
                }

                if (resData[resData.length - 1].error_results > 0) {
                    throw (resData[0] && resData[0].o0 && resData[0].o0.errors) || resData;
                }

                if (resData[resData.length - 1].successful_results === 0) {
                    throw { error: "getMessage: Message not found or no successful_results", res: resData };
                }

                var fetchData = resData[0] && resData[0].o0 && resData[0].o0.data && resData[0].o0.data.message;
                if (!fetchData) {
                    throw { error: "getMessage: Message data not found in response", res: resData };
                }

                var attachments = [];
                if (Array.isArray(fetchData.blob_attachments)) {
                    attachments = attachments.concat(
                        fetchData.blob_attachments.map(formatAttachment).filter(Boolean)
                    );
                }

                if (fetchData.extensible_attachment) {
                    try {
                        attachments.push(formatAttachment({ extensible_attachment: fetchData.extensible_attachment }));
                    } catch (ex) {
                        attachments.push({
                            type: "extensible_attachment",
                            raw: fetchData.extensible_attachment
                        });
                    }
                }

                if (fetchData.sticker) {
                    try {
                        attachments.push(formatAttachment({ sticker_attachment: fetchData.sticker }));
                    } catch (ex) {
                        attachments.push({
                            type: "sticker",
                            raw: fetchData.sticker
                        });
                    }
                }

                var formattedMessage = {
                    threadID: String(threadID),
                    messageID: fetchData.message_id || String(messageID),
                    senderID: fetchData.message_sender ? String(fetchData.message_sender.id) : null,
                    body: (fetchData.message && fetchData.message.text !== undefined) ? fetchData.message.text : "",
                    attachments: attachments,
                    mentions: (fetchData.message && Array.isArray(fetchData.message.ranges)) ? fetchData.message.ranges : [],
                    timestamp: fetchData.timestamp_precise || fetchData.timestamp || null,
                    messageReply: fetchData.replied_to_message ? {
                        messageID: fetchData.replied_to_message.message_id,
                        senderID: fetchData.replied_to_message.message_sender ? String(fetchData.replied_to_message.message_sender.id) : null,
                        body: (fetchData.replied_to_message.message && fetchData.replied_to_message.message.text) ? fetchData.replied_to_message.message.text : "",
                        raw: fetchData.replied_to_message
                    } : null,
                    reactions: Array.isArray(fetchData.message_reactions) ? fetchData.message_reactions : [],
                    raw: fetchData
                };

                return callback(null, formattedMessage);
            })
            .catch(function(err) {
                log.error("getMessage", err);
                return callback(err);
            });

        return returnPromise;
    };
};