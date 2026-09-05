"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function changeThreadColor(color, threadID, callback) {
    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err) {
        if (err) return rejectFunc(err);
        resolveFunc(err);
      };
    }

    var validatedColor = color !== null ? color.toString().toLowerCase() : color;

    // Tìm kiếm trong api.threadColors (cả key và value)
    if (api.threadColors && color !== null) {
      if (api.threadColors[color]) {
        validatedColor = api.threadColors[color];
      } else {
        var lowerColor = color.toLowerCase();
        var foundKey = Object.keys(api.threadColors).find(function(key) {
          return key.toLowerCase() === lowerColor;
        });
        if (foundKey) {
          validatedColor = api.threadColors[foundKey];
        }
      }
    }

    var colorList = api.threadColors ? Object.keys(api.threadColors).map(function (name) {
      return api.threadColors[name];
    }) : [];

    var isNumericId = /^\d+$/.test(validatedColor);

    if (validatedColor !== null && !isNumericId && !colorList.includes(validatedColor)) {
      throw { error: "The color you are trying to use is not a valid thread color. Use api.threadColors to find acceptable values, or pass a valid numeric Theme ID." };
    }

    // Nếu MQTT kết nối và hoạt động (phương pháp LightSpeed mới nhất)
    if (ctx.mqttClient) {
      var themeIDToSet = validatedColor;
      
      const createAndPublish = (label, queueName, payload) => {
        var epochId = Number(utils.generateOfflineThreadingID()) || Date.now();
        var rand = utils.generateOfflineThreadingID();
        
        var finalQueueName = queueName === "thread_theme" ? queueName : JSON.stringify([queueName, rand]);
        
        var queryPayload = {
          thread_key: Number(threadID) || threadID,
          theme_fbid: themeIDToSet !== null ? (Number(themeIDToSet) || themeIDToSet) : null,
          sync_group: 1,
          ...payload
        };

        var task = {
          failure_count: null,
          label: label,
          payload: JSON.stringify(queryPayload),
          queue_name: finalQueueName,
          task_id: Math.floor(Math.random() * 1001)
        };

        var form = JSON.stringify({
          app_id: "2220391788200892",
          payload: JSON.stringify({
            epoch_id: epochId,
            tasks: [task],
            version_id: "27892048790448178"
          }),
          request_id: ++ctx.req_ID,
          type: 3
        });

        ctx.mqttClient.publish("/ls_req", form, { qos: 1, retain: false });
      };

      try {
        // Gửi 4 tác vụ tuần tự giống hệt gói tin thực tế của Messenger
        createAndPublish('1013', 'ai_generated_theme', {});
        createAndPublish('1037', 'msgr_custom_thread_theme', {});
        createAndPublish('1028', 'thread_theme_writer', {});
        createAndPublish('43', 'thread_theme', { source: null, payload: null });
        
        setTimeout(function() {
          return callback();
        }, 500); // Thêm khoảng trễ ngắn để lệnh publish hoàn tất
      } catch (err) {
        log.error("changeThreadColor", err);
        return callback(err);
      }
    } else {
      // Fallback về GraphQL Post cũ nếu không có MQTT
      var form = {
        dpr: 1,
        queries: JSON.stringify({
          o0: {
            doc_id: "1727493033983591",
            query_params: {
              data: {
                actor_id: ctx.userID,
                client_mutation_id: "0",
                source: "SETTINGS",
                theme_id: validatedColor,
                thread_id: threadID
              }
            }
          }
        })
      };

      defaultFuncs
        .post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, form)
        .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
        .then(function (resData) {
          if (resData[resData.length - 1].error_results > 0) throw resData[0].o0.errors;
          return callback();
        })
        .catch(function (err) {
          log.error("changeThreadColor", err);
          return callback(err);
        });
    }

    return returnPromise;
  };
};
