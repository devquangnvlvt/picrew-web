const fs = require('fs');
const https = require('https');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://picrew.me/',
    'Origin': 'https://picrew.me'
};

async function scrapeMaker(input, downloadDir, progressCallback) {
    let html;
    if (input.startsWith('http')) {
        html = await fetchHtmlContent(input);
    } else {
        html = fs.readFileSync(input, 'utf8');
    }

    const nuxtData = extractNuxtData(html);
    const state = nuxtData.state || {};
    const imageMakerId = state.imageMakerId || 'unknown';
    const makerPath = path.join(downloadDir, `Maker_${imageMakerId}`);

    if (!fs.existsSync(makerPath)) {
        fs.mkdirSync(makerPath, { recursive: true });
    }

    const { imagesArray, updatedConfig } = collectImageUrlsWithSequentialIndexing(nuxtData, `Maker_${imageMakerId}`);

    // Save updated p_config.json
    fs.writeFileSync(path.join(makerPath, 'p_config.json'), JSON.stringify(updatedConfig, null, 2));

    await downloadAllImages(imagesArray, downloadDir, progressCallback);


    generateAssetsJson(imagesArray, downloadDir); // Generate assets.json

    return { makerPath, imageMakerId };
}

function generateAssetsJson(imagesList, downloadDir) {
    // Extract Maker ID and Folder from the first image path
    const firstPath = imagesList[0]?.relativePath;
    if (!firstPath) return;

    // Relative path format is "Maker_XXXX/..."
    const parts = firstPath.split(path.sep).filter(p => p !== '');
    const makerFolderName = parts[0];
    const makerDir = path.join(downloadDir, makerFolderName);

    // Scan directory structure
    const assets = [];

    try {
        if (!fs.existsSync(makerDir)) return;

        const x_y_Folders = fs.readdirSync(makerDir).filter(f => /^\d+-\d+$/.test(f) && fs.statSync(path.join(makerDir, f)).isDirectory());

        x_y_Folders.sort((a, b) => {
            const [x1, y1] = a.split('-').map(Number);
            const [x2, y2] = b.split('-').map(Number);
            return x1 - x2 || y1 - y2;
        });

        x_y_Folders.forEach(folder => {
            const [x, y] = folder.split('-').map(Number);
            const folderPath = path.join(makerDir, folder);

            const entry = {
                folder: folder,
                x: x,
                y: y,
                colors: []
            };

            const contents = fs.readdirSync(folderPath);

            // Check for flattened items (directly in X-Y)
            const rootItems = contents.filter(c => /\.(png|jpg|jpeg|webp)$/i.test(c) && c !== 'nav.png');
            if (rootItems.length > 0) {
                entry.colors.push({
                    code: 'default', // Single color or no color variation
                    items: rootItems.sort((a, b) => parseInt(a) - parseInt(b))
                });
            }

            // Check for color subfolders
            const subDirs = contents.filter(c => fs.statSync(path.join(folderPath, c)).isDirectory());
            subDirs.forEach(sub => {
                const subPath = path.join(folderPath, sub);
                const items = fs.readdirSync(subPath).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
                if (items.length > 0) {
                    entry.colors.push({
                        code: sub,
                        items: items
                    });
                }
            });

            assets.push(entry);
        });

        const assetsPath = path.join(makerDir, 'assets.json');
        fs.writeFileSync(assetsPath, JSON.stringify(assets, null, 2));

    } catch (e) {
        console.error("Error generating assets.json:", e);
    }
}

