const express = require('express');
const eventController = require('../controllers/eventController');

const router = express.Router();

/**
 * Helpers
 */
function parseDateTime(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function isValidDateTimeRange(startStr, endStr) {
    const start = parseDateTime(startStr);
    const end = parseDateTime(endStr);
    return start && end && start < end;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
}

/**
 * Middleware: validate event date/time fields in body
 */
function validateEventDates(req, res, next) {
    const { start, end } = req.body;
    if (!start || !end) {
        return res.status(400).json({ error: 'Event "start" and "end" datetimes are required.' });
    }
    if (!isValidDateTimeRange(start, end)) {
        return res.status(400).json({ error: '"start" must be a valid datetime before "end". Use ISO 8601.' });
    }
    next();
}

/**
 * Check overlapping events in the storage via controller.
 * Expects controller.getEventsByRange(startISO, endISO) to return events array.
 * If excludeId is provided, events with that id are ignored (useful when updating).
 */
async function hasConflicts(startISO, endISO, excludeId = null) {
    // Fetch events that intersect search window; controller should accept ISO strings
    const existing = typeof eventController.getEventsByRange === 'function'
        ? await eventController.getEventsByRange(startISO, endISO)
        : []; // safe fallback

    const newStart = parseDateTime(startISO);
    const newEnd = parseDateTime(endISO);

    for (const ev of existing) {
        if (!ev || !ev.start || !ev.end) continue;
        if (excludeId && String(ev.id) === String(excludeId)) continue;
        const evStart = parseDateTime(ev.start);
        const evEnd = parseDateTime(ev.end);
        if (!evStart || !evEnd) continue;
        if (intervalsOverlap(newStart, newEnd, evStart, evEnd)) return true;
    }
    return false;
}

/**
 * Routes
 */

// GET /events - fetch all events
router.get('/', async (req, res) => {
    try {
        const events = await eventController.getAllEvents();
        res.json(events || []);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch events.', details: err.message });
    }
});

// GET /events/range?start=...&end=... - events by date range
router.get('/range', async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Query params "start" and "end" are required.' });
    if (!isValidDateTimeRange(start, end)) return res.status(400).json({ error: 'Invalid date range.' });

    try {
        const events = typeof eventController.getEventsByRange === 'function'
            ? await eventController.getEventsByRange(start, end)
            : await eventController.getEventsBetween ? await eventController.getEventsBetween(start, end) : [];
        res.json(events || []);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch events by range.', details: err.message });
    }
});

// POST /events - create new event (with validation + conflict checking)
router.post('/', validateEventDates, async (req, res) => {
    const { title, description, start, end, capacity } = req.body;
    if (!title) return res.status(400).json({ error: 'Event "title" is required.' });

    try {
        const conflict = await hasConflicts(start, end); // check for overlapping events
        if (conflict) return res.status(409).json({ error: 'Event conflicts with an existing event in the same time range.' });

        const newEvent = await eventController.createEvent({ title, description, start, end, capacity });
        res.status(201).json(newEvent);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create event.', details: err.message });
    }
});

// PUT /events/:id - update existing event (with validation + conflict checking)
router.put('/:id', validateEventDates, async (req, res) => {
    const id = req.params.id;
    const { title, description, start, end, capacity } = req.body;
    try {
        const existing = typeof eventController.getEventById === 'function'
            ? await eventController.getEventById(id)
            : null;
        if (!existing) return res.status(404).json({ error: 'Event not found.' });

        const conflict = await hasConflicts(start, end, id); // exclude this event from conflict check
        if (conflict) return res.status(409).json({ error: 'Updated event conflicts with another event.' });

        const updated = await eventController.updateEvent(id, { title, description, start, end, capacity });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update event.', details: err.message });
    }
});

// DELETE /events/:id - remove event
router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const deleted = await eventController.deleteEvent(id);
        if (deleted === false || deleted === null) return res.status(404).json({ error: 'Event not found.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete event.', details: err.message });
    }
});

// POST /events/:id/book - create a booking for an event
// Expected body: { userId, seats }
router.post('/:id/book', async (req, res) => {
    const id = req.params.id;
    const { userId, seats = 1 } = req.body;
    if (!userId) return res.status(400).json({ error: '"userId" is required to book an event.' });
    if (!Number.isInteger(seats) || seats < 1) return res.status(400).json({ error: '"seats" must be a positive integer.' });

    try {
        const event = typeof eventController.getEventById === 'function'
            ? await eventController.getEventById(id)
            : null;
        if (!event) return res.status(404).json({ error: 'Event not found.' });

        const now = new Date();
        const eventEnd = parseDateTime(event.end);
        if (eventEnd && eventEnd <= now) return res.status(400).json({ error: 'Cannot book an event that has already ended.' });

        // If controller exposes booking count / capacity enforcement, prefer those.
        if (typeof eventController.getEventBookings === 'function' && typeof event.capacity !== 'undefined') {
            const bookings = await eventController.getEventBookings(id);
            const bookedSeats = Array.isArray(bookings) ? bookings.reduce((s, b) => s + (b.seats || 1), 0) : 0;
            if (event.capacity !== null && (bookedSeats + seats) > event.capacity) {
                return res.status(409).json({ error: 'Not enough available seats for this event.' });
            }
        }

        // Delegate booking creation to controller
        if (typeof eventController.createBooking !== 'function' && typeof eventController.bookEvent !== 'function') {
            // If no booking API available, return unsupported
            return res.status(501).json({ error: 'Booking is not supported by the event controller implementation.' });
        }

        const booking = typeof eventController.createBooking === 'function'
            ? await eventController.createBooking(id, { userId, seats })
            : await eventController.bookEvent(id, { userId, seats });

        res.status(201).json(booking);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create booking.', details: err.message });
    }
});

module.exports = router;