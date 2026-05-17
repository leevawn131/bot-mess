#!/usr/bin/env node
/**
 * Post-install patch script for ws3-fca
 * Fixes: "Cannot read properties of undefined (reading 'errors')" in formatThreadGraphQLResponse
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules/ws3-fca/src/deltas/apis/threads/getThreadInfo.js');

if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

// Check if already patched (check for the fix in formatThreadGraphQLResponse)
if (content.includes('if (!data || typeof data !== \'object\') return null;')) {
  console.log('✅ ws3-fca formatThreadGraphQLResponse already patched');
} else {
  // Patch vulnerability: if (data.errors) throws when data is undefined
  // Replace: if (data.errors) return null;
  // With:    if (!data || typeof data !== 'object') return null;
  //          if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) return null;
  
  // More flexible pattern matching - look for the problematic line
  const pattern = /function formatThreadGraphQLResponse\(data\)\s*{\s*if\s*\(\s*!data\s*\|\|\s*data\.errors\s*\)\s*return\s*null;/;
  
  if (pattern.test(content)) {
    content = content.replace(
      /(\s*if\s*\(\s*!data\s*\|\|\s*data\.errors\s*\)\s*return\s*null;)/,
      `\n  if (!data || typeof data !== 'object') return null;
  if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) return null;`
    );
    console.log('✅ Patched formatThreadGraphQLResponse null check');
  } else if (content.includes('if (data.errors) return null;')) {
    // Alternative pattern: just checking data.errors without null check
    content = content.replace(
      'if (data.errors) return null;',
      `if (!data || typeof data !== 'object') return null;
  if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) return null;`
    );
    console.log('✅ Patched formatThreadGraphQLResponse (alternative pattern)');
  } else {
    console.warn('⚠️  Could not find vulnerable pattern in formatThreadGraphQLResponse');
  }
}

  const getThreadInfoPattern = /return async function getThreadInfo\(threadID\) \{[\s\S]*?catch \(err\) \{[\s\S]*?\}\s*\};\s*\}$/m;
  const newGetThreadInfo = `return async function getThreadInfo(threadID) {
    const threadIDs = Array.isArray(threadID) ? threadID : [threadID];
    try {
        const threadInfos = {};
        const getListLimit = 50; // Try fetching 50 recent threads as a fallback
        let recentThreads = null;
        
        await Promise.all(threadIDs.map(async (t) => {
            const form = {
                doc_id: "5779546922121823", // Usually dead, but keep trying
                variables: JSON.stringify({
                    id: t,
                    message_limit: 0,
                    load_messages: false,
                    load_read_receipts: false,
                    before: null,
                })
            };

            try {
                const resData = await defaultFuncs
                    .post("https://www.facebook.com/api/graphql/", ctx.jar, form)
                    .then(utils.parseAndCheckLogin(ctx, defaultFuncs));

                if (resData && !resData.error && resData.data) {
                    const threadInfo = formatThreadGraphQLResponse(resData.data);
                    if (threadInfo) {
                        threadInfos[threadInfo.threadID || t] = threadInfo;
                        return; // Success
                    }
                }
            } catch (e) {
                // Ignore graphQL error, fallback to getThreadList
            }
            
            // Fallback: If not found via doc_id, fetch from getThreadList
            try {
                if (!recentThreads) {
                    recentThreads = await api.getThreadList(getListLimit, null, ["INBOX"]);
                }
                const foundThread = recentThreads.find(th => String(th.threadID) === String(t));
                if (foundThread) {
                    threadInfos[t] = foundThread;
                }
            } catch (e) {
                console.error("Fallback getThreadList error:", e);
            }
        }));

        return Array.isArray(threadID) ? threadInfos : Object.values(threadInfos)[0] || null;
    } catch (err) {
        utils.error("getThreadInfo", err);
        throw err;
    }
  };
}`;

  const startIndex = content.indexOf('return async function getThreadInfo(threadID) {');
  if (startIndex !== -1) {
    content = content.substring(0, startIndex) + newGetThreadInfo;
    console.log('✅ Patched getThreadInfo with fallback logic');
  } else {
    console.log('ℹ️  Could not find getThreadInfo to patch (might be already patched)');
  }

// Write patched file getThreadInfo.js
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ ws3-fca patches applied to getThreadInfo.js');

// Fix clients.js missing content-type header crash
const clientsPath = path.join(__dirname, 'node_modules/ws3-fca/src/utils/clients.js');
if (fs.existsSync(clientsPath)) {
  let clientsContent = fs.readFileSync(clientsPath, 'utf8');
  if (clientsContent.includes('if (data.request.headers["content-type"].split(";")[0] === "multipart/form-data")')) {
    clientsContent = clientsContent.replace(
      'if (data.request.headers["content-type"].split(";")[0] === "multipart/form-data")',
      `const contentType = data.request.headers["content-type"] || data.request.headers["Content-Type"] || "";\n      if (contentType.split(";")[0] === "multipart/form-data")`
    );
    fs.writeFileSync(clientsPath, clientsContent, 'utf8');
    console.log('✅ Patched clients.js null content-type check');
  }
}

// Fix getThreadList.js big_image_src.uri crash
const threadListPath = path.join(__dirname, 'node_modules/ws3-fca/src/deltas/apis/threads/getThreadList.js');
if (fs.existsSync(threadListPath)) {
  let threadListContent = fs.readFileSync(threadListPath, 'utf8');
  if (threadListContent.includes('thumbSrc: d.node.messaging_actor.big_image_src.uri,')) {
    threadListContent = threadListContent.replace(
      'thumbSrc: d.node.messaging_actor.big_image_src.uri,',
      'thumbSrc: d.node.messaging_actor.big_image_src ? d.node.messaging_actor.big_image_src.uri : null,'
    );
    threadListContent = threadListContent.replace(
      'profileUrl: d.node.messaging_actor.big_image_src.uri,',
      'profileUrl: d.node.messaging_actor.big_image_src ? d.node.messaging_actor.big_image_src.uri : null,'
    );
    threadListContent = threadListContent.replace(
      /adminIDs: messageThread\.thread_admins\.map\(a => a\.id\),/g,
      'adminIDs: messageThread.thread_admins.map(a => ({ id: a.id || a })),'
    );
    fs.writeFileSync(threadListPath, threadListContent, 'utf8');
    console.log('✅ Patched getThreadList.js big_image_src and adminIDs check');
  }
}

// 4. Patch formatDelta.js (Debug Mentions API)
const formatDeltaPath = path.join(__dirname, 'node_modules/ws3-fca/src/utils/formatters/data/formatDelta.js');
let formatDeltaContent = fs.readFileSync(formatDeltaPath, 'utf8');

if (!formatDeltaContent.includes('delta_debug.json')) {
  formatDeltaContent = formatDeltaContent.replace(
    'function formatDeltaMessage(m) {',
    `function formatDeltaMessage(m) {\n    if (m.delta.body && m.delta.body.includes('@')) {\n        require('fs').writeFileSync('/app/delta_debug.json', JSON.stringify(m.delta, null, 2));\n    }`
  );
  fs.writeFileSync(formatDeltaPath, formatDeltaContent);
  console.log('✅ Patched formatDelta.js (Added Mention Payload Debugger)');
}
