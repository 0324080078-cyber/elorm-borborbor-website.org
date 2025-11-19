const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// server/controllers/contactController.js
//
// Contact form handling with:
// - validation & sanitization
// - spam protection (honeypot + simple rate limiting)
// - email sending via nodemailer (with fallback test account)
// - contact storage (NDJSON file)
// - auto-responder (confirmation to user) and admin notification
//
// Exports: submitContact(req, res)


const CONTACT_STORE_DIR = path.join(__dirname, '..', 'data');
const CONTACT_STORE_FILE = path.join(CONTACT_STORE_DIR, 'contacts.ndjson');

// Rate limiting: max submissions per IP per window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;
const rateLimiter = new Map(); // ip -> { count, firstTs }

// Basic email regex (sane but not exhaustive)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Ensure storage directory exists
try {
    fs.mkdirSync(CONTACT_STORE_DIR, { recursive: true });
} catch (err) {
    // ignore; will surface later on write errors
}

// Simple HTML escape
function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Very small sanitizer: trim, collapse long whitespace, escape HTML
function sanitizeInput(str = '') {
    return escapeHtml(String(str).trim().replace(/\s+/g, ' '));
}

// Validate payload and return { valid: boolean, errors: [] }
function validatePayload({ name, email, message }) {
    const errors = [];
    const n = String(name || '').trim();
    const e = String(email || '').trim();
    const m = String(message || '').trim();

    if (!n) errors.push({ field: 'name', message: 'Name is required.' });
    else if (n.length < 2 || n.length > 200)
        errors.push({ field: 'name', message: 'Name must be 2-200 characters.' });

    if (!e) errors.push({ field: 'email', message: 'Email is required.' });
    else if (!EMAIL_RE.test(e)) errors.push({ field: 'email', message: 'Email format is invalid.' });

    if (!m) errors.push({ field: 'message', message: 'Message is required.' });
    else if (m.length < 10 || m.length > 5000)
        errors.push({ field: 'message', message: 'Message must be 10-5000 characters.' });

    return { valid: errors.length === 0, errors };
}

// Create nodemailer transporter. Uses SMTP env vars if present, otherwise creates a test account.
async function createTransporter() {
    const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
        return {
            transporter: nodemailer.createTransport({
                host: SMTP_HOST,
                port: Number(SMTP_PORT) || 587,
                secure: SMTP_SECURE === 'true' || false,
                auth: { user: SMTP_USER, pass: SMTP_PASS },
            }),
            from: SMTP_FROM || SMTP_USER,
            isTest: false,
        };
    }

    // Fallback to ethereal test account for local dev
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: { user: testAccount.user, pass: testAccount.pass },
    });

    return { transporter, from: testAccount.user, isTest: true };
}

// Store contact as NDJSON (one JSON object per line)
async function storeContact(entry) {
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(CONTACT_STORE_FILE, line, { encoding: 'utf8', flag: 'a' });
}

// Simple per-IP rate limiting
function checkRateLimit(ip) {
    const now = Date.now();
    const rec = rateLimiter.get(ip);
    if (!rec) {
        rateLimiter.set(ip, { count: 1, firstTs: now });
        return { ok: true };
    }
    if (now - rec.firstTs > RATE_LIMIT_WINDOW_MS) {
        rateLimiter.set(ip, { count: 1, firstTs: now });
        return { ok: true };
    }
    if (rec.count >= RATE_LIMIT_MAX) {
        return { ok: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - rec.firstTs) };
    }
    rec.count += 1;
    return { ok: true };
}

