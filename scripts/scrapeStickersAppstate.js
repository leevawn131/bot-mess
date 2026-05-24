const fs = require('fs');
const { login } = require('ws3-fca');

const appState = JSON.parse(fs.readFileSync('appstate.json', 'utf8'));

login({ appState }, (err, api) => {
    if(err) return console.error(err);
    api.stickers.getStickersInPack('1653933001859266').then(pack => {
        let ids = pack.map(s => Number(s.id || s.stickerID || s.sticker_id || s.node?.id));
        console.log(`Found ${ids.length} Pocket Peaches stickers.`);
        
        let config = JSON.parse(fs.readFileSync('config.json'));
        config.greetingStickers = ids.filter(i => !isNaN(i));
        fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
        console.log('Successfully updated config.json with correct stickers!');
        process.exit(0);
    }).catch(console.error);
});