function fetchHtmlContent(url) {
    return new Promise((resolve, reject) => {
        const options = { headers: HEADERS };
        https.get(url, options, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function extractAstroData(html) {
    const startMarker = '<script id="it-astro-state" type="application/json+devalue">';
    const endMarker = '</script>';
    const startIndex = html.indexOf(startMarker);
    if (startIndex === -1) return null;
    const endIndex = html.indexOf(endMarker, startIndex);
    if (endIndex === -1) return null;

    const jsonStr = html.substring(startIndex + startMarker.length, endIndex);
    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse Astro JSON:", e);
        return null;
    }

    function unflatten(parsed) {
        if (!Array.isArray(parsed)) return parsed;
        const instances = new Map();
        function walk(index) {
            if (typeof index !== 'number') return index;
            if (index < 0 || index >= parsed.length) return index;
            if (instances.has(index)) return instances.get(index);

            const val = parsed[index];
            if (val === null || typeof val !== 'object') {
                return val;
            }
            if (Array.isArray(val)) {
                if (val[0] === 'Map') {
                    const map = {};
                    instances.set(index, map);
                    for (let i = 1; i < val.length; i += 2) {
                        const k = walk(val[i]);
                        const v = walk(val[i + 1]);
                        if (k !== undefined) map[k] = v;
                    }
                    return map;
                }
                const arr = [];
                instances.set(index, arr);
                for (let i = 0; i < val.length; i++) {
                    arr[i] = walk(val[i]);
                }
                return arr;
            }
            const obj = {};
            instances.set(index, obj);
            for (const key in val) {
                obj[key] = walk(val[key]);
            }
            return obj;
        }
        return walk(0);
    }

    const reconstructed = unflatten(parsed);

    let makerState = null;
    function findMakerState(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 15) return;
        if (obj.info && obj.info.id && obj.cf && obj.cf.pList && obj.img && obj.img.lst) {
            makerState = obj;
            return;
        }
        for (let k in obj) {
            findMakerState(obj[k], depth + 1);
            if (makerState) return;
        }
    }

    findMakerState(reconstructed);

    if (!makerState) return null;

    return {
        state: {
            imageMakerId: makerState.info.id,
            config: makerState.cf,
            commonImages: makerState.img.lst,
            memberImages: {}
        }
    };
}

function extractNuxtData(html) {
    // 1. Try Astro (New Picrew structure)
    try {
        const astroData = extractAstroData(html);
        if (astroData) return astroData;
    } catch (e) {
        console.error("Astro extraction failed:", e);
    }

    // 2. Try Nuxt (Old Picrew structure fallback)
    const startMarker = '<script>window.__NUXT__=';
    const endMarker = ';</script>';
    const startIndex = html.indexOf(startMarker);
    const endIndex = html.indexOf(endMarker, startIndex);

    if (startIndex !== -1 && endIndex !== -1) {
        try {
            const scriptContent = html.substring(startIndex + '<script>'.length, endIndex + 1);
            const sandbox = { window: {} };
            vm.createContext(sandbox);
            vm.runInContext(scriptContent, sandbox);
            return sandbox.window.__NUXT__;
        } catch (e) {
            console.error("Nuxt fallback failed:", e);
        }
    }

    throw new Error('Không tìm thấy dữ liệu Picrew (Astro/Nuxt not found). Trang web có thể đã thay đổi cấu trúc hoặc URL không hợp lệ.');
}

function collectImageUrlsWithSequentialIndexing(nuxtData, makerFolderName) {
    const state = nuxtData.state || {};
    const config = JSON.parse(JSON.stringify(state.config || {})); // Deep copy
    const lyrList = config.lyrList || {};
    const cpList = config.cpList || {};
    const commonImages = state.commonImages || {};
    const memberImages = state.memberImages || {};

    // Helper to get file extension from URL
    const getExtension = (url) => {
        const match = url.match(/\.(png|jpg|jpeg|gif|webp)(\?|$)/i);
        return match ? match[1] : 'png';
    };

    // --- Step 1: Identify Active Items and Parts ---
    const activeItmIds = new Set();
    const processActiveIds = (sourceObj) => {
        for (const itemId in sourceObj) {
            const layers = sourceObj[itemId];
            for (const lyrId in layers) {
                for (const colorId in layers[lyrId]) {
                    if (layers[lyrId][colorId].url) {
                        activeItmIds.add(itemId);
                        break;
                    }
                }
                if (activeItmIds.has(itemId)) break;
            }
        }
    };
    processActiveIds(commonImages);
    processActiveIds(memberImages);

    const activeParts = [];
    if (config.pList) {
        config.pList.forEach(part => {
            const hasActiveItems = part.items && part.items.some(item => activeItmIds.has(item.itmId.toString()));
            if (hasActiveItems) {
                activeParts.push(part);
            }
        });
    }
    // Update config to only include active parts
    config.pList = activeParts;

    // --- Step 2: Create Virtual Parts for Each Layer ---
    const virtualParts = [];
    const zToNewX = {};
    const layerToVirtualPart = {}; // Mapping of original PartID-LayerID to VirtualPart object
    let globalYCounter = 1;

    // First, collect all unique active Z-orders for X mapping
    const activeZOrders = new Set();
    activeParts.forEach(part => {
        if (part.lyrs) {
            part.lyrs.forEach(lyrId => {
                if (lyrList[lyrId] !== undefined) activeZOrders.add(lyrList[lyrId]);
            });
        }
    });
    const sortedZOrders = Array.from(activeZOrders).sort((a, b) => a - b);
    sortedZOrders.forEach((z, index) => { zToNewX[z] = index + 1; });

    // Build Virtual Parts
    activeParts.forEach(part => {
        const layers = part.lyrs || ['default'];
        layers.forEach(lyrId => {
            const z = lyrList[lyrId] !== undefined ? lyrList[lyrId] : 0;
            const X = zToNewX[z] || 0;
            const Y = globalYCounter++;

            const vPart = {
                ...part,
                pId: Y, // Virtual Part ID is the Y counter
                originalPId: part.pId,
                originalLyrId: lyrId,
                X,
                Y,
                items: [] // Will be populated with re-indexed items
            };

            // Identify items active for THIS specific layer
            let localN = 1;
            part.items.forEach(item => {
                const itemIdStr = item.itmId.toString();
                // Check if this item has data specifically for this layer
                let hasLayerData = false;
                const checkSource = (source) => {
                    if (source[itemIdStr] && source[itemIdStr][lyrId]) {
                        for (const colorId in source[itemIdStr][lyrId]) {
                            if (source[itemIdStr][lyrId][colorId].url) return true;
                        }
                    }
                    return false;
                };

                if (checkSource(commonImages) || checkSource(memberImages)) {
                    const newItem = { ...item, itmId: localN, originalItmId: item.itmId };
                    vPart.items.push(newItem);
                    localN++;
                }
            });

            if (vPart.items.length > 0) {
                virtualParts.push(vPart);
                layerToVirtualPart[`${part.pId}-${lyrId}`] = vPart;
            }
        });
    });

    // Update final pList
    config.pList = virtualParts.map(vp => {
        const { originalPId, originalLyrId, X, Y, ...rest } = vp;
        return { ...rest };
    });

    // --- Step 3: Generate Image List and Update Map Assets ---
    const imagesArray = [];

    virtualParts.forEach(vp => {
        const { X, Y, thumbUrl, originalLyrId } = vp;
        const folderName = `${X}-${Y}`;

        // Add thumbnail (navigation image)
        if (thumbUrl) {
            const fullUrl = thumbUrl.startsWith('http') ? thumbUrl : `https://cdn.picrew.me${thumbUrl}`;
            imagesArray.push({
                url: fullUrl,
                relativePath: path.join(makerFolderName, folderName, `nav.${getExtension(fullUrl)}`)
            });
        }

        // Add items
        vp.items.forEach(item => {
            const oldId = item.originalItmId;
            const newN = item.itmId;

            const processSource = (sourceObj) => {
                const itemData = sourceObj[oldId];
                if (!itemData || !itemData[originalLyrId]) return;

                const colors = itemData[originalLyrId];
                for (const colorId in colors) {
                    const entry = colors[colorId];
                    if (entry.url) {
                        const fullUrl = entry.url.startsWith('http') ? entry.url : `https://cdn.picrew.me${entry.url}`;

                        let colorSubFolder = colorId;
                        if (cpList[vp.cpId]) {
                            const colorEntry = cpList[vp.cpId].find(c => c.cId.toString() === colorId.toString());
                            if (colorEntry && colorEntry.cd) colorSubFolder = colorEntry.cd.replace('#', '');
                        }

                        imagesArray.push({
                            url: fullUrl,
                            relativePath: path.join(makerFolderName, folderName, colorSubFolder.toString(), `${newN}.${getExtension(fullUrl)}`)
                        });
                    }
                }
            };

            processSource(commonImages);
            processSource(memberImages);
        });
    });

    // --- Step 4: Map Original State to New Config Structure (for viewer compatibility) ---
    // Note: To make the viewer work with split parts, we'd ideally transform commonImages/memberImages.
    // However, since we are returning updatedConfig, let's just make sure pList is consistent.
    // The viewer logic usually relies on pList to render the UI.

    return { imagesArray, updatedConfig: config };
}

async function compressImage(filePath) {
    const lowerPath = filePath.toLowerCase();
    const tmpPath = `${filePath}.compress.tmp`;

    try {
        if (lowerPath.endsWith('.png')) {
            await sharp(filePath)
                .png({ compressionLevel: 9, palette: true, quality: 75 })
                .toFile(tmpPath);
        } else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
            await sharp(filePath)
                .jpeg({ quality: 75, mozjpeg: true })
                .toFile(tmpPath);
        } else if (lowerPath.endsWith('.webp')) {
            await sharp(filePath)
                .webp({ quality: 75 })
                .toFile(tmpPath);
        } else {
            return; // Không xử lý các định dạng khác
        }

        // Chỉ thay thế nếu file nén thực sự nhỏ hơn
        const originalSize = fs.statSync(filePath).size;
        const compressedSize = fs.statSync(tmpPath).size;

        if (compressedSize < originalSize) {
            fs.unlinkSync(filePath);
            fs.renameSync(tmpPath, filePath);
        } else {
            fs.unlinkSync(tmpPath); // Bỏ qua nếu nén xong lại to hơn
        }
    } catch (e) {
        // Không để lỗi nén làm hỏng cả quá trình
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
    }
}

function isImageCorrupted(filePath) {
    try {
        if (!fs.existsSync(filePath)) return true;
        const stats = fs.statSync(filePath);
        if (stats.size === 0) return true;

        const lowerPath = filePath.toLowerCase();
        // Check PNG signature
        if (lowerPath.endsWith('.png')) {
            if (stats.size < 8) return true;
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(8);
            fs.readSync(fd, buffer, 0, 8, stats.size - 8);
            fs.closeSync(fd);

            // Expected PNG end marker: 49 45 4E 44 AE 42 60 82
            const pngEnd = [0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];
            for (let i = 0; i < 8; i++) {
                if (buffer[i] !== pngEnd[i]) {
                    return true;
                }
            }
        }

        // Check JPEG signature
        if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
            if (stats.size < 2) return true;
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(2);
            fs.readSync(fd, buffer, 0, 2, stats.size - 2);
            fs.closeSync(fd);

            if (buffer[0] !== 0xFF || buffer[1] !== 0xD9) {
                return true;
            }
        }

        return false;
    } catch (e) {
        return true;
    }
}