// The main handler to be used in an Express route: POST /contact (example)
async function submitContact(req, res) {
    try {
        // Basic content-type checking (expect JSON or urlencoded form)
        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';

        // Honeypot spam field (e.g., <input name="website"> hidden from real users)
        if (req.body && req.body.website) {
            // pretend success but drop silently
            return res.status(204).send();
        }

        // Rate limit check
        const rl = checkRateLimit(ip);
        if (!rl.ok) {
            const retrySeconds = Math.ceil((rl.retryAfterMs || RATE_LIMIT_WINDOW_MS) / 1000);
            return res.status(429).json({ status: 'error', message: 'Too many requests', retry_after_seconds: retrySeconds });
        }

        const raw = {
            name: req.body?.name,
            email: req.body?.email,
            message: req.body?.message,
            subject: req.body?.subject || 'Website contact',
        };

        // Validate
        const { valid, errors } = validatePayload(raw);
        if (!valid) {
            return res.status(400).json({ status: 'error', message: 'Validation failed', errors });
        }

        // Sanitize
        const safe = {
            name: sanitizeInput(raw.name),
            email: sanitizeInput(raw.email),
            message: sanitizeInput(raw.message),
            subject: sanitizeInput(raw.subject),
            ip,
            userAgent: req.get('User-Agent') || '',
            referrer: req.get('Referrer') || req.get('Referer') || '',
            ts: new Date().toISOString(),
        };

        // Store contact
        try {
            await storeContact(safe);
        } catch (err) {
            // non-fatal: continue but log
            console.error('Failed to store contact:', err);
        }

        // Prepare and send emails: admin notification + autoresponder to user
        let transporterInfo;
        try {
            transporterInfo = await createTransporter();
        } catch (err) {
            console.error('Failed to create transporter:', err);
            return res.status(500).json({ status: 'error', message: 'Failed to prepare email sending.' });
        }

        const { transporter, from, isTest } = transporterInfo;

        const adminEmail = process.env.CONTACT_ADMIN_EMAIL || process.env.SMTP_USER || from;

        const adminMailOptions = {
            from,
            to: adminEmail,
            subject: `New contact: ${safe.subject}`,
            text:
                `New contact submission\n\n` +
                `Name: ${safe.name}\nEmail: ${safe.email}\nSubject: ${safe.subject}\nIP: ${safe.ip}\nUA: ${safe.userAgent}\nReferrer: ${safe.referrer}\n\nMessage:\n${safe.message}\n`,
            html:
                `<p><strong>New contact submission</strong></p>` +
                `<p><strong>Name:</strong> ${safe.name}<br>` +
                `<strong>Email:</strong> ${safe.email}<br>` +
                `<strong>Subject:</strong> ${safe.subject}<br>` +
                `<strong>IP:</strong> ${safe.ip}<br>` +
                `<strong>UA:</strong> ${escapeHtml(safe.userAgent)}<br>` +
                `<strong>Referrer:</strong> ${escapeHtml(safe.referrer)}</p>` +
                `<p><strong>Message:</strong><br>${safe.message.replace(/\n/g, '<br>')}</p>`,
        };

        const autoResponderMailOptions = {
            from,
            to: safe.email,
            subject: process.env.AUTORESPONDER_SUBJECT || `Thanks for contacting us`,
            text:
                `Hi ${safe.name},\n\n` +
                `Thanks for reaching out. We received your message and will respond as soon as possible.\n\n` +
                `Your message:\n${safe.message}\n\n` +
                `—\n`,
            html:
                `<p>Hi ${safe.name},</p>` +
                `<p>Thanks for reaching out. We received your message and will respond as soon as possible.</p>` +
                `<p><strong>Your message:</strong><br>${safe.message.replace(/\n/g, '<br>')}</p>` +
                `<hr/><p>This is an automated confirmation.</p>`,
        };

        // Send emails, don't fail the whole request if email sending fails, but report it.
        let adminInfo, autoInfo;
        try {
            adminInfo = await transporter.sendMail(adminMailOptions);
            autoInfo = await transporter.sendMail(autoResponderMailOptions);
        } catch (err) {
            console.error('Email send error:', err);
            // If using test account, provide preview URLs
            const details = {};
            if (isTest) {
                if (adminInfo) details.adminPreview = nodemailer.getTestMessageUrl(adminInfo);
                if (autoInfo) details.autoPreview = nodemailer.getTestMessageUrl(autoInfo);
            }
            return res.status(502).json({ status: 'warning', message: 'Message saved but failed to send email', details });
        }

        // Optionally provide test preview links
        const result = { status: 'ok', message: 'Message received. Confirmation sent.' };
        if (isTest) {
            result._preview = {
                admin: nodemailer.getTestMessageUrl(adminInfo),
                auto: nodemailer.getTestMessageUrl(autoInfo),
            };
        }

        return res.status(200).json(result);
    } catch (err) {
        console.error('submitContact error:', err);
        return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}

module.exports = { submitContact };