(async ()=>{
  const fs = require('fs');
  const util = require('util');
  const code = fs.readFileSync(__dirname + '/../modules/commands/tools/music.js', 'utf8');
  // Evaluate in current context
  try{
    eval(code + '\n; module = undefined;');
    if (typeof searchYouTubeList !== 'function') {
      console.error('searchYouTubeList not available');
      process.exit(1);
    }
    const results = await searchYouTubeList('fellie - bray', 5);
    console.log('RESULTS:', util.inspect(results, { depth: 5, colors: false }));
  }catch(e){
    console.error('ERROR', e && e.stack || e);
    process.exit(2);
  }
})();
