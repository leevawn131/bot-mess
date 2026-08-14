"use strict";

var utils = require("../utils");
var log = require("npmlog");

function formatFriendRequestsGraphQL(edges) {
  if (!Array.isArray(edges)) return [];
  return edges.map(function (edge) {
    var node = edge.node || edge;
    return {
      userID: utils.formatID((node.id || "").toString()),
      name: node.name || "",
      profileUrl: node.url || ("https://www.facebook.com/" + node.id),
      thumbSrc: node.profile_picture ? node.profile_picture.uri : null,
      time: edge.time || null,
      isSeen: !!edge.is_seen
    };
  });
}

module.exports = function (defaultFuncs, api, ctx) {
  return function getFriendRequests(limit, callback) {
    if (typeof limit === "function") {
      callback = limit;
      limit = 20;
    }
    if (!limit || typeof limit !== "number") {
      limit = 20;
    }

    var resolveFunc = function () { };
    var rejectFunc = function () { };
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = function (err, friendRequests) {
        if (err) return rejectFunc(err);
        resolveFunc(friendRequests);
      };
    }

    var allEdges = [];
    var currentCursor = null;
    var targetLimit = limit;

    function fetchNextPage() {
      // Tối ưu số lượng item cần lấy cho trang tiếp theo (tối đa 100/trang)
      var remaining = Math.max(1, targetLimit - allEdges.length);
      var fetchCount = Math.min(remaining, 100);

      var form = {
        av: ctx.userID,
        fb_api_req_friendly_name: "FriendingCometFriendRequestsRootQuery",
        fb_api_caller_class: "RelayModern",
        doc_id: "26619914564335965",
        variables: JSON.stringify({
          count: fetchCount,
          cursor: currentCursor,
          scale: 1
        })
      };

      defaultFuncs
        .post("https://www.facebook.com/api/graphql/", ctx.jar, form)
        .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
        .then(function (resData) {
          // Bắt lỗi Rate Limit từ Facebook
          if (resData && resData.errors && resData.errors.length > 0) {
            var errObj = resData.errors[0];
            var errMsg = errObj.message || "GraphQL Error";
            if (errObj.code === 1675004 || errMsg.toLowerCase().includes("rate limit")) {
              if (allEdges.length > 0) {
                // Nếu đã lấy được một phần dữ liệu trước khi dính rate limit, trả về dữ liệu đã lấy
                var formattedPartial = formatFriendRequestsGraphQL(allEdges);
                return callback(null, formattedPartial.slice(0, targetLimit));
              }
              var err = new Error("Facebook Rate Limit: Tài khoản đang bị Facebook tạm thời giới hạn tần suất truy vấn GraphQL (Rate Limit Code 1675004). Vui lòng thử lại sau ít phút.");
              err.code = 1675004;
              return callback(err);
            }
          }

          if (resData && resData.data && resData.data.viewer && resData.data.viewer.friending_possibilities) {
            var friending = resData.data.viewer.friending_possibilities;
            var edges = friending.edges || [];

            var totalCountOnFB = friending.count;
            if (typeof totalCountOnFB === "number" && totalCountOnFB > 0) {
              targetLimit = Math.min(limit, totalCountOnFB);
            } else {
              targetLimit = limit;
            }

            var incomingEdges = edges.filter(function (edge) {
              if (!edge.node) return false;
              if (edge.node.friendship_status) {
                return edge.node.friendship_status === "INCOMING_REQUEST" || edge.node.friendship_status === "INCOMING";
              }
              return true;
            });

            var validEdges = incomingEdges.length > 0 ? incomingEdges : edges;

            if (validEdges.length > 0) {
              allEdges = allEdges.concat(validEdges);
            }

            var pageInfo = friending.page_info || {};
            var hasNextPage = !!pageInfo.has_next_page;
            currentCursor = pageInfo.end_cursor || null;

            var isReachedEnd = edges.length > 0 && incomingEdges.length < edges.length && edges.some(function (e) {
              return e.node && e.node.friendship_status && e.node.friendship_status !== "INCOMING_REQUEST";
            });

            // Tiếp tục phân trang nếu chưa đủ targetLimit, còn trang và chưa chạm đến gợi ý
            if (allEdges.length < targetLimit && hasNextPage && currentCursor && edges.length > 0 && !isReachedEnd) {
              // Thêm khoảng nghỉ 500ms giữa các request phân trang để chống Rate Limit
              setTimeout(fetchNextPage, 500);
            } else {
              var formatted = formatFriendRequestsGraphQL(allEdges);
              return callback(null, formatted.slice(0, targetLimit));
            }
          } else {
            var formattedFallback = formatFriendRequestsGraphQL(allEdges);
            return callback(null, formattedFallback.slice(0, targetLimit));
          }
        })
        .catch(function (err) {
          if (allEdges.length > 0) {
            var formattedPartial = formatFriendRequestsGraphQL(allEdges);
            return callback(null, formattedPartial.slice(0, targetLimit));
          }
          log.error("getFriendRequests", err);
          return callback(err);
        });
    }

    fetchNextPage();

    return returnPromise;
  };
};
