/* eslint-disable linebreak-style */
"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
    return function shareContact(text, senderID, threadID, callback) {
        var resolveFunc = function () { };
        var rejectFunc = function () { };

        var returnPromise = new Promise(function (resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        // Xử lý nạp chồng tham số (Parameter Overloading)
        if (typeof threadID === "function" || utils.getType(threadID) === "AsyncFunction") {
            callback = threadID;
            threadID = senderID;
            senderID = text;
            text = "";
        } else if (typeof senderID === "function" || utils.getType(senderID) === "AsyncFunction") {
            callback = senderID;
            senderID = text;
            text = "";
        }

        var customCallback = callback;
        callback = function (err, data) {
            if (typeof customCallback === "function" || utils.getType(customCallback) === "AsyncFunction") {
                try {
                    customCallback(err, data);
                } catch (cbErr) {
                    log.error("shareContact", "Lỗi trong custom callback: ", cbErr);
                }
            }
            if (err) return rejectFunc(err);
            resolveFunc(data);
        };

        if (typeof text === "object" && text !== null) {
            text = text.body || text.text || "";
        }
        text = typeof text === "string" ? text : (text ? String(text) : "");

        if (!senderID) {
            var errNoSender = { error: "shareContact: senderID (contact ID) không được để trống." };
            log.error("shareContact", errNoSender.error);
            callback(errNoSender);
            return returnPromise;
        }

        if (!threadID) {
            var errNoThread = { error: "shareContact: threadID không được để trống." };
            log.error("shareContact", errNoThread.error);
            callback(errNoThread);
            return returnPromise;
        }

        var contactIDStr = String(senderID).trim();
        var threadStr = String(threadID).trim();

        // Kiểm tra điều kiện luồng E2EE
        var isE2EEThread = (ctx.e2eeThreads && ctx.e2eeThreads.has(threadStr)) ||
            (threadStr && (threadStr.includes("@msgr") || threadStr.includes("@g.us") || threadStr.includes("@broadcast")));

        function sendStandardMQTT() {
            if (ctx.mqttClient && ctx.mqttClient.connected) {
                var reqID = ++ctx.req_ID;

                // Gửi chuẩn thẻ danh thiếp Contact Card Task 359 (có Avatar, Tên và nút Nhắn tin chính chủ của Facebook)
                var form = JSON.stringify({
                    app_id: "2220391788200892",
                    payload: JSON.stringify({
                        tasks: [{
                            label: "359",
                            payload: JSON.stringify({
                                "contact_id": contactIDStr,
                                "sync_group": 1,
                                "text": text || "",
                                "thread_id": threadStr
                            }),
                            queue_name: "xma_open_contact_share",
                            task_id: Math.floor(Math.random() * 1001),
                            failure_count: null
                        }],
                        epoch_id: utils.generateOfflineThreadingID(),
                        version_id: "7214102258676893"
                    }),
                    request_id: reqID,
                    type: 3
                });

                ctx.mqttClient.publish("/ls_req", form, { qos: 1, retain: false });

                if (!ctx.callback_Task) ctx.callback_Task = {};
                ctx.callback_Task[reqID] = {
                    callback: callback,
                    type: "shareContact",
                    threadID: threadStr,
                    contactID: contactIDStr
                };
                return returnPromise;
            }

            // Nếu không có MQTT, fallback sang api.sendMessage
            if (typeof api.sendMessage === "function") {
                log.warn("shareContact", "[MQTT] Kết nối MQTT chưa sẵn sàng, tự động chuyển sang sendMessage thường...");
                return api.sendMessage(text || "", threadStr, callback);
            }

            var errNoConn = { error: "shareContact: Kết nối MQTT chưa sẵn sàng và không thể gửi tin nhắn." };
            log.warn("shareContact", errNoConn.error);
            callback(errNoConn);
            return returnPromise;
        }

        // Nếu E2EE Client khả dụng và thread là E2EE
        if (ctx.e2eeClient && isE2EEThread) {
            var targetE2EEThread = (ctx.threadToUserMap && ctx.threadToUserMap.get(threadStr)) || threadStr;
            log.info("shareContact", "[E2EE] Gửi thẻ liên hệ E2EE (" + contactIDStr + ") tới thread " + targetE2EEThread + " (gốc: " + threadStr + ")");

            ctx.e2eeClient.sendMessage({
                threadId: targetE2EEThread,
                text: text || ""
            }).then(function (res) {
                if (ctx.e2eeThreads) {
                    ctx.e2eeThreads.add(threadStr);
                }
                var messageInfo = {
                    threadID: threadStr,
                    messageID: (res && res.messageId) ? res.messageId : utils.generateOfflineThreadingID(),
                    timestamp: Date.now(),
                    isE2EE: true,
                    contactID: contactIDStr
                };
                return callback(null, messageInfo);
            }).catch(function (err) {
                log.warn("shareContact", "[E2EE] Lỗi E2EE (" + (err.message || err) + "), tự động chuyển sang gửi qua MQTT...");
                sendStandardMQTT();
            });

            return returnPromise;
        }

        return sendStandardMQTT();
    };
};
