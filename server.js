const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { scrapeMaker } = require('./scraper_logic');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));



// Serve the character creator viewer
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});



const TMP_DIR = path.join(__dirname, 'tmp');
const DOWNLOADS_DIR = path.join(__dirname, 'public/downloads');

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Progress tracking (in-memory, simple for demo)
const sessions = {};

app.post('/api/scrape', async (req, res) => {
    const { url, savePath } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Validate custom save path if provided
    if (savePath) {
        try {
            if (!fs.existsSync(savePath)) {
                fs.mkdirSync(savePath, { recursive: true });
            }
        } catch (e) {
            return res.status(400).json({ error: `Đường dẫn không hợp lệ hoặc không có quyền ghi: ${savePath}` });
        }
    }

    const sessionId = Date.now().toString();
    sessions[sessionId] = { status: 'starting', progress: 0, total: 0, savePath: savePath || null };

    res.json({ sessionId });

    // Background processing
    try {
        // Use custom path as base download dir, or tmp as staging
        const useCustomPath = !!savePath;
        const downloadPath = useCustomPath ? savePath : path.join(TMP_DIR, sessionId);

        const { makerPath, imageMakerId } = await scrapeMaker(url, downloadPath, (current, total) => {
            sessions[sessionId].status = 'downloading';
            sessions[sessionId].progress = current;
            sessions[sessionId].total = total;
        });

        if (useCustomPath) {
            // Lưu thẳng vào thư mục tùy chỉnh — không cần ZIP
            sessions[sessionId].status = 'completed';
            sessions[sessionId].savedTo = makerPath;
            sessions[sessionId].downloadUrl = null;
            console.log(`[OK] Đã lưu vào: ${makerPath}`);
        } else {
            // Nén ZIP vào public/downloads như mặc định
            sessions[sessionId].status = 'zipping';

            const zipFileName = `Maker_${imageMakerId}_${sessionId}.zip`;
            const zipFilePath = path.join(DOWNLOADS_DIR, zipFileName);
            const output = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                sessions[sessionId].status = 'completed';
                sessions[sessionId].downloadUrl = `/downloads/${zipFileName}`;
                sessions[sessionId].savedTo = null;
                // Cleanup tmp folder
                fs.rmSync(downloadPath, { recursive: true, force: true });
            });

            archive.on('error', (err) => { throw err; });
            archive.pipe(output);
            archive.directory(makerPath, `Maker_${imageMakerId}`);
            await archive.finalize();
        }

    } catch (error) {
        console.error('Scrape error:', error);
        sessions[sessionId].status = 'error';
        sessions[sessionId].message = error.message;
    }
});

app.get('/api/status/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
