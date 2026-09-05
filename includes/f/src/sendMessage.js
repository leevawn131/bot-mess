"use strict";

/**
 * Được Fix Hay Làm Màu Bởi: @HarryWakazaki
 * 21/4/2022
*/

var utils = require("../utils");
var log = require("npmlog");
var bluebird = require("bluebird");
var fs = require('fs-extra');
var path = require('path');

function getMimeType(ext) {
  switch (ext) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    case ".mkv": return "video/x-matroska";
    case ".avi": return "video/x-msvideo";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".mp3": return "audio/mpeg";
    case ".ogg": return "audio/ogg";
    case ".wav": return "audio/wav";
    case ".m4a": return "audio/mp4";
    case ".pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

var { execFile } = require("child_process");

function getVideoMetadata(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return resolve({ width: 576, height: 1024, seconds: 15, thumbnail: null });
    }
    execFile("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration",
      "-of", "default=noprint_wrappers=1",
      filePath
    ], (err, stdout) => {
      let width = 576, height = 1024, duration = 15;
      if (!err && stdout) {
        const lines = stdout.trim().split("\n");
        for (const line of lines) {
          const [k, v] = line.split("=");
          if (k === "width") width = parseInt(v, 10) || width;
          if (k === "height") height = parseInt(v, 10) || height;
          if (k === "duration") duration = Math.round(parseFloat(v)) || duration;
        }
      }
      
      const thumbPath = `/tmp/thumb_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      execFile("ffmpeg", [
        "-y", "-ss", "00:00:01",
        "-i", filePath,
        "-vf", "scale=160:-1",
        "-vframes", "1",
        "-q:v", "10",
        thumbPath
      ], (fErr) => {
        let thumbnail = null;
        if (!fErr && fs.existsSync(thumbPath)) {
          try {
            thumbnail = fs.readFileSync(thumbPath);
            fs.unlinkSync(thumbPath);
          } catch {}
        }
        resolve({ width, height, seconds: duration, thumbnail });
      });
    });
  });
}

async function extractAttachmentData(att) {
  if (!att) return null;
  if (Buffer.isBuffer(att)) {
    return { data: att, fileName: "file.bin", mimeType: "application/octet-stream", filePath: null };
  }
  if (typeof att === "string" && fs.existsSync(att)) {
    var ext = path.extname(att).toLowerCase();
    var mimeType = getMimeType(ext);
    var data = fs.readFileSync(att);
    return { data: data, fileName: path.basename(att), mimeType: mimeType, filePath: att };
  }
  if (utils.isReadableStream(att) || (typeof att === "object" && typeof att.pipe === "function")) {
    if (att.path && typeof att.path === "string" && fs.existsSync(att.path)) {
      var ext = path.extname(att.path).toLowerCase();
      var mimeType = getMimeType(ext);
      var data = fs.readFileSync(att.path);
      return { data: data, fileName: path.basename(att.path), mimeType: mimeType, filePath: att.path };
    }
    var chunks = [];
    for await (var chunk of att) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    var data = Buffer.concat(chunks);
    return { data: data, fileName: "attachment.bin", mimeType: "application/octet-stream", filePath: null };
  }
  return null;
}

var allowedProperties = {
  attachment: true,
  url: true,
  sticker: true,
  emoji: true,
  emojiSize: true,
  body: true,
  mentions: true,
  location: true,
  effect: true,
};

var AntiText = "Your criminal activity was detected while attempting to send an Appstate file";
var Location_Stack;

module.exports = function (defaultFuncs, api, ctx) {
  function uploadAttachment(attachments, callback) {
    var uploads = [];

    // create an array of promises
    for (var i = 0; i < attachments.length; i++) {
      if (!utils.isReadableStream(attachments[i])) throw { error: "Attachment should be a readable stream and not " + utils.getType(attachments[i]) + "." };
      var form = {
        upload_1024: attachments[i],
        voice_clip: "true"
      };

      uploads.push(
        defaultFuncs
          .postFormData("https://upload.facebook.com/ajax/mercury/upload.php", ctx.jar, form, {})
          .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
          .then(function (resData) {
            if (resData.error) throw resData;
            // We have to return the data unformatted unless we want to change it
            // back in sendMessage.
            return resData.payload.metadata[0];
          })
      );
    }

    // resolve all promises
    bluebird
      .all(uploads)
      .then(resData => callback(null, resData)
      )
      .catch(function (err) {
        log.error("uploadAttachment", err);
        return callback(err);
      });
  }

  function getUrl(url, callback) {
    var form = {
      image_height: 960,
      image_width: 960,
      uri: url
    };

    defaultFuncs
      .post("https://www.facebook.com/message_share_attachment/fromURI/", ctx.jar, form)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function (resData) {
        if (resData.error) return callback(resData);
        if (!resData.payload) return callback({ error: "Invalid url" });
        callback(null, resData.payload.share_data.share_params);
      })
      .catch(function (err) {
        log.error("getUrl", err);
        return callback(err);
      });
  }

  function sendContent(form, threadID, isSingleUser, messageAndOTID, callback) {
    // There are three cases here:
    // 1. threadID is of type array, where we're starting a new group chat with users
    //    specified in the array.
    // 2. User is sending a message to a specific user.
    // 3. No additional form params and the message goes to an existing group chat.
    if (utils.getType(threadID) === "Array") {
      for (var i = 0; i < threadID.length; i++) form["specific_to_list[" + i + "]"] = "fbid:" + threadID[i];
      form["specific_to_list[" + threadID.length + "]"] = "fbid:" + ctx.userID;
      form["client_thread_id"] = "root:" + messageAndOTID;
      log.info("sendMessage", "Sending message to multiple users: " + threadID);
    }
    else {
      // This means that threadID is the id of a user, and the chat
      // is a single person chat
      if (isSingleUser) {
        form["specific_to_list[0]"] = "fbid:" + threadID;
        form["specific_to_list[1]"] = "fbid:" + ctx.userID;
        form["other_user_fbid"] = threadID;
      }
      else form["thread_fbid"] = threadID;
    }

    if (ctx.globalOptions.pageID) {
      form["author"] = "fbid:" + ctx.globalOptions.pageID;
      form["specific_to_list[1]"] = "fbid:" + ctx.globalOptions.pageID;
      form["creator_info[creatorID]"] = ctx.userID;
      form["creator_info[creatorType]"] = "direct_admin";
      form["creator_info[labelType]"] = "sent_message";
      form["creator_info[pageID]"] = ctx.globalOptions.pageID;
      form["request_user_id"] = ctx.globalOptions.pageID;
      form["creator_info[profileURI]"] = "https://www.facebook.com/profile.php?id=" + ctx.userID;
    }

    if (global.Fca?.Require?.FastConfig?.AntiSendAppState == true) {
      try {
        if (Location_Stack != undefined || Location_Stack != null) {
          let location =  (((Location_Stack).replace("Error",'')).split('\n')[7]).split(' ');
          let format = {
            Source: (location[6]).split('s:')[0].replace("(",'') + 's',
            Line:  (location[6]).split('s:')[1].replace(")",'')
          };
          form.body = AntiText + "\n- Source: " + format.Source + "\n- Line: " + format.Line;
        }
      }
      catch (e) {}
    }

    defaultFuncs
      .post("https://www.facebook.com/messaging/send/", ctx.jar, form)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function (resData) {
        Location_Stack = undefined;
        if (!resData) return callback({ error: "Send message failed." });
        if (resData.error) {
          if (resData.error === 1545012) log.warn("sendMessage", "Got error 1545012. This might mean that you're not part of the conversation " + threadID);
          return callback(resData);
        }

        var messageInfo = resData.payload.actions.reduce(function (p, v) {
          return (
            {
              threadID: v.thread_fbid,
              messageID: v.message_id,
              timestamp: v.timestamp
            } || p
          );
        }, null);
        return callback(null, messageInfo);
      })
      .catch(function (err) {
        log.error("sendMessage", err);
        if (utils.getType(err) == "Object" && err.error === "Not logged in.") ctx.loggedIn = false;
        return callback(err,null);
      });
    }

  function send(form, threadID, messageAndOTID, callback, isGroup) {
    if (utils.getType(threadID) === "Array") {
      return sendContent(form, threadID, false, messageAndOTID, callback);
    }
    
    var isSingleUser = true;
    if (isGroup === true) {
      isSingleUser = false;
    } else if (isGroup === false) {
      isSingleUser = true;
    } else {
      var threadStr = threadID.toString();
      if (global.data && global.data.allThreadID && global.data.allThreadID.includes(threadStr)) {
        isSingleUser = false;
      } else if (global.Fca && global.Fca.isThread && global.Fca.isThread.includes(threadStr)) {
        isSingleUser = false;
      } else if (global.Fca && global.Fca.isUser && global.Fca.isUser.includes(threadStr)) {
        isSingleUser = true;
      } else if (threadStr.length < 15) {
        isSingleUser = true;
      } else if (threadStr.startsWith("1000") || threadStr.startsWith("615") || threadStr.startsWith("5")) {
        isSingleUser = true;
      } else {
        isSingleUser = false;
      }
    }

    sendContent(form, threadID, isSingleUser, messageAndOTID, callback);
  }
  
  function handleUrl(msg, form, callback, cb) {
    if (msg.url) {
      form["shareable_attachment[share_type]"] = "100";
      getUrl(msg.url, function (err, params) {
        if (err) return callback(err);
        form["shareable_attachment[share_params]"] = params;
        cb();
      });
    }
    else cb();
  }

  function handleLocation(msg, form, callback, cb) {
    if (msg.location) {
      if (msg.location.latitude == null || msg.location.longitude == null) return callback({ error: "location property needs both latitude and longitude" });
      form["location_attachment[coordinates][latitude]"] = msg.location.latitude;
      form["location_attachment[coordinates][longitude]"] = msg.location.longitude;
      form["location_attachment[is_current_location]"] = !!msg.location.current;
    }
    cb();
  }

  function handleSticker(msg, form, callback, cb) {
    if (msg.sticker) form["sticker_id"] = msg.sticker;
    cb();
  }

  function handleEmoji(msg, form, callback, cb) {
    if (msg.emojiSize != null && msg.emoji == null) return callback({ error: "emoji property is empty" });
    if (msg.emoji) {
      if (msg.emojiSize == null) msg.emojiSize = "medium";
      if (msg.emojiSize != "small" && msg.emojiSize != "medium" && msg.emojiSize != "large") return callback({ error: "emojiSize property is invalid" });
      if (form["body"] != null && form["body"] != "") return callback({ error: "body is not empty" });
      form["body"] = msg.emoji;
      form["tags[0]"] = "hot_emoji_size:" + msg.emojiSize;
    }
    cb();
  }

  function handleAttachment(msg, form, callback, cb) {
    if (msg.attachment) {
      form["image_ids"] = [];
      form["gif_ids"] = [];
      form["file_ids"] = [];
      form["video_ids"] = [];
      form["audio_ids"] = [];

      if (utils.getType(msg.attachment) !== "Array") msg.attachment = [msg.attachment];

      const isValidAttachment = attachment => /_id$/.test(attachment[0]);

      if (msg.attachment.every(isValidAttachment)) {
        msg.attachment.forEach(attachment => form[`${attachment[0]}s`].push(attachment[1]));
        return cb();
      }

      if (global.Fca?.Require?.FastConfig?.AntiSendAppState) {
        try {
          const AllowList = [".png", ".mp3", ".mp4", ".wav", ".gif", ".jpg", ".tff"];
          const CheckList = [".json", ".js", ".txt", ".docx", '.php'];
          var Has;
          for (let i = 0; i < (msg.attachment).length; i++) {
            if (utils.isReadableStream((msg.attachment)[i])) {
              var path = (msg.attachment)[i].path != undefined ? (msg.attachment)[i].path : "nonpath";
              if (AllowList.some(i => path.includes(i))) continue;
              else if (CheckList.some(i => path.includes(i))) {
                let data = fs.readFileSync(path, 'utf-8');
                if (data.includes("datr")) {
                  Has = true;
                  var err = new Error();
                  Location_Stack = err.stack;
                }
                else continue;
              }
            }
          }
          if (Has == true) {
            msg.attachment = [fs.createReadStream(__dirname + "/../Extra/Src/Image/checkmate.jpg")];
          }    
        }
        catch (e) {}
      }
      uploadAttachment(msg.attachment, function (err, files) {
      if (err) return callback(err);
        files.forEach(function (file) {
          var key = Object.keys(file);
          var type = key[0]; // image_id, file_id, etc
          form["" + type + "s"].push(file[type]); // push the id
        });
        cb();
      });
    }
    else cb();
  }

  function handleMention(msg, form, callback, cb) {
    if (msg.mentions) {
      for (let i = 0; i < msg.mentions.length; i++) {
        const mention = msg.mentions[i];
        const tag = mention.tag;
        if (typeof tag !== "string") return callback({ error: "Mention tags must be strings." });
        const offset = msg.body.indexOf(tag, mention.fromIndex || 0);
        if (offset < 0) log.warn("handleMention", 'Mention for "' + tag + '" not found in message string.');
        if (mention.id == null) log.warn("handleMention", "Mention id should be non-null.");

        const id = mention.id || 0;
        const emptyChar = '\u200E';
        form["body"] = emptyChar + msg.body;
        form["profile_xmd[" + i + "][offset]"] = offset + 1;
        form["profile_xmd[" + i + "][length]"] = tag.length;
        form["profile_xmd[" + i + "][id]"] = id;
        form["profile_xmd[" + i + "][type]"] = "p";
      }
    }
    cb();
  }

  return function sendMessage(msg, threadID, callback, replyToMessage, isGroup) {
    typeof isGroup == "undefined" ? isGroup = null : "";
    if (!callback && (utils.getType(threadID) === "Function" || utils.getType(threadID) === "AsyncFunction")) return threadID({ error: "Pass a threadID as a second argument." });
    if (!replyToMessage && utils.getType(callback) === "String") {
      replyToMessage = callback;
      callback = undefined;
    }

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

    if (replyToMessage) {
      var originalCallback = callback;
      callback = function (err, data) {
        if (err) {
          log.warn("sendMessage", "Failed to send message with replyToMessage, retrying without reply...", err);
          return sendMessage(msg, threadID, originalCallback, undefined, isGroup);
        }
        originalCallback(null, data);
      };
    }

    var msgType = utils.getType(msg);
    var threadIDType = utils.getType(threadID);
    var messageIDType = utils.getType(replyToMessage);

    if (msgType !== "String" && msgType !== "Object") return callback({ error: "Message should be of type string or object and not " + msgType + "." });

    // Changing this to accomodate an array of users
    if (threadIDType !== "Array" && threadIDType !== "Number" && threadIDType !== "String") return callback({ error: "ThreadID should be of type number, string, or array and not " + threadIDType + "." });

    if (replyToMessage && messageIDType !== 'String') return callback({ error: "MessageID should be of type string and not " + threadIDType + "." });

    if (msgType === "String") msg = { body: msg };

    var threadStr = threadID ? threadID.toString() : "";
    var isE2EEThread = (ctx.e2eeThreads && ctx.e2eeThreads.has(threadStr)) || 
                       (msg && msg.isE2EE === true) || 
                       (threadStr && (threadStr.includes("@msgr") || threadStr.includes("@g.us") || threadStr.includes("@broadcast")));
    if (msg && msg.isE2EE === false) {
      isE2EEThread = false;
    }

    function sendStandardMessage() {
      var disallowedProperties = Object.keys(msg).filter(prop => !allowedProperties[prop]);
      if (disallowedProperties.length > 0) return callback({ error: "Dissallowed props: `" + disallowedProperties.join(", ") + "`" });

      if (msg.effect) {
        if (threadIDType === "Array") return callback({ error: "Sending messages with effects to multiple users at once is not supported." });
        
        let effectStr = msg.effect.toString().toUpperCase();
        let style = 0;
        if (effectStr === "LOVE" || effectStr === "HEART" || effectStr === "HEARTS") {
          style = 1;
        } else if (effectStr === "GIFTWRAP" || effectStr === "GIFT") {
          style = 2;
        } else if (effectStr === "CELEBRATION" || effectStr === "CONFETTI") {
          style = 3;
        } else if (effectStr === "FIRE") {
          style = 4;
        } else {
          return callback({ error: `Invalid effect style: '${msg.effect}'. Allowed values: GIFTWRAP, FIRE, CELEBRATION, LOVE` });
        }

        var sendEffectFunc = (typeof api.sendMqttMessageEffect === "function") 
          ? api.sendMqttMessageEffect 
          : (typeof api.sendMqttMessage === "function" ? api.sendMqttMessage : null);

        if (sendEffectFunc) {
          try {
            var p = sendEffectFunc(msg.body || "", threadID, replyToMessage, style, function (err, data) {
              if (err) {
                log.warn("sendMessage", "MQTT send effect failed (" + (err.message || err) + "), falling back to HTTP Mercury...");
                delete msg.effect;
                return sendMercuryHTTP();
              }
              callback(null, data);
            });
            if (p && typeof p.catch === "function") p.catch(function () {});
          } catch (syncErr) {
            log.warn("sendMessage", "MQTT send effect sync error (" + syncErr.message + "), falling back to HTTP Mercury...");
            delete msg.effect;
            return sendMercuryHTTP();
          }
          return returnPromise;
        } else {
          delete msg.effect;
          return sendMercuryHTTP();
        }
      }

      // Mọi tin nhắn văn bản thông thường đi trực tiếp qua Mercury HTTP POST ổn định tuyệt đối
      return sendMercuryHTTP();
    }

    function sendMercuryHTTP() {
      var messageAndOTID = utils.generateOfflineThreadingID();

      var form = {
        client: "mercury",
        action_type: "ma-type:user-generated-message",
        author: "fbid:" + ctx.userID,
        timestamp: Date.now(),
        timestamp_absolute: "Today",
        timestamp_relative: utils.generateTimestampRelative(),
        timestamp_time_passed: "0",
        is_unread: false,
        is_cleared: false,
        is_forward: false,
        is_filtered_content: false,
        is_filtered_content_bh: false,
        is_filtered_content_account: false,
        is_filtered_content_quasar: false,
        is_filtered_content_invalid_app: false,
        is_spoof_warning: false,
        source: "source:chat:web",
        "source_tags[0]": "source:chat",
        body: msg.body ? msg.body.toString().replace("\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f\ufe0f",'   ') : "",
        html_body: false,
        ui_push_phase: "V3",
        status: "0",
        offline_threading_id: messageAndOTID,
        message_id: messageAndOTID,
        threading_id: utils.generateThreadingID(ctx.clientID),
        "ephemeral_ttl_mode:": "0",
        manual_retry_cnt: "0",
        has_attachment: !!(msg.attachment || msg.url || msg.sticker),
        signatureID: utils.getSignatureID(),
        replied_to_message_id: replyToMessage
      };

      handleLocation(msg, form, callback, () =>
        handleSticker(msg, form, callback, () =>
          handleAttachment(msg, form, callback, () =>
            handleUrl(msg, form, callback, () =>
              handleEmoji(msg, form, callback, () =>
                handleMention(msg, form, callback, () =>
                  send(form, threadID, messageAndOTID, callback, isGroup)
                )
              )
            )
          )
        )
      );
    }

    if (ctx.e2eeClient && isE2EEThread) {
      var targetE2EEThread = (ctx.threadToUserMap && ctx.threadToUserMap.get(threadStr)) || threadStr;
      log.info("sendMessage", "[E2EE] Gửi tin nhắn E2EE tới thread " + targetE2EEThread + " (gốc: " + threadStr + ")");

      (async function() {
        try {
          var textToSend = msg.body || (typeof msg === "string" ? msg : "");
          var attachments = [];
          if (msg.attachment) {
            if (Array.isArray(msg.attachment)) {
              attachments = msg.attachment;
            } else {
              attachments = [msg.attachment];
            }
          }

          var lastResult = null;

          if (attachments.length > 0) {
            for (var i = 0; i < attachments.length; i++) {
              var att = attachments[i];
              var attData = await extractAttachmentData(att);
              if (attData && attData.data) {
                var ext = path.extname(attData.fileName || "").toLowerCase();
                var isVideo = [".mp4", ".mov", ".webm", ".mkv", ".avi"].includes(ext) || (attData.mimeType && attData.mimeType.startsWith("video/"));
                var isImage = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) || (attData.mimeType && attData.mimeType.startsWith("image/"));
                var isAudio = [".mp3", ".ogg", ".wav", ".m4a"].includes(ext) || (attData.mimeType && attData.mimeType.startsWith("audio/"));

                var videoMeta = (isVideo && attData.filePath) ? await getVideoMetadata(attData.filePath) : null;
                var mediaInput = {
                  threadId: targetE2EEThread,
                  data: attData.data,
                  fileName: attData.fileName || (isVideo ? "video.mp4" : isImage ? "image.png" : "file.bin"),
                  mimeType: attData.mimeType,
                  width: videoMeta ? videoMeta.width : ((att && att.width) ? Number(att.width) : 576),
                  height: videoMeta ? videoMeta.height : ((att && att.height) ? Number(att.height) : 1024),
                  seconds: videoMeta ? videoMeta.seconds : ((att && (att.seconds || att.duration)) ? Number(att.seconds || att.duration) : 30),
                  thumbnailData: videoMeta ? videoMeta.thumbnail : undefined,
                  caption: i === 0 ? (textToSend || undefined) : undefined
                };

                if (isVideo && typeof ctx.e2eeClient.sendVideo === "function") {
                  lastResult = await ctx.e2eeClient.sendVideo(mediaInput);
                } else if (isImage && typeof ctx.e2eeClient.sendImage === "function") {
                  lastResult = await ctx.e2eeClient.sendImage(mediaInput);
                } else if (isAudio && typeof ctx.e2eeClient.sendAudio === "function") {
                  lastResult = await ctx.e2eeClient.sendAudio(mediaInput);
                } else if (typeof ctx.e2eeClient.sendFile === "function") {
                  lastResult = await ctx.e2eeClient.sendFile(mediaInput);
                } else {
                  lastResult = await ctx.e2eeClient.sendMessage({
                    threadId: targetE2EEThread,
                    text: textToSend
                  });
                }
                log.info("sendMessage", "[E2EE] Gửi " + (isVideo ? "video" : isImage ? "image" : "file") + " thành công: " + JSON.stringify(lastResult));
              }
            }
          } else {
            lastResult = await ctx.e2eeClient.sendMessage({
              threadId: targetE2EEThread,
              text: textToSend
            });
          }

          if (ctx.e2eeThreads) {
            ctx.e2eeThreads.add(threadStr);
          }

          var messageInfo = {
            threadID: threadStr,
            messageID: (lastResult && lastResult.messageId) ? String(lastResult.messageId) : utils.generateOfflineThreadingID(),
            timestamp: Date.now(),
            isE2EE: true
          };

          return callback(null, messageInfo);
        } catch (err) {
          log.warn("sendMessage", "[E2EE] Lỗi E2EE (" + (err.message || err) + "), tự động chuyển sang gửi thường...");
          sendStandardMessage();
        }
      })();

      return returnPromise;
    }

    sendStandardMessage();
    return returnPromise;
  };
};
