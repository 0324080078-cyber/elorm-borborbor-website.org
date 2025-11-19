const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const multer = require('multer');
const mongoose = require('mongoose');

/**
 * server/controllers/imageController.js
 *
 * Controller for searching/downloading Borborbor dance images, processing & optimization,
 * gallery CRUD, upload handling, metadata storage, search, safety checks, and optional
 * cultural database integration.
 *
 * Dependencies (install in project):
 *   npm install axios sharp multer mongoose
 *
 * Environment variables (optional for integrations):
 *   UNSPLASH_ACCESS_KEY
 *   GOOGLE_VISION_API_KEY
 *   CULTURAL_DB_URL
 */


const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Mongoose schema & model (lightweight)
const ImageSchema = new mongoose.Schema({
    filename: { type: String, required: true },
    originalName: String,
    path: String,
    url: String, // if downloaded from source
    source: String,
    format: String,
    width: Number,
    height: Number,
    size: Number,
    tags: [String],
    safe: { type: Boolean, default: null },
    cultural: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});
let ImageModel;
try {
    ImageModel = mongoose.models.Image || mongoose.model('Image', ImageSchema);
} catch (e) {
    // If mongoose not connected yet, exports still usable; operations will fail until connected.
    ImageModel = null;
}

// Multer setup for uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '';
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
        cb(null, name);
    },
});
const uploadMiddleware = multer({
    storage,
    fileFilter: (req, file, cb) => {
        // Basic multipart safety: allow common image types
        const allowed = /jpeg|jpg|png|webp|gif/;
        const ok = allowed.test(file.mimetype);
        cb(ok ? null : new Error('Only image files are allowed'), ok);
    },
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Utility to download a file by URL
async function downloadFileToDir(url, destDir = UPLOAD_DIR, suggestedName) {
    const res = await axios.get(url, { responseType: 'stream', timeout: 20000 });
    const contentType = (res.headers['content-type'] || '').split(';')[0];
    const ext = /\.(jpe?g|png|webp|gif)$/i.test(url)
        ? path.extname(url).split('?')[0]
        : contentType === 'image/png'
        ? '.png'
        : contentType === 'image/webp'
        ? '.webp'
        : '.jpg';
    const filename = suggestedName || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    const outPath = path.join(destDir, filename);
    const writer = fs.createWriteStream(outPath);
    await new Promise((resolve, reject) => {
        res.data.pipe(writer);
        let error = null;
        writer.on('error', (err) => {
            error = err;
            writer.close();
            reject(err);
        });
        writer.on('close', () => (error ? reject(error) : resolve()));
    });
    const stats = fs.statSync(outPath);
    return { filename, path: outPath, size: stats.size, contentType };
}

// Wikimedia Commons search (no API key required)
async function searchWikimediaImages(query, limit = 10) {
    const api = 'https://commons.wikimedia.org/w/api.php';
    const params = {
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrsearch: `${query} common name:borborbor OR "Borborbor"`,
        gsrlimit: limit,
        prop: 'imageinfo',
        iiprop: 'url|mime|extmetadata',
    };
    const resp = await axios.get(api, { params, timeout: 15000 });
    const pages = (resp.data.query && resp.data.query.pages) || {};
    const results = Object.values(pages)
        .map((p) => {
            const ii = (p.imageinfo && p.imageinfo[0]) || {};
            return { title: p.title, url: ii.url, mime: ii.mime, metadata: ii.extmetadata || {} };
        })
        .filter((r) => r.url);
    return results;
}

// Primary search & download function for Borborbor dance images
async function searchAndDownloadImages({ query = 'Borborbor dance', maxResults = 8, source = 'wikimedia' } = {}) {
    const sources = [];
    if (source === 'wikimedia' || source === 'all') {
        const wikires = await searchWikimediaImages(query, maxResults);
        sources.push(...wikires);
    }
    // Placeholder for additional reputable sources (Unsplash requires API key)
    if ((process.env.UNSPLASH_ACCESS_KEY && (source === 'unsplash' || source === 'all'))) {
        try {
            const unsplash = await axios.get('https://api.unsplash.com/search/photos', {
                params: { query, per_page: maxResults },
                headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
            });
            unsplash.data.results.forEach((r) => {
                if (r.urls && r.urls.raw) {
                    sources.push({ title: r.description || r.alt_description || r.id, url: r.urls.raw, metadata: r });
                }
            });
        } catch (e) {
            // continue gracefully
        }
    }

    const downloaded = [];
    for (const src of sources.slice(0, maxResults)) {
        try {
            const file = await downloadFileToDir(src.url, UPLOAD_DIR);
            // Basic optimization immediately after download
            const optimized = await processAndOptimizeImage(file.path);
            const meta = {
                filename: file.filename,
                originalName: src.title || file.filename,
                path: file.path,
                url: src.url,
                source: src.metadata ? src.metadata.source || 'external' : 'wikimedia',
                format: optimized.format,
                width: optimized.width,
                height: optimized.height,
                size: optimized.size,
            };
            // Save metadata if DB available
            let doc = null;
            if (ImageModel) {
                doc = await ImageModel.create(meta).catch(() => null);
            }
            downloaded.push({ file: file.filename, meta, db: doc });
        } catch (e) {
            // skip individual failures
        }
    }
    return downloaded;
}

// Process & optimize image: convert to webp, create thumbnail, limit dimensions
async function processAndOptimizeImage(filePath, opts = {}) {
    const maxDim = opts.maxDim || 2048;
    const quality = opts.quality || 80;
    const thumbSize = opts.thumbSize || 400;
    const parsed = path.parse(filePath);
    const outWebp = path.join(parsed.dir, `${parsed.name}.webp`);
    const thumbPath = path.join(parsed.dir, `${parsed.name}.thumb.webp`);

    const image = sharp(filePath, { animated: false });
    const metadata = await image.metadata();

    // Resize if needed and convert to webp
    const resizeOptions = {};
    if (metadata.width && metadata.width > maxDim) resizeOptions.width = maxDim;
    if (metadata.height && metadata.height > maxDim) resizeOptions.height = maxDim;

    await image
        .resize(resizeOptions)
        .webp({ quality })
        .toFile(outWebp);

    // Create thumbnail
    await sharp(outWebp).resize({ width: thumbSize }).webp({ quality: Math.min(60, quality) }).toFile(thumbPath);

    const stats = fs.statSync(outWebp);
    return {
        path: outWebp,
        thumb: thumbPath,
        format: 'webp',
        width: resizeOptions.width || metadata.width,
        height: resizeOptions.height || metadata.height,
        size: stats.size,
    };
}

// Basic safety checks and optional external safe-search (Google Vision)
async function safetyCheckImage(filePath) {
    // Reject SVG and other vector types by design
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.svg' || ext === '.svgz') return { safe: false, reason: 'SVG files are not allowed' };

    // Optional Google Vision SafeSearch
    if (process.env.GOOGLE_VISION_API_KEY) {
        try {
            const imageBytes = fs.readFileSync(filePath).toString('base64');
            const resp = await axios.post(
                `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
                {
                    requests: [
                        {
                            image: { content: imageBytes },
                            features: [{ type: 'SAFE_SEARCH_DETECTION' }],
                        },
                    ],
                },
                { timeout: 20000 }
            );
            const anno = resp.data.responses && resp.data.responses[0] && resp.data.responses[0].safeSearchAnnotation;
            if (anno) {
                // Treat P, V, or A likelihoods greater than POSSIBLE as unsafe
                const unsafe = ['LIKELY', 'VERY_LIKELY'];
                const flags = ['adult', 'violence', 'racy', 'medical', 'spoof'];
                for (const f of flags) {
                    if (unsafe.includes((anno[f] || '').toUpperCase())) {
                        return { safe: false, reason: `Detected ${f}: ${anno[f]}` };
                    }
                }
                return { safe: true, reason: 'Google Vision safe' };
            }
        } catch (e) {
            // fallback to heuristics
        }
    }

    // Heuristic checks: file size and dimensions
    const stats = fs.statSync(filePath);
    if (stats.size > 20 * 1024 * 1024) return { safe: false, reason: 'Image too large' };
    try {
        const m = await sharp(filePath).metadata();
        if ((m.width && m.width < 10) || (m.height && m.height < 10)) return { safe: false, reason: 'Image resolution too small' };
    } catch (e) {
        return { safe: false, reason: 'Unable to parse image' };
    }

    return { safe: true, reason: 'Heuristic passed' };
}

// Optional cultural database lookup
async function fetchCulturalData(query) {
    if (!process.env.CULTURAL_DB_URL) return null;
    try {
        const resp = await axios.get(process.env.CULTURAL_DB_URL, { params: { q: query }, timeout: 10000 });
        return resp.data;
    } catch {
        return null;
    }
}

// CRUD operations for gallery metadata
async function createImageMetadata(data) {
    if (!ImageModel) throw new Error('ImageModel not available (mongoose not initialized)');
    const doc = new ImageModel(data);
    await doc.save();
    return doc;
}
async function getImageMetadata(idOrQuery) {
    if (!ImageModel) throw new Error('ImageModel not available (mongoose not initialized)');
    if (mongoose.Types.ObjectId.isValid(idOrQuery)) return ImageModel.findById(idOrQuery).lean();
    // otherwise treat as search
    const q = typeof idOrQuery === 'string' ? { $text: { $search: idOrQuery } } : idOrQuery;
    return ImageModel.find(q).lean();
}
async function updateImageMetadata(id, updates) {
    if (!ImageModel) throw new Error('ImageModel not available (mongoose not initialized)');
    updates.updatedAt = new Date();
    return ImageModel.findByIdAndUpdate(id, updates, { new: true });
}
async function deleteImage(id) {
    if (!ImageModel) throw new Error('ImageModel not available (mongoose not initialized)');
    const doc = await ImageModel.findByIdAndDelete(id);
    if (doc && doc.path && fs.existsSync(doc.path)) {
        try { fs.unlinkSync(doc.path); } catch (e) {}
    }
    return doc;
}

// Search gallery in DB with pagination
async function searchGallery({ q = '', tags = [], limit = 20, page = 0 } = {}) {
    if (!ImageModel) throw new Error('ImageModel not available (mongoose not initialized)');
    const filter = {};
    if (q) filter.$text = { $search: q };
    if (tags.length) filter.tags = { $all: tags };
    const results = await ImageModel.find(filter).skip(page * limit).limit(limit).lean();
    return results;
}

// Express-style handlers (examples)
async function handleUpload(req, res) {
    // multer middleware must run first: uploadMiddleware.single('image')
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const filePath = req.file.path;
        const safety = await safetyCheckImage(filePath);
        if (!safety.safe) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: 'Unsafe image', reason: safety.reason });
        }
        const optimized = await processAndOptimizeImage(filePath);
        const cultural = await fetchCulturalData(req.body.query || req.file.originalname);
        const meta = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: optimized.path,
            source: 'user-upload',
            format: optimized.format,
            width: optimized.width,
            height: optimized.height,
            size: optimized.size,
            tags: (req.body.tags && req.body.tags.split(',').map((s) => s.trim())) || [],
            safe: true,
            cultural,
        };
        let doc = null;
        if (ImageModel) doc = await ImageModel.create(meta);
        return res.status(201).json({ meta, db: doc });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// Small wrapper to attach to routes for search/download via HTTP
async function handleSearchAndDownload(req, res) {
    try {
        const query = req.query.q || 'Borborbor dance';
        const max = parseInt(req.query.max || '6', 10);
        const results = await searchAndDownloadImages({ query, maxResults: max, source: 'wikimedia' });
        return res.json({ results });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

module.exports = {
    // middleware
    uploadMiddleware: uploadMiddleware.single('image'),

    // functions
    searchAndDownloadImages,
    processAndOptimizeImage,
    safetyCheckImage,
    fetchCulturalData,

    // DB CRUD
    createImageMetadata,
    getImageMetadata,
    updateImageMetadata,
    deleteImage,
    searchGallery,

    // express handlers
    handleUpload,
    handleSearchAndDownload,

    // low level util
    downloadFileToDir,
};