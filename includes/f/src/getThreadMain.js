"use strict";

const utils = require("../utils");
const log = require("npmlog");

function formatEventReminders(reminder) {
  return {
    reminderID: reminder.id,
    eventCreatorID: reminder.lightweight_event_creator.id,
    time: reminder.time,
    eventType: reminder.lightweight_event_type.toLowerCase(),
    locationName: reminder.location_name,
    locationCoordinates: reminder.location_coordinates,
    locationPage: reminder.location_page,
    eventStatus: reminder.lightweight_event_status.toLowerCase(),
    note: reminder.note,
    repeatMode: reminder.repeat_mode.toLowerCase(),
    eventTitle: reminder.event_title,
    triggerMessage: reminder.trigger_message,
    secondsToNotifyBefore: reminder.seconds_to_notify_before,
    allowsRsvp: reminder.allows_rsvp,
    relatedEvent: reminder.related_event,
    members: reminder.event_reminder_members.edges.map(function(member) {
      return {
        memberID: member.node.id,
        state: member.guest_list_state.toLowerCase()
      };
    })
  };
}

function formatThreadGraphQLResponse(data) {
  if (!data || data.errors) return null;
  const messageThread = data.message_thread;
  if (!messageThread) return null;

  const threadID = messageThread.thread_key.thread_fbid
    ? messageThread.thread_key.thread_fbid
    : messageThread.thread_key.other_user_id;

  const lastM = messageThread.last_message;
  const snippetID =
    lastM &&
    lastM.nodes &&
    lastM.nodes[0] &&
    lastM.nodes[0].message_sender &&
    lastM.nodes[0].message_sender.messaging_actor
      ? lastM.nodes[0].message_sender.messaging_actor.id
      : null;
  const snippetText =
    lastM && lastM.nodes && lastM.nodes[0] ? lastM.nodes[0].snippet : null;
  const lastR = messageThread.last_read_receipt;
  const lastReadTimestamp =
    lastR && lastR.nodes && lastR.nodes[0] && lastR.nodes[0].timestamp_precise
      ? lastR.nodes[0].timestamp_precise
      : null;

  return {
    threadID: threadID,
    threadName: messageThread.name,
    participantIDs: messageThread.all_participants.edges.map(d => d.node.messaging_actor.id),
    userInfo: messageThread.all_participants.edges.map(d => ({
      id: d.node.messaging_actor.id,
      name: d.node.messaging_actor.name,
      firstName: d.node.messaging_actor.short_name,
      vanity: d.node.messaging_actor.username,
      thumbSrc: d.node.messaging_actor.big_image_src.uri,
      profileUrl: d.node.messaging_actor.big_image_src.uri,
      gender: d.node.messaging_actor.gender,
      type: d.node.messaging_actor.__typename,
      isFriend: d.node.messaging_actor.is_viewer_friend,
      isBirthday: !!d.node.messaging_actor.is_birthday
    })),
    unreadCount: messageThread.unread_count,
    messageCount: messageThread.messages_count,
    timestamp: messageThread.updated_time_precise,
    muteUntil: messageThread.mute_until,
    isGroup: messageThread.thread_type == "GROUP",
    isSubscribed: messageThread.is_viewer_subscribed,
    isArchived: messageThread.has_viewer_archived,
    folder: messageThread.folder,
    cannotReplyReason: messageThread.cannot_reply_reason,
    eventReminders: messageThread.event_reminders
      ? messageThread.event_reminders.nodes.map(formatEventReminders)
      : null,
    emoji: messageThread.customization_info
      ? messageThread.customization_info.emoji
      : null,
    color:
      messageThread.customization_info &&
      messageThread.customization_info.outgoing_bubble_color
        ? messageThread.customization_info.outgoing_bubble_color.slice(2)
        : null,
    threadTheme: messageThread.thread_theme,
    nicknames:
      messageThread.customization_info &&
      messageThread.customization_info.participant_customizations
        ? messageThread.customization_info.participant_customizations.reduce(
            function(res, val) {
              if (val.nickname) res[val.participant_id] = val.nickname;
              return res;
            },
            {}
          )
        : {},
    adminIDs: messageThread.thread_admins ? messageThread.thread_admins.map(a => a.id || a) : [],
    approvalMode: Boolean(messageThread.approval_mode),
    approvalQueue: messageThread.group_approval_queue && messageThread.group_approval_queue.nodes
      ? messageThread.group_approval_queue.nodes.map(a => ({
          inviterID: a.inviter ? a.inviter.id : null,
          requesterID: a.requester ? a.requester.id : null,
          timestamp: a.request_timestamp,
          request_source: a.request_source
        }))
      : [],

    reactionsMuteMode: messageThread.reactions_mute_mode ? messageThread.reactions_mute_mode.toLowerCase() : null,
    mentionsMuteMode: messageThread.mentions_mute_mode ? messageThread.mentions_mute_mode.toLowerCase() : null,
    isPinProtected: messageThread.is_pin_protected,
    relatedPageThread: messageThread.related_page_thread,

    name: messageThread.name,
    snippet: snippetText,
    snippetSender: snippetID,
    snippetAttachments: [],
    serverTimestamp: messageThread.updated_time_precise,
    imageSrc: messageThread.image ? messageThread.image.uri : null,
    isCanonicalUser: messageThread.is_canonical_neo_user,
    isCanonical: messageThread.thread_type != "GROUP",
    recipientsLoadable: true,
    hasEmailParticipant: false,
    readOnly: false,
    canReply: messageThread.cannot_reply_reason == null,
    lastMessageTimestamp: messageThread.last_message
      ? messageThread.last_message.timestamp_precise
      : null,
    lastMessageType: "message",
    lastReadTimestamp: lastReadTimestamp,
    threadType: messageThread.thread_type == "GROUP" ? 2 : 1,
    inviteLink: {
      enable: messageThread.joinable_mode ? messageThread.joinable_mode.mode == 1 : false,
      link: messageThread.joinable_mode ? messageThread.joinable_mode.link : null
    },
    TimeCreate: Date.now(),
    TimeUpdate: Date.now()
  };
}

