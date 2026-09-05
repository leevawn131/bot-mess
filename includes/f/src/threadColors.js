"use strict";

var utils = require("../utils");

module.exports = function(defaultFuncs, api, ctx) {
  var themes = {
    DefaultBlue:    "196241301102133",
    HotPink:        "169463077092846",
    AquaBlue:       "2442142322678320",
    BrightPurple:   "234137870477637",
    CoralPink:      "980963458735625",
    Orange:         "175615189761153",
    Green:          "2136751179887052",
    LavenderPurple: "2058653964378557",
    Red:            "2129984390566328",
    Yellow:         "174636906462322",
    TealBlue:       "1928399724138152",
    Aqua:           "417639218648241",
    Mango:          "930060997172551",
    Berry:          "164535220883264",
    Citrus:         "370940413392601",
    Candy:          "205488546921017",
    StarWars:       "809305022860427"
  };

  themes.update = function(threadID, callback) {
    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    var targetThreadID = threadID || ctx.userID;

    var form = {
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'MWPThreadThemeQuery_AllThemesQuery',
      variables: JSON.stringify({ version: "default" }),
      server_timestamps: true,
      doc_id: '24474714052117636',
    };

    defaultFuncs
      .post("https://www.facebook.com/api/graphql/", ctx.jar, form, null, {
        "x-fb-friendly-name": "MWPThreadThemeQuery_AllThemesQuery",
        "x-fb-lsd": ctx.lsd,
        "referer": "https://www.facebook.com/messages/t/" + targetThreadID
      })
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function(resData) {
        if (resData.errors) {
          throw resData.errors;
        }
        if (!resData.data || !resData.data.messenger_thread_themes) {
          throw new Error("Could not retrieve thread themes from response.");
        }
        
        var list = resData.data.messenger_thread_themes;
        list.forEach(function(themeData) {
          if (themeData && themeData.id && themeData.accessibility_label) {
            // Chuẩn hóa tên theme bằng cách loại bỏ các ký tự đặc biệt
            var name = themeData.accessibility_label.replace(/[^a-zA-Z0-9]/g, "");
            if (name.length > 0) {
              themes[name] = themeData.id;
            }
          }
        });
        
        return callback(null, themes);
      })
      .catch(function(err) {
        return callback(err);
      });

    return returnPromise;
  };

  return themes;
};