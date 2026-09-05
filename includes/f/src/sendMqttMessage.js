/* eslint-disable linebreak-style */
"use strict";

var utils = require("../utils");

module.exports = function (defaultFuncs, api, ctx) {
	return function(text, threadID, messageID, style, callback) {
		var resolveFunc = function () { };
		var rejectFunc = function () { };

		var returnPromise = new Promise(function (resolve, reject) {
			resolveFunc = resolve;
			rejectFunc = reject;
		});

		if (typeof messageID === "function") {
			callback = messageID;
			messageID = null;
			style = null;
		} else if (typeof style === "function") {
			callback = style;
			style = null;
		}
		
		var customCallback = callback;
		callback = function (err, data) {
			if (customCallback) customCallback(err, data);
			if (err) return rejectFunc(err);
			resolveFunc(data);
		};

		if (!ctx.mqttClient || !ctx.mqttClient.connected) {
			var connErr = new Error("MQTT client is not connected");
			callback(connErr, null);
			return returnPromise;
		}

		var otid = utils.generateOfflineThreadingID();
		const Payload = {
			thread_id: threadID,
			otid: otid,
			source: 524289,
			send_type: 1,
			sync_group: 1,
			mark_thread_read: 0,
			text: text || "",
			initiating_source: 0
		};

		if (style) {
			Payload.power_up_style = style;
		}

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
					label: 46,
					payload: JSON.stringify(Payload),
					queue_name: String(threadID),
					task_id: Math.random() * 1001 << 0,
					failure_count: null,
				}],
				epoch_id: utils.generateOfflineThreadingID(),
				version_id: '7553237234719461',
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

		// Safety timeout: Facebook WebSocket không còn phản hồi /ls_resp cho task 46,
		// nhưng bản tin đã được gửi qua MQTT broker. Tự động hoàn thành sau 1.5s để dọn dẹp RAM và tránh treo callback.
		fallbackTimer = setTimeout(function () {
			cleanupAndResolve(null, {
				threadID: String(threadID),
				messageID: otid,
				timestamp: Date.now()
			});
		}, 1500);

		ctx.callback_Task[reqID] = new Object({
			callback: cleanupAndResolve,
			type: "sendMqttMessage"
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