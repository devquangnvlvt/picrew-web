const { scrapeMaker } = require('./scraper_logic');
const path = require('path');
const fs = require('fs');

const url = process.argv[2];
if (!url) {
    console.error('Cách dùng: node cli.js [URL]');
    console.error('Ví dụ: node cli.js https://picrew.me/en/secret_image_maker/9FA1DqSHdHbebP8R');
    process.exit(1);
}

const downloadsDir = path.join(__dirname, 'public', 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

async function run() {
    console.log(`Đang bắt đầu tải từ: ${url}`);
    try {
        const { makerPath, imageMakerId } = await scrapeMaker(url, downloadsDir, (current, total) => {
            if (current % 100 === 0 || current === total) {
                process.stdout.write(`\rTiến độ: ${current}/${total}`);
            }
        });
        console.log(`\n\n[Hoàn tất] Tải thành công!`);
        console.log(`Ảnh được lưu tại thư mục: public/downloads/Maker_${imageMakerId}`);
    } catch (error) {
        console.error(`\n[Lỗi] Không thể tải:`, error.message);
    }
}

run();
