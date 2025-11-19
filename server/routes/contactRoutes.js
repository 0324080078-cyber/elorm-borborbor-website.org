const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult, matchedData } = require('express-validator');
const contactController = require('../controllers/contactController');

/**
 * server/routes/contactRoutes.js
 *
 * Routes for contact form submissions and admin retrieval of inquiries.
 * Integrates with ../controllers/contactController
 */


const router = express.Router();

/* Standardized response helpers */
const sendResponse = (res, { success = true, data = null, message = '', statusCode = 200 }) =>
    res.status(statusCode).json({ success, message, data });

const sendError = (res, statusCode = 500, message = 'An error occurred', details = null) =>
    res.status(statusCode).json({ success: false, message, ...(details ? { details } : {}) });

/* Simple admin guard middleware (adapt to your auth implementation) */
const adminOnly = (req, res, next) => {
    // Expect req.user to be populated by upstream auth middleware
    if (req.user && req.user.isAdmin) return next();
    return sendError(res, 403, 'Admin access required');
};

/* Rate limiter to prevent spam on contact submissions */
const contactRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 6, // allow up to 6 submissions per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many submissions, please try again later.' },
});

/* Validation & sanitization chain for contact form */
const validateContact = [
    body('name')
        .trim()
        .escape()
        .notEmpty().withMessage('Name is required')
        .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
    body('email')
        .trim()
        .normalizeEmail()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Invalid email address'),
    body('message')
        .trim()
        .escape()
        .notEmpty().withMessage('Message is required')
        .isLength({ min: 10, max: 2000 }).withMessage('Message must be between 10 and 2000 characters'),
    body('phone')
        .optional({ nullable: true, checkFalsy: true })
        .trim()
        .escape()
        .isMobilePhone('any').withMessage('Invalid phone number'),
    // validation result check middleware
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return sendError(res, 422, 'Validation failed', { errors: errors.array() });
        }
        // replace body with only matched (sanitized) fields
        req.cleaned = matchedData(req, { locations: ['body'] });
        return next();
    },
];

/* POST /contact - submit a contact inquiry */
router.post(
    '/contact',
    contactRateLimiter,
    validateContact,
    async (req, res) => {
        try {
            // req.cleaned contains sanitized fields: { name, email, message, phone? }
            const result = await contactController.submitContact(req.cleaned);

            // Expect contactController to throw with { code: 'EMAIL_SERVICE_FAILURE' } on email send failure
            return sendResponse(res, { success: true, data: result, message: 'Inquiry submitted', statusCode: 201 });
        } catch (err) {
            // Distinguish email service failures from other server errors
            if (err && err.code === 'EMAIL_SERVICE_FAILURE') {
                return sendError(res, 502, 'Failed to send notification email. Please try again later.');
            }
            // Log server error if a logger exists (non-blocking)
            if (req.app && req.app.get && req.app.get('logger')) {
                req.app.get('logger').error?.(err);
            } else {
                // fallback simple logging
                /* eslint-disable no-console */
                console.error('Contact submit error:', err);
            }
            return sendError(res, 500, 'Unable to process the inquiry at this time.');
        }
    }
);

/* GET /contact - admin: retrieve contact inquiries (with optional pagination/query) */
router.get(
    '/contact',
    adminOnly,
    async (req, res) => {
        try {
            const query = {
                page: Math.max(1, parseInt(req.query.page, 10) || 1),
                limit: Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25)),
                // allow additional filters through query params, sanitized here
                search: req.query.search ? String(req.query.search).trim() : undefined,
                read: typeof req.query.read !== 'undefined' ? req.query.read === 'true' : undefined,
            };

            const data = await contactController.getInquiries(query);
            return sendResponse(res, { success: true, data, message: 'Inquiries retrieved' });
        } catch (err) {
            if (req.app && req.app.get && req.app.get('logger')) {
                req.app.get('logger').error?.(err);
            } else {
                console.error('Get inquiries error:', err);
            }
            return sendError(res, 500, 'Failed to retrieve inquiries');
        }
    }
);

module.exports = router;