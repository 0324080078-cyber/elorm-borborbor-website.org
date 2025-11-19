const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
contactRoutes = require('./routes/contactRoutes');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client'))); // Serve client files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes (if present)
let downloadRoutes;
let contactRoutes;
try {
    downloadRoutes = require('./routes/downloadRoutes');
} catch (e) {
    // If route files don't exist yet, skip requiring them
    downloadRoutes = null;
    contactRoutes = null;
}

// Use routes if available
if (downloadRoutes) app.use('/api/download', downloadRoutes);
if (contactRoutes) app.use('/api/contact', contactRoutes);

// Serve Borborbor media files directly
const borborborMediaDir = path.join(__dirname, 'uploads', 'borborbor-media');
app.use('/borborbor-media', express.static(borborborMediaDir));

// Borborbor-specific download routes (added inline to server)
app.get('/api/download/borborbor-files', (req, res) => {
    fs.readdir(borborborMediaDir, (err, files) => {
        if (err) {
            // If directory doesn't exist or other error, return empty list
            return res.status(200).json({ files: [] });
        }

        // Filter out hidden files and directories
        const fileList = files
            .filter((f) => !f.startsWith('.'))
            .map((f) => ({
                name: f,
                url: `${req.protocol}://${req.get('host')}/borborbor-media/${encodeURIComponent(f)}`
            }));

        res.json({ files: fileList });
    });
});

// Download a single Borborbor file by query ?file=<filename>
app.get('/api/download/download-borborbor', (req, res) => {
    const requested = req.query.file;
    if (!requested) {
        return res.status(400).json({ error: 'Missing "file" query parameter. Example: /api/download/download-borborbor?file=track.mp3' });
    }

    // Prevent path traversal by using basename
    const safeName = path.basename(requested);
    const filePath = path.join(borborborMediaDir, safeName);

    // Check file exists and is a file
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.download(filePath, safeName, (downloadErr) => {
            if (downloadErr && !res.headersSent) {
                res.status(500).json({ error: 'Failed to download file' });
            }
        });
    });
});

// Test route to check if server is working
app.get('/api/status', (req, res) => {
    res.json({
        status: 'OK',
        message: 'ELORM BORBORBOR Server is running',
        endpoints: {
            download: '/api/download/download-borborbor?file={filename}',
            files: '/api/download/borborbor-files',
            media: '/borborbor-media/{filename}'
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log('🎭 ELORM BORBORBOR GROUP Server Started!');
    console.log(`📍 Server running on: http://localhost:${PORT}`);
    console.log(`📥 Download endpoint: http://localhost:${PORT}/api/download/download-borborbor?file={filename}`);
    console.log(`🖼  Media files: http://localhost:${PORT}/borborbor-media/`);
});