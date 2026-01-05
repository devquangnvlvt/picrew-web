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
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const sessionId = Date.now().toString();
    sessions[sessionId] = { status: 'starting', progress: 0, total: 0 };

    res.json({ sessionId });

    // Background processing
    try {
        const downloadPath = path.join(TMP_DIR, sessionId);
        const { makerPath, imageMakerId } = await scrapeMaker(url, downloadPath, (current, total) => {
            sessions[sessionId].status = 'downloading';
            sessions[sessionId].progress = current;
            sessions[sessionId].total = total;
        });

        sessions[sessionId].status = 'zipping';

        const zipFileName = `Maker_${imageMakerId}_${sessionId}.zip`;
        const zipFilePath = path.join(DOWNLOADS_DIR, zipFileName);
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            sessions[sessionId].status = 'completed';
            sessions[sessionId].downloadUrl = `/downloads/${zipFileName}`;
            // Cleanup tmp folder
            fs.rmSync(downloadPath, { recursive: true, force: true });
        });

        archive.on('error', (err) => { throw err; });
        archive.pipe(output);
        archive.directory(makerPath, `Maker_${imageMakerId}`);
        await archive.finalize();

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
