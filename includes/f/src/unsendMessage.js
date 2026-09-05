"use strict";

const Balancer = require('../Extra/Balancer.js');
var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  //const BalancerInstance = new Balancer(api.unsendMessage, unsendMessage, 0.85);
  
  function unsendMessage(messageID, threadID, callback) {
    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });
  
    if (utils.getType(threadID) === "Function" || utils.getType(threadID) === "AsyncFunction") {
      callback = threadID;
      threadID = null;
    }

    if (!callback) {
      callback = function (err, friendList) {
        if (err) return rejectFunc(err);
        resolveFunc(friendList);
      };
    }

    var msgIdStr = String(messageID || "");
    if (ctx.e2eeClient && (/^\d{10,20}$/.test(msgIdStr) || (threadID && String(threadID).includes("@msgr")))) {
      return ctx.e2eeClient.unsendMessage({
        messageId: msgIdStr,
        threadId: threadID ? String(threadID) : undefined,
        fromMe: true
      }).then(function (res) {
        callback(null, res);
      }).catch(function (err) {
        log.error("unsendMessage", "[E2EE] Lỗi thu hồi:", err);
        callback(err);
      });
    }

    function httpUnsend() {
      var form = {
        message_id: messageID
      };
    
      defaultFuncs
        .post("https://www.facebook.com/messaging/unsend_message/", ctx.jar, form)
        .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
        .then(function (resData) {
          if (resData.error) throw resData;
          return callback(null, resData);
        })
        .catch(function (err) {
          log.error("unsendMessage", err);
          return callback(err);
        });
    
      return returnPromise;
    }

    if (threadID && typeof api.unsendMqttMessage === "function" && ctx.mqttClient && ctx.mqttClient.connected) {
      try {
        var p = api.unsendMqttMessage(threadID, messageID, function (err, data) {
          if (err) {
            log.warn("unsendMessage", "MQTT unsend failed (" + (err.message || err) + "), falling back to HTTP unsend...");
            return httpUnsend();
          }
          callback(null, data);
        });
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (syncErr) {
        log.warn("unsendMessage", "MQTT unsend exception (" + syncErr.message + "), falling back to HTTP unsend...");
        return httpUnsend();
      }
      return returnPromise;
    } else {
      return httpUnsend();
    }
  }

  return unsendMessage;
};