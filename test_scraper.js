const { scrapeMaker } = require('./scraper_logic');
const path = require('path');
const fs = require('fs');

async function test() {
    const url = 'https://picrew.me/en/image_maker/1';
    const testDir = path.join(__dirname, 'test_download');
    
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
    
    console.log('--- Testing scraper with Astro support ---');
    try {
        const result = await scrapeMaker(url, testDir, (curr, total) => {
            if (curr % 10 === 0 || curr === total) {
                console.log(`Progress: ${curr}/${total}`);
            }
        });
        console.log('✅ Success!', result);
    } catch (e) {
        console.error('❌ Failed:', e);
    }
}

test();
