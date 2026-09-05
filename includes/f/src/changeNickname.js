"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function changeNickname(nickname, threadID, participantID, callback) {
    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });
    if (!callback) {
      callback = function (err) {
        if (err) return rejectFunc(err);
        resolveFunc();
      };
    }

    if (!ctx.mqttClient) {
      var err = { error: "Not connected to MQTT." };
      log.error("changeNickname", err);
      return callback(err);
    }

    var numThreadID = Number(threadID) || threadID;
    var numParticipantID = Number(participantID) || participantID;

    const Payload = {
      thread_key: numThreadID,
      contact_id: numParticipantID,
      nickname: nickname || "",
      sync_group: 1,
      offline_threading_id: null
    };

    const Form = JSON.stringify({
      app_id: "2220391788200892",
      payload: JSON.stringify({
        tasks: [{
          label: "44",
          payload: JSON.stringify(Payload),
          queue_name: "thread_participant_nickname",
          task_id: Math.floor(Math.random() * 1001),
          failure_count: null,
        }],
        epoch_id: utils.generateOfflineThreadingID(),
        version_id: "25487397054291303"
      }),
      request_id: ++ctx.req_ID,
      type: 3
    });

    ctx.mqttClient.publish('/ls_req', Form, {
      qos: 1,
      retain: false,
    });

    ctx.callback_Task[ctx.req_ID] = {
      callback: callback,
      type: "changeNickname"
    };

    return returnPromise;
  };
};
