const fs = require('fs');
const { login } = require('ws3-fca');

login({appState: JSON.parse(fs.readFileSync('appstate.json', 'utf8'))}, async (err, api) => {
    if(err) return;
    try {
        const info = await api.getThreadList(50, null, ["INBOX"]);
        console.log("getThreadList Success!", info.length);
    } catch (e) {
        console.log("getThreadList Error:", e);
    }
    process.exit(0);
});