module.exports = function(defaultFuncs, api, ctx) {
  return function getThreadInfoGraphQL(threadID, callback) {
    let resolveFunc = function() {};
    let rejectFunc = function() {};
    const returnPromise = new Promise(function(resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (utils.getType(callback) !== "Function" && utils.getType(callback) !== "AsyncFunction") {
      callback = function(err, data) {
        if (err) {
          return rejectFunc(err);
        }
        resolveFunc(data);
      };
    }

    const isArray = Array.isArray(threadID);
    const threadIDs = isArray ? threadID : [threadID];

    let Form = {};
    threadIDs.forEach(function(t, i) {
      Form["o" + i] = {
        doc_id: "3449967031715030",
        query_params: {
          id: t,
          message_limit: 0,
          load_messages: false,
          load_read_receipts: false,
          before: null
        }
      };
    });

    const form = {
      queries: JSON.stringify(Form),
      batch_name: "MessengerGraphQLThreadFetcher"
    };

    defaultFuncs
      .post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, form)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function(resData) {
        if (resData.error) {
          throw resData;
        }

        const threadInfos = {};
        for (let i = resData.length - 2; i >= 0; i--) {
          const res = resData[i];
          if (res.error_results) continue;
          
          const threadInfo = formatThreadGraphQLResponse(res[Object.keys(res)[0]].data);
          if (threadInfo) {
            threadInfos[threadInfo.threadID || threadIDs[threadIDs.length - 1 - i]] = threadInfo;
          }
        }

        if (Object.keys(threadInfos).length === 0) {
          throw new Error("getThreadInfo: Rate limit or empty response");
        }

        if (isArray) {
          callback(null, threadInfos);
        } else {
          callback(null, Object.values(threadInfos)[0] || null);
        }
      })
      .catch(function(err) {
        // FALLBACK: Try getThreadList if getThreadInfo fails (e.g. rate limited)
        log.warn("getThreadInfoGraphQL", "getThreadInfo rate-limited or failed. Attempting fallback via getThreadList...");

        const listForm = {
          "av": ctx.globalOptions.pageID,
          "queries": JSON.stringify({
            "o0": {
              "doc_id": "3336396659757871",
              "query_params": {
                "limit": 50,
                "before": null,
                "tags": ["INBOX"],
                "includeDeliveryReceipts": true,
                "includeSeqID": false
              }
            }
          }),
          "batch_name": "MessengerGraphQLThreadlistFetcher"
        };

        defaultFuncs
          .post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, listForm)
          .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
          .then(function(resData) {
            if (resData[resData.length - 1].error_results > 0 || resData[resData.length - 1].successful_results === 0) {
              throw new Error("Fallback query getThreadList failed");
            }

            const threads = resData[0].o0.data.viewer.message_threads.nodes;
            const threadInfos = {};

            threads.forEach(t => {
              const formatted = formatThreadGraphQLResponse({ message_thread: t });
              if (formatted) {
                threadInfos[formatted.threadID] = formatted;
              }
            });

            const resultInfos = {};
            threadIDs.forEach(id => {
              if (threadInfos[id]) {
                resultInfos[id] = threadInfos[id];
              }
            });

            if (Object.keys(resultInfos).length > 0) {
              if (isArray) {
                return callback(null, resultInfos);
              } else {
                return callback(null, Object.values(resultInfos)[0]);
              }
            } else {
              throw new Error("Thread ID not found in inbox fallback");
            }
          })
          .catch(function(fallbackErr) {
            log.error("getThreadInfoGraphQL", "Fallback also failed: " + fallbackErr.message);
            return callback(err); // Return original error
          });
      });

    return returnPromise;
  };
};