const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const pLimit = require('p-limit');
const { EventEmitter } = require('events');

/**
 * server/controllers/imageSearchController.js
 *
 * Responsibilities:
 * - Search for Borborbor/Volta/Ewe dance images from multiple sources (Wikimedia implemented)
 * - Download images with error handling and rate limiting
 * - Resize/optimize/convert to JPEG & WebP (max 1920x1080)
 * - Generate thumbnails
 * - Extract and store metadata and attribution
 * - Auto-categorize images (performance/ceremony/practice)
 * - Validate quality, remove duplicates, dedupe via perceptual hash (dHash)
 * - Save files to server/uploads/gallery/
 * - Update DB via a pluggable model interface
 * - Provide progress tracking via callbacks or EventEmitter style
 *
 * Dependencies (install in your project):
 *   npm install axios sharp p-limit
 *
 * Notes:
 * - This controller uses Wikimedia Commons API for searches. Other adapters can be added.
 * - Database integration uses a pluggable imageModel with async saveImage(record) method.
 */


const UPLOAD_DIR = path.resolve(__dirname, '../../server/uploads/gallery'); // adjust base if needed
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 180;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 80;
const MIN_WIDTH = 400; // minimum acceptable dimension
const MIN_HEIGHT = 300;
const CONCURRENT_DOWNLOADS = 3; // concurrency for downloads
const DELAY_BETWEEN_REQUESTS_MS = 200; // basic throttling between remote API calls

// Pluggable DB model. Create ../models/imageModel.js exporting async saveImage(record) if you want DB integration.
// Fallback to a noop that writes JSON locally for demo/testing.
let imageModel;
try {
    imageModel = require('../models/imageModel');
} catch (e) {
    imageModel = {
        async saveImage(record) {
            // fallback: append to local JSON file for the dev environment
            const dbPath = path.resolve(__dirname, '../../server/uploads/gallery/_image_records.json');
            let arr = [];
            try {
                if (fs.existsSync(dbPath)) {
                    arr = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                }
            } catch (err) {
                // ignore
            }
            arr.push(record);
            fs.writeFileSync(dbPath, JSON.stringify(arr, null, 2), 'utf8');
            return record;
        }
    };
}

/* Utility helpers */

