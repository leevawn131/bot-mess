const fs = require('fs');
const { login } = require('ws3-fca');

login({appState: JSON.parse(fs.readFileSync('appstate.json', 'utf8'))}, async (err, api) => {
    if(err) return;
    try {
        const info = await api.getThreadInfo('24947224841545380');
        console.log("getThreadInfo Result:", info ? info.threadID : "null");
    } catch (e) {
        console.log("Error:", e);
    }
    process.exit(0);
});