async function downloadAllImages(imagesList, downloadDir, progressCallback) {
    let completed = 0;
    const MAX_CONCURRENT = 5;
    let index = 0;

    async function worker() {
        while (index < imagesList.length) {
            const currentIdx = index++;
            const img = imagesList[currentIdx];
            await downloadFile(img.url, path.join(downloadDir, img.relativePath));
            completed++;
            if (progressCallback) {
                progressCallback(completed, imagesList.length);
            }
        }
    }

    const workers = [];
    const numWorkers = Math.min(MAX_CONCURRENT, imagesList.length);
    for (let i = 0; i < numWorkers; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
}

function downloadFile(url, localPath, retries = 3) {
    return new Promise((resolve) => {
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // If file exists and is not corrupted, skip downloading
        if (fs.existsSync(localPath) && !isImageCorrupted(localPath)) {
            return resolve(true);
        }

        let attempt = 0;

        function tryDownload() {
            attempt++;
            const tmpPath = `${localPath}.tmp`;

            if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch (_) { }
            }

            const options = {
                headers: HEADERS,
                timeout: 10000
            };

            let finished = false;

            const req = https.get(url, options, (res) => {
                if (res.statusCode !== 200) {
                    cleanupAndRetry(new Error(`Server returned status code ${res.statusCode}`));
                    return;
                }

                const contentLength = parseInt(res.headers['content-length'], 10);
                const file = fs.createWriteStream(tmpPath);
                let downloadedBytes = 0;

                res.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                });

                res.pipe(file);

                let aborted = false;
                res.on('aborted', () => {
                    aborted = true;
                    file.destroy();
                    cleanupAndRetry(new Error('Connection aborted by server'));
                });

                file.on('finish', () => {
                    file.close(async (err) => {
                        if (finished) return;
                        if (err) {
                            cleanupAndRetry(err);
                            return;
                        }
                        if (aborted) return;

                        if (!isNaN(contentLength) && downloadedBytes !== contentLength) {
                            cleanupAndRetry(new Error(`Size mismatch: expected ${contentLength}, got ${downloadedBytes}`));
                            return;
                        }

                        if (isImageCorrupted(tmpPath)) {
                            cleanupAndRetry(new Error('Downloaded file is corrupted'));
                            return;
                        }

                        finished = true;
                        try {
                            if (fs.existsSync(localPath)) {
                                fs.unlinkSync(localPath);
                            }
                            fs.renameSync(tmpPath, localPath);
                            await compressImage(localPath);
                            resolve(true);
                        } catch (renameErr) {
                            cleanupAndRetry(renameErr);
                        }
                    });
                });

                file.on('error', (err) => {
                    file.destroy();
                    cleanupAndRetry(err);
                });
            });

            req.on('error', (err) => {
                cleanupAndRetry(err);
            });

            req.on('timeout', () => {
                req.destroy();
                cleanupAndRetry(new Error('Request timeout'));
            });

            function cleanupAndRetry(err) {
                if (finished) return;
                finished = true;

                if (fs.existsSync(tmpPath)) {
                    try { fs.unlinkSync(tmpPath); } catch (_) { }
                }

                console.error(`Download failed (attempt ${attempt}/${retries}) for ${url}: ${err.message}`);

                if (attempt < retries) {
                    setTimeout(tryDownload, 1000 * attempt);
                } else {
                    resolve(false);
                }
            }
        }

        tryDownload();
    });
}

module.exports = { scrapeMaker, collectImageUrlsWithSequentialIndexing };
