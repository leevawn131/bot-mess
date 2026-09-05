/* eslint-disable linebreak-style */
"use strict";

var utils = require("../utils");

module.exports = function (defaultFuncs, api, ctx) {
	return function(threadID, messageID ,callback) {
		var resolveFunc = function () { };
		var rejectFunc = function () { };

		var returnPromise = new Promise(function (resolve, reject) {
			resolveFunc = resolve;
			rejectFunc = reject;
		});

        if (!callback && utils.getType(messageID) === "AsyncFunction" || !callback && utils.getType(messageID) === "Function") messageID = callback;
		
        if (!callback) {
			callback = function (err, data) {
				if (err) return rejectFunc(err);
				resolveFunc(data);
			};
		}

		if (!ctx.mqttClient || !ctx.mqttClient.connected) {
			var connErr = new Error("MQTT client is not connected");
			callback(connErr, null);
			return returnPromise;
		}

        const Payload = {
            message_id: messageID,
            thread_key: threadID,
            sync_group: 1
        };

        if (messageID != undefined && messageID != null) {
            Payload.reply_metadata = {
                reply_source_id: messageID,
                reply_source_type: 1,
                reply_type: 0
            };
        }

        var reqID = ++ctx.req_ID;
        const Form = JSON.stringify({
            app_id: "2220391788200892",
            payload: JSON.stringify({
                tasks: [{
                    label: 33,
                    payload: JSON.stringify(Payload),
                    queue_name: "unsend_message",
                    task_id: Math.random() * 1001 << 0,
                    failure_count: null,
                }],
                epoch_id: utils.generateOfflineThreadingID(),
                version_id: '9094446350588544',
            }),
            request_id: reqID,
            type: 3
        });

        var isFinished = false;
        var fallbackTimer = null;

        var cleanupAndResolve = function (err, data) {
            if (isFinished) return;
            isFinished = true;
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            if (ctx.callback_Task && ctx.callback_Task[reqID]) {
                delete ctx.callback_Task[reqID];
            }
            callback(err, data);
        };

        // Safety timeout 1.5s
        fallbackTimer = setTimeout(function () {
            cleanupAndResolve(null, { success: true });
        }, 1500);

        ctx.callback_Task[reqID] = new Object({
            callback: cleanupAndResolve,
            type: "unsendMqttMessage",
        });

        try {
            ctx.mqttClient.publish('/ls_req', Form, {
                qos: 1,
                retain: false,
            }, function (pubErr) {
                if (pubErr) {
                    cleanupAndResolve(pubErr, null);
                }
            });
        } catch (pubErr) {
            cleanupAndResolve(pubErr, null);
        }
        
		return returnPromise;
	};
};