// File: server/routes/images.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Joi = require('joi');

const router = express.Router();

// Simple in-memory store for demo purposes (replace with DB)
const images = new Map(); // id -> { id, filename, originalName, metadata, createdAt }

// Utilities & middleware
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const validate = (schema, source = 'body') => (req, res, next) => {
    const { error, value } = schema.validate(req[source], { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.message });
    req.validated = value;
    next();
};

// Storage & security for uploads
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'images');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);
const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const id = crypto.randomBytes(12).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${id}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedMime.has(file.mimetype) || !allowedExt.has(ext)) {
        return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Invalid file type'));
    }
    cb(null, true);
};

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter
});

// Validation schemas
const metadataSchema = Joi.object({
    title: Joi.string().max(200).allow('').optional(),
    description: Joi.string().max(2000).allow('').optional(),
    tags: Joi.array().items(Joi.string().max(50)).optional()
});

const listQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    tag: Joi.string().optional()
});

const searchQuerySchema = Joi.object({
    q: Joi.string().min(1).max(200).required(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
});

// Routes (RESTful)
router.get('/', validate(listQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { page, limit, tag } = req.validated;
    const all = Array.from(images.values());
    const filtered = tag ? all.filter(i => (i.metadata.tags || []).includes(tag)) : all;
    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);
    res.json({ data: paged, total: filtered.length, page, limit });
}));

router.get('/search', validate(searchQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { q, page, limit } = req.validated;
    const all = Array.from(images.values());
    const found = all.filter(i =>
        (i.metadata.title || '').toLowerCase().includes(q.toLowerCase()) ||
        (i.metadata.description || '').toLowerCase().includes(q.toLowerCase()) ||
        (i.metadata.tags || []).some(t => t.toLowerCase().includes(q.toLowerCase()))
    );
    const start = (page - 1) * limit;
    res.json({ data: found.slice(start, start + limit), total: found.length, page, limit });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const record = images.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
}));

// Upload route
router.post('/', upload.single('image'), validate(metadataSchema, 'body'), asyncHandler(async (req, res) => {
    // multer stored file; security: filename already randomized, stored outside public folder
    if (!req.file) return res.status(400).json({ error: 'Image is required' });

    const id = path.parse(req.file.filename).name;
    const safeMeta = req.validated || {};
    const record = {
        id,
        filename: req.file.filename,
        originalName: path.basename(req.file.originalname),
        metadata: safeMeta,
        createdAt: new Date().toISOString()
    };
    images.set(id, record);
    res.status(201).json(record);
}));

router.patch('/:id', validate(metadataSchema, 'body'), asyncHandler(async (req, res) => {
    const record = images.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    record.metadata = Object.assign(record.metadata || {}, req.validated);
    images.set(record.id, record);
    res.json(record);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const record = images.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    const filePath = path.join(UPLOAD_DIR, record.filename);
    try { fs.unlinkSync(filePath); } catch (err) { /* ignore missing file */ }
    images.delete(req.params.id);
    res.status(204).end();
}));

module.exports = router;