async function ensureUploadDir() {
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeFilename(name) {
    return name
        .replace(/[^a-z0-9_\-\.]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/(^-|-$)/g, '')
        .toLowerCase()
        .slice(0, 160);
}

// Compute dHash for duplicate detection: 8x8 hash
async function computeDHash(buffer) {
    // Resize to 9x8, grayscale, then compare adjacent pixels horizontally
    const resized = await sharp(buffer)
        .grayscale()
        .resize(9, 8, { fit: 'fill' })
        .raw()
        .toBuffer();
    const pixels = resized; // Uint8
    let hash = '';
    for (let row = 0; row < 8; row++) {
        let rowHash = 0;
        for (let col = 0; col < 8; col++) {
            const idx = row * 9 + col;
            const left = pixels[idx];
            const right = pixels[idx + 1];
            rowHash = (rowHash << 1) | (left > right ? 1 : 0);
        }
        hash += rowHash.toString(16).padStart(2, '0');
    }
    return hash;
}

function hammingDistance(hexA, hexB) {
    // convert hex strings to binary and count differing bits
    const a = BigInt('0x' + hexA);
    const b = BigInt('0x' + hexB);
    let x = a ^ b;
    let dist = 0;
    while (x) {
        dist += Number(x & 1n);
        x >>= 1n;
    }
    return dist;
}

/* Search Adapters */

// Wikimedia Commons search implementation
async function wikimediaSearch(query, limit = 20) {
    // returns array of {title, url, thumb, metadata}
    const endpoint = 'https://commons.wikimedia.org/w/api.php';
    const params = {
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrsearch: query,
        gsrlimit: limit,
        prop: 'imageinfo|pageprops',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: 1920
    };
    const url = endpoint + '?' + new URLSearchParams(params).toString();
    const response = await axios.get(url, { timeout: 20000 });
    const pages = response.data.query && response.data.query.pages ? response.data.query.pages : {};
    const results = Object.values(pages)
        .filter((p) => p.imageinfo && p.imageinfo.length)
        .map((p) => {
            const ii = p.imageinfo[0];
            const ext = ii.extmetadata || {};
            return {
                id: p.pageid,
                title: p.title,
                source: 'Wikimedia Commons',
                originalUrl: ii.url,
                thumbUrl: ii.thumburl || ii.url,
                mime: ii.mime,
                width: ii.width,
                height: ii.height,
                size: ii.size,
                metadata: {
                    artist: ext.Artist ? ext.Artist.value : null,
                    license: ext.LicenseShortName ? ext.LicenseShortName.value : null,
                    licenseUrl: ext.UsageTerms ? ext.UsageTerms.value : null,
                    credit: ext.Credit ? ext.Credit.value : null,
                    date: ext.DateTime ? ext.DateTime.value : null,
                    description: ext.ImageDescription ? ext.ImageDescription.value : null
                }
            };
        });
    return results;
}

/* Categorization heuristics */
function categorizeImage(title = '', description = '') {
    const text = ((title || '') + ' ' + (description || '')).toLowerCase();
    if (/practice|rehearsal/.test(text)) return 'practice';
    if (/ceremony|festival|ritual|funeral|celebration/.test(text)) return 'ceremony';
    if (/performance|dance|show|troupe|band/.test(text)) return 'performance';
    // fallback
    return 'performance';
}

/* Simple content validation and quality checks */
async function validateImageQuality(buffer, meta) {
    // meta: {width, height, size}
    const reasons = [];
    if (meta.width < MIN_WIDTH || meta.height < MIN_HEIGHT) {
        reasons.push('dimensions_too_small');
    }
    // basic contrast check via stddev: low stddev -> low contrast -> possibly low quality
    try {
        const stats = await sharp(buffer).stats();
        const stddev = (stats.channels || []).reduce((acc, ch) => acc + ch.stdev, 0) / (stats.channels.length || 1);
        if (stddev < 10) {
            reasons.push('low_contrast_or_flat');
        }
    } catch (e) {
        // ignore stats errors
    }
    // file size sanity check
    if (meta.size && meta.size < 8 * 1024) reasons.push('file_too_small');
    return {
        ok: reasons.length === 0,
        reasons
    };
}

/* Image processing pipeline */
async function processAndSaveImage({ buffer, filenameBase, ext = 'jpg', sourceMeta = {}, progress = null }) {
    // ensures upload dir exists. Produces:
    // - filenameBase.jpg (optimized)
    // - filenameBase.webp
    // - filenameBase.thumb.jpg
    // returns record with paths and metadata
    await ensureUploadDir();
    const hashedBase = `${Date.now()}-${safeFilename(filenameBase)}`;
    const jpegName = `${hashedBase}.jpg`;
    const webpName = `${hashedBase}.webp`;
    const thumbName = `${hashedBase}_thumb.jpg`;

    const jpegPath = path.join(UPLOAD_DIR, jpegName);
    const webpPath = path.join(UPLOAD_DIR, webpName);
    const thumbPath = path.join(UPLOAD_DIR, thumbName);

    // Resize preserving aspect ratio with max (1920x1080)
    const img = sharp(buffer).rotate();

    const metadata = await img.metadata();
    const resizeOptions = {
        fit: 'inside',
        withoutEnlargement: true
    };

    // Compute target size while preserving aspect ratio
    const width = metadata.width || MAX_WIDTH;
    const height = metadata.height || MAX_HEIGHT;
    let targetWidth = width;
    let targetHeight = height;
    if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const aspect = width / height;
        if (aspect >= MAX_WIDTH / MAX_HEIGHT) {
            targetWidth = MAX_WIDTH;
            targetHeight = Math.round(MAX_WIDTH / aspect);
        } else {
            targetHeight = MAX_HEIGHT;
            targetWidth = Math.round(MAX_HEIGHT * aspect);
        }
    }

    // Save optimized JPEG
    await img
        .resize(targetWidth, targetHeight, resizeOptions)
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(jpegPath);

    // Save optimized WebP
    await img
        .resize(targetWidth, targetHeight, resizeOptions)
        .webp({ quality: WEBP_QUALITY })
        .toFile(webpPath);

    // Create thumbnail (cover to ensure consistent preview sizes)
    await img
        .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toFile(thumbPath);

    // re-stat saved files
    const jpegStat = await fs.promises.stat(jpegPath);
    const webpStat = await fs.promises.stat(webpPath);
    const thumbStat = await fs.promises.stat(thumbPath);

    if (progress && typeof progress === 'function') {
        progress({ type: 'saved', jpeg: jpegPath, webp: webpPath, thumb: thumbPath });
    }

    return {
        savedFiles: { jpeg: jpegPath, webp: webpPath, thumb: thumbPath },
        savedSizes: { jpeg: jpegStat.size, webp: webpStat.size, thumb: thumbStat.size },
        dimensions: { width: targetWidth, height: targetHeight },
        originalMetadata: metadata,
        sourceMeta
    };
}

