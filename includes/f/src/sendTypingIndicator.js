"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  function publishTyping(isTyping, threadID, isGroup) {
    return new Promise(function (resolve, reject) {
      if (!ctx.mqttClient || !ctx.mqttClient.connected) {
        return reject(new Error("MQTT client is not connected. Call listenMqtt first."));
      }

      if (!threadID) {
        return reject(new Error("sendTypingIndicator requires a valid threadID."));
      }

      var isGroupThread =
        typeof isGroup === "boolean"
          ? isGroup
          : String(threadID).length >= 16;

      var wsContent = {
        app_id: "2220391788200892",
        payload: JSON.stringify({
          label: 3,
          payload: JSON.stringify({
            thread_key: String(threadID),
            is_group_thread: +isGroupThread,
            is_typing: +!!isTyping,
            attribution: 0
          }),
          version: "5849951561777440"
        }),
        request_id: ++ctx.req_ID,
        type: 4
      };

      ctx.mqttClient.publish(
        "/ls_req",
        JSON.stringify(wsContent),
        { qos: 1, retain: false },
        function (err, packet) {
          if (err) return reject(err);
          resolve(packet);
        }
      );
    });
  }

  return function sendTypingIndicator(arg1, arg2, arg3, arg4) {
    var isTyping = true;
    var threadID = "";
    var callback = function () {};
    var isGroup = undefined;
    var isBooleanCall = false;

    // Pattern 1: sendTypingIndicator(isTyping, threadID, [callback], [isGroup])
    if (typeof arg1 === "boolean") {
      isTyping = arg1;
      threadID = arg2;
      callback = typeof arg3 === "function" ? arg3 : function () {};
      isGroup = typeof arg4 === "boolean" ? arg4 : undefined;
      isBooleanCall = true;
    }
    // Pattern 2: sendTypingIndicator(threadID, isTyping, [callback], [isGroup])
    else if (typeof arg2 === "boolean") {
      threadID = arg1;
      isTyping = arg2;
      callback = typeof arg3 === "function" ? arg3 : function () {};
      isGroup = typeof arg4 === "boolean" ? arg4 : undefined;
      isBooleanCall = true;
    }
    // Pattern 3: sendTypingIndicator(threadID, [callback], [isGroup]) -> returns end() function
    else {
      threadID = arg1;
      callback = typeof arg2 === "function" ? arg2 : function () {};
      isGroup = typeof arg3 === "boolean" ? arg3 : undefined;
      isTyping = true;
    }

    var promise = publishTyping(isTyping, threadID, isGroup)
      .then(function (res) {
        callback(null, res);
        return res;
      })
      .catch(function (err) {
        log.error("sendTypingIndicator", err);
        callback(err);
        throw err;
      });

    // If explicit boolean mode was used, return the Promise so it can be awaited
    if (isBooleanCall) {
      return promise;
    }

    // Classic FCA pattern: returns end([cb]) function
    var end = function (cb) {
      var endCb = typeof cb === "function" ? cb : function () {};
      return publishTyping(false, threadID, isGroup)
        .then(function (res) {
          endCb(null, res);
          return res;
        })
        .catch(function (err) {
          log.error("sendTypingIndicator (end)", err);
          endCb(err);
          throw err;
        });
    };

    // Attach promise to end function so callers can also do: await api.sendTypingIndicator(threadID)
    end.then = promise.then.bind(promise);
    end.catch = promise.catch.bind(promise);

    return end;
  };
};
