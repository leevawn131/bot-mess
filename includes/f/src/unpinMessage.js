"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
    return function unpinMessage(messageID, threadID, callback) {
        var resolveFunc = function () { };
        var rejectFunc = function () { };

        var returnPromise = new Promise(function (resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (typeof threadID === "function") {
            callback = threadID;
            threadID = null;
        }

        if (!callback) {
            callback = function (err, data) {
                if (err) return rejectFunc(err);
                resolveFunc(data);
            };
        }

        if (!ctx.mqttClient) {
            var err = { error: "Not connected to MQTT." };
            log.error("unpinMessage", err);
            return callback(err);
        }

        var numThreadID = Number(threadID) || threadID;
        var strThreadID = String(threadID);

        // 1. Request 1 Bỏ Ghim: set_pinned_message_search với label "751" và pinned_message_state: 0
        var form1 = JSON.stringify({
            app_id: "2220391788200892",
            payload: JSON.stringify({
                epoch_id: Number(utils.generateOfflineThreadingID()) || Date.now(),
                tasks: [
                    {
                        failure_count: null,
                        label: "751",
                        payload: JSON.stringify({
                            thread_key: numThreadID,
                            message_id: messageID,
                            pinned_message_state: 0
                        }),
                        queue_name: "set_pinned_message_search",
                        task_id: Math.floor(Math.random() * 1001)
                    }
                ],
                version_id: "27805345262411708"
            }),
            request_id: ++ctx.req_ID,
            type: 3
        });

        // 2. Request 2 Bỏ Ghim: unpin_msg_v2_threadID với label "431"
        var form2 = JSON.stringify({
            app_id: "2220391788200892",
            payload: JSON.stringify({
                epoch_id: Number(utils.generateOfflineThreadingID()) || Date.now(),
                tasks: [
                    {
                        failure_count: null,
                        label: "431",
                        payload: JSON.stringify({
                            thread_key: numThreadID,
                            message_id: messageID,
                            timestamp_ms: Date.now()
                        }),
                        queue_name: "unpin_msg_v2_" + strThreadID,
                        task_id: Math.floor(Math.random() * 1001)
                    }
                ],
                version_id: "27805345262411708"
            }),
            request_id: ++ctx.req_ID,
            type: 3
        });

        ctx.mqttClient.publish("/ls_req", form1, { qos: 1, retain: false });
        ctx.mqttClient.publish("/ls_req", form2, { qos: 1, retain: false });

        ctx.callback_Task[ctx.req_ID] = {
            callback: callback,
            type: "unpinMessage"
        };

        return returnPromise;
    };
};