/* Main controller logic */

/**
 * searchAndDownloadImages(options)
 * options:
 *  - keywords: array of search strings (defaults provided)
 *  - sources: array of source identifiers to use (defaults ['wikimedia'])
 *  - limitPerSource: number
 *  - progressCallback: function(progressObj) // invoked frequently with {phase, done, total, current, info}
 *  - maxResults: overall max images to process
 *
 * Returns:
 *  { successes: [], failures: [], summary: {...} }
 */
async function searchAndDownloadImages({
    keywords = [
        'Borborbor dance Ghana',
        'Volta Region cultural dance',
        'Ewe traditional dance'
    ],
    sources = ['wikimedia'],
    limitPerSource = 30,
    progressCallback = null,
    maxResults = 50
} = {}) {
    const emitter = new EventEmitter();
    if (progressCallback) emitter.on('progress', progressCallback);

    const postProgress = (payload) => {
        try {
            emitter.emit('progress', payload);
        } catch (e) {
            // ignore callbacks failure
        }
    };

    const allCandidates = [];

    // Search phase
    postProgress({ phase: 'search_start', totalKeywords: keywords.length });
    for (const kw of keywords) {
        for (const src of sources) {
            try {
                await delay(DELAY_BETWEEN_REQUESTS_MS);
                if (src === 'wikimedia') {
                    postProgress({ phase: 'searching', source: 'wikimedia', query: kw });
                    const results = await wikimediaSearch(`${kw} Volta Region Ghana Ewe`, limitPerSource);
                    for (const r of results) {
                        allCandidates.push(r);
                        if (allCandidates.length >= maxResults) break;
                    }
                } else {
                    // placeholder for other sources (Ghana tourism sites/cultural archives)
                    postProgress({ phase: 'search_skipped', source: src, reason: 'adapter_not_implemented' });
                }
            } catch (err) {
                postProgress({ phase: 'search_error', source: src, query: kw, error: (err && err.message) || String(err) });
            }
            if (allCandidates.length >= maxResults) break;
        }
        if (allCandidates.length >= maxResults) break;
    }

    postProgress({ phase: 'search_completed', found: allCandidates.length });

    // Deduplicate candidate URLs
    const urlMap = new Map();
    for (const c of allCandidates) {
        if (!c.originalUrl) continue;
        if (!urlMap.has(c.originalUrl)) urlMap.set(c.originalUrl, c);
    }
    const uniqueCandidates = Array.from(urlMap.values());

    // Download + process with concurrency and rate limiting
    const limit = pLimit(CONCURRENT_DOWNLOADS);

    const processedHashes = new Set();
    const successes = [];
    const failures = [];

    let processedCount = 0;

    const tasks = uniqueCandidates.map((candidate, idx) =>
        limit(async () => {
            const progressPrefix = `candidate-${idx}`;
            postProgress({ phase: 'download_start', index: idx, url: candidate.originalUrl });

            try {
                await delay(DELAY_BETWEEN_REQUESTS_MS); // simple throttle
                const response = await axios.get(candidate.originalUrl, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    headers: { 'User-Agent': 'elorm-borborbor-website/1.0 (image-crawler)' }
                });

                const buffer = Buffer.from(response.data);
                const sourceMeta = {
                    source: candidate.source || 'unknown',
                    title: candidate.title || null,
                    description: candidate.metadata && candidate.metadata.description ? candidate.metadata.description : null,
                    originalUrl: candidate.originalUrl,
                    thumbUrl: candidate.thumbUrl,
                    providerMeta: candidate.metadata || {}
                };

                const meta = {
                    width: candidate.width || null,
                    height: candidate.height || null,
                    size: candidate.size || buffer.length
                };

                // compute dHash for dedupe
                let dhash = null;
                try {
                    dhash = await computeDHash(buffer);
                } catch (e) {
                    // ignore hash errors
                }

                if (dhash) {
                    // compare with existing processed hashes
                    let isDup = false;
                    for (const existing of processedHashes) {
                        const dist = hammingDistance(dhash, existing);
                        if (dist <= 6) {
                            isDup = true;
                            break;
                        }
                    }
                    if (isDup) {
                        postProgress({ phase: 'skipped_duplicate', index: idx, url: candidate.originalUrl });
                        failures.push({ url: candidate.originalUrl, reason: 'duplicate' });
                        return;
                    }
                }

                // If metadata width/height missing, get from buffer via sharp
                let derivedMeta = { ...meta };
                if (!meta.width || !meta.height) {
                    try {
                        const md = await sharp(buffer).metadata();
                        derivedMeta.width = md.width;
                        derivedMeta.height = md.height;
                        derivedMeta.format = md.format;
                    } catch (e) {
                        // ignore
                    }
                }

                // Validate quality
                const validation = await validateImageQuality(buffer, derivedMeta);
                if (!validation.ok) {
                    postProgress({ phase: 'skipped_low_quality', index: idx, url: candidate.originalUrl, reasons: validation.reasons });
                    failures.push({ url: candidate.originalUrl, reason: 'low_quality', details: validation.reasons });
                    return;
                }

                // categorize
                const category = categorizeImage(candidate.title, sourceMeta.description);

                // process & save
                const filenameBase = candidate.title || path.basename(new URL(candidate.originalUrl).pathname || `image-${idx}`);
                const saved = await processAndSaveImage({
                    buffer,
                    filenameBase,
                    sourceMeta
                }, progressCallback);

                // record to DB
                const record = {
                    title: candidate.title || filenameBase,
                    description: sourceMeta.description || `Borborbor dance image (Volta Region / Ewe)`,
                    category,
                    source: sourceMeta.source,
                    originalUrl: candidate.originalUrl,
                    files: saved.savedFiles,
                    sizes: saved.savedSizes,
                    dimensions: saved.dimensions,
                    providerMeta: candidate.metadata || {},
                    dhash,
                    copyright: candidate.metadata && (candidate.metadata.license || candidate.metadata.credit) ? {
                        license: candidate.metadata.license || null,
                        credit: candidate.metadata.credit || null,
                        licenseUrl: candidate.metadata.licenseUrl || null
                    } : { license: null }
                };

                await imageModel.saveImage(record);

                // add hash to processed set to avoid future duplicates
                if (dhash) processedHashes.add(dhash);

                successes.push(record);
                postProgress({ phase: 'processed', index: idx, url: candidate.originalUrl, saved: saved.savedFiles });
            } catch (err) {
                failures.push({ url: candidate.originalUrl, error: (err && err.message) || String(err) });
                postProgress({ phase: 'error', index: idx, url: candidate.originalUrl, error: (err && err.message) || String(err) });
            } finally {
                processedCount++;
                postProgress({ phase: 'progress', done: processedCount, total: uniqueCandidates.length });
            }
        })
    );

    await Promise.all(tasks);

    postProgress({ phase: 'complete', successes: successes.length, failures: failures.length });

    return {
        successes,
        failures,
        summary: {
            totalFound: uniqueCandidates.length,
            processed: successes.length + failures.length,
            saved: successes.length,
            failed: failures.length
        }
    };
}

/* Express-style controller wrapper for an HTTP endpoint */
async function handleSearchRequest(req, res) {
    // Example endpoint that triggers a search run and streams back progress via SSE
    // For simplicity, this implementation runs a search and returns final JSON response.
    // Integrate SSE or websockets on the frontend for real-time progress.
    try {
        const options = {
            keywords: req.body && req.body.keywords ? req.body.keywords : undefined,
            sources: req.body && req.body.sources ? req.body.sources : undefined,
            limitPerSource: req.body && req.body.limitPerSource ? Number(req.body.limitPerSource) : undefined,
            maxResults: req.body && req.body.maxResults ? Number(req.body.maxResults) : undefined
        };

        // If client wants streaming progress, consider exposing sockets or SSE
        const result = await searchAndDownloadImages({
            ...options,
            progressCallback: (p) => {
                // you can log to server log or integrate with websockets here
                console.log('[image-search-progress]', p);
            }
        });

        res.json({ ok: true, result });
    } catch (err) {
        res.status(500).json({ ok: false, error: (err && err.message) || String(err) });
    }
}

module.exports = {
    searchAndDownloadImages,
    handleSearchRequest
};