async function ensureMentionsFromHistory(api, event) {
  if (!event?.body || !event.body.includes("@")) return event;
  if (Object.keys(event.mentions || {}).length > 0) return event;

  try {
    const history = await api.getThreadHistory(event.threadID, 5);
    const originalMsg = history.find((item) => item.messageID === event.messageID);
    if (
      originalMsg?.mentions &&
      Object.keys(originalMsg.mentions).length > 0
    ) {
      event.mentions = originalMsg.mentions;
    }
  } catch (e) {}

  return event;
}

module.exports = {
  ensureMentionsFromHistory,
};