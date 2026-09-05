"use strict";

var utils = require("../utils");
var log = require("npmlog");

module.exports = function (defaultFuncs, api, ctx) {
  return function handleFriendRequest(userID, accept, callback) {
    if (utils.getType(accept) !== "Boolean") throw { error: "Vui lòng truyền boolean (true/false) làm tham số thứ hai (accept)." };

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

    // 1. Gửi GraphQL Mutation (Phương thức chuẩn nhất của Facebook Web hiện tại)
    var gqlForm = {
      av: ctx.userID,
      fb_api_req_friendly_name: accept ? "FriendingCometFriendRequestConfirmMutation" : "FriendingCometFriendRequestDeleteMutation",
      fb_api_caller_class: "RelayModern",
      doc_id: "27351021931180810",
      variables: JSON.stringify({
        input: {
          friend_request_responder_id: userID,
          source: "FRIEND_REQUESTS"
        }
      })
    };

    defaultFuncs
      .post("https://www.facebook.com/api/graphql/", ctx.jar, gqlForm)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function (resGql) {
        if (resGql && resGql.errors) throw resGql.errors;
        return callback(null, {
          success: true,
          userID: userID,
          action: accept ? "confirm" : "reject"
        });
      })
      .catch(function () {
        // 2. Dự phòng 1: Gửi REST Ajax request
        var form = {
          viewer_id: ctx.userID,
          "frefs[0]": "jwl",
          floc: "friend_center_requests",
          ref: "/reqs.php",
          action: accept ? "confirm" : "reject",
          id: userID
        };

        defaultFuncs
          .post("https://www.facebook.com/requests/friends/ajax/", ctx.jar, form)
          .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
          .then(function (resData) {
            if (resData && resData.payload && resData.payload.err) throw { err: resData.payload.err };
            return callback(null, {
              success: true,
              userID: userID,
              action: accept ? "confirm" : "reject"
            });
          })
          .catch(function () {
            // 3. Dự phòng 2: Gọi URL mbasic (chắc chắn thành công nếu đã đăng nhập)
            var mbasicUrl = accept
              ? "https://mbasic.facebook.com/requests/friends/accept/?confirm=" + userID
              : "https://mbasic.facebook.com/requests/friends/reject/?delete=" + userID;

            utils
              .get(mbasicUrl, ctx.jar, null, ctx.globalOptions)
              .then(function () {
                return callback(null, {
                  success: true,
                  userID: userID,
                  action: accept ? "confirm" : "reject"
                });
              })
              .catch(function (err) {
                log.error("handleFriendRequest", err);
                return callback(err);
              });
          });
      });

    return returnPromise;
  };
};
