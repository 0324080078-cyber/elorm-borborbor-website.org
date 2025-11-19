const Event = require('../models/event'); // Mongoose model
const Booking = require('../models/booking'); // Mongoose model
try { notifier = require('../services/notifier'); } catch (e) { notifier = null; }

// server/controllers/eventController.js
//
// Controller for event creation & management, calendar retrieval, booking processing,
// date conflict checking, notifications, CRUD, and validation.
//
// Assumes Mongoose models at ../models/Event and ../models/Booking and an optional
// notifier service at ../services/notifier which exposes `send({to,subject,text})`.
// If notifier is absent, falls back to console logging.

let notifier;

/* ---------- Utilities ---------- */

function validateISODateString(s) {
    if (!s) return false;
    const d = new Date(s);
    return !Number.isNaN(d.getTime());
}

function validateEventData(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        errors.push('Invalid payload');
        return { valid: false, errors };
    }

    const { title, start, end, capacity, location } = data;
    if (!title || typeof title !== 'string' || title.trim().length < 3) {
        errors.push('title must be a non-empty string (min 3 chars)');
    }
    if (!validateISODateString(start)) {
        errors.push('start must be a valid ISO date string');
    }
    if (!validateISODateString(end)) {
        errors.push('end must be a valid ISO date string');
    }
    if (validateISODateString(start) && validateISODateString(end)) {
        const s = new Date(start);
        const e = new Date(end);
        if (s >= e) errors.push('start must be before end');
    }
    if (capacity !== undefined) {
        const n = Number(capacity);
        if (!Number.isInteger(n) || n < 0) errors.push('capacity must be a non-negative integer');
    }
    if (location !== undefined && typeof location !== 'string') {
        errors.push('location must be a string');
    }

    return { valid: errors.length === 0, errors };
}

async function sendNotification({ recipients = [], subject = '', message = '' }) {
    // recipients: array of {email, name} or strings
    if (!recipients || recipients.length === 0) return;
    if (notifier && typeof notifier.send === 'function') {
        await Promise.all(recipients.map(r => {
            const to = typeof r === 'string' ? r : r.email || r;
            return notifier.send({ to, subject, text: message }).catch(err => {
                // swallow notifier errors but log
                console.error('Notifier error', err);
            });
        }));
        return;
    }
    // Fallback: log notifications (useful in dev)
    recipients.forEach(r => {
        const to = typeof r === 'string' ? r : r.email || r;
        console.log(`[Notification] To: ${to} | Subject: ${subject} | Message: ${message}`);
    });
}

/* ---------- Conflict Checking ---------- */

/**
 * Checks for date/time conflicts for a given time range.
 * If excludeEventId is provided, that event will be ignored (useful when updating).
 * Returns true if conflict exists.
 */
async function hasDateConflict(startIso, endIso, excludeEventId = null) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    // overlapping condition: existing.start < end && existing.end > start
    const query = {
        start: { $lt: end },
        end: { $gt: start }
    };
    if (excludeEventId) query._id = { $ne: excludeEventId };
    const conflict = await Event.findOne(query).lean().exec();
    return !!conflict;
}

/* ---------- Controllers ---------- */

async function createEvent(req, res) {
    try {
        const payload = req.body || {};
        const { valid, errors } = validateEventData(payload);
        if (!valid) return res.status(400).json({ errors });

        // check date conflict
        const conflict = await hasDateConflict(payload.start, payload.end);
        if (conflict) {
            return res.status(409).json({ error: 'Event time conflicts with an existing event' });
        }

        const event = new Event({
            title: payload.title,
            description: payload.description || '',
            start: new Date(payload.start),
            end: new Date(payload.end),
            location: payload.location || '',
            capacity: payload.capacity !== undefined ? Number(payload.capacity) : null,
            participants: payload.participants || []
        });

        await event.save();

        // notify participants if any
        if (Array.isArray(event.participants) && event.participants.length > 0) {
            await sendNotification({
                recipients: event.participants,
                subject: `You were added to event: ${event.title}`,
                message: `Event: ${event.title}\nStart: ${event.start}\nEnd: ${event.end}\nLocation: ${event.location}`
            });
        }

        return res.status(201).json(event);
    } catch (err) {
        console.error('createEvent error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

async function getEvents(req, res) {
    try {
        // Support query params: start, end, search, limit, skip
        const { start, end, search, limit = 100, skip = 0 } = req.query || {};
        const query = {};
        if (start && end && validateISODateString(start) && validateISODateString(end)) {
            query.start = { $lt: new Date(end) };
            query.end = { $gt: new Date(start) };
        } else if (start && validateISODateString(start)) {
            query.end = { $gt: new Date(start) };
        } else if (end && validateISODateString(end)) {
            query.start = { $lt: new Date(end) };
        }
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ];
        }
        const events = await Event.find(query)
            .sort({ start: 1 })
            .skip(Number(skip))
            .limit(Math.min(1000, Number(limit)))
            .lean()
            .exec();
        return res.status(200).json(events);
    } catch (err) {
        console.error('getEvents error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

async function getEventById(req, res) {
    try {
        const id = req.params.id;
        const event = await Event.findById(id).lean().exec();
        if (!event) return res.status(404).json({ error: 'Event not found' });
        return res.status(200).json(event);
    } catch (err) {
        console.error('getEventById error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

async function updateEvent(req, res) {
    try {
        const id = req.params.id;
        const payload = req.body || {};
        const { valid, errors } = validateEventData(payload);
        if (!valid) return res.status(400).json({ errors });

        // check event exists
        const existing = await Event.findById(id).exec();
        if (!existing) return res.status(404).json({ error: 'Event not found' });

        // check conflicts if changing times
        const startChanged = payload.start && (new Date(payload.start).getTime() !== new Date(existing.start).getTime());
        const endChanged = payload.end && (new Date(payload.end).getTime() !== new Date(existing.end).getTime());
        if (startChanged || endChanged) {
            const startIso = payload.start || existing.start;
            const endIso = payload.end || existing.end;
            const conflict = await hasDateConflict(startIso, endIso, id);
            if (conflict) return res.status(409).json({ error: 'Event time conflicts with existing event' });
        }

        // apply updates
        existing.title = payload.title;
        existing.description = payload.description || existing.description;
        existing.start = new Date(payload.start);
        existing.end = new Date(payload.end);
        existing.location = payload.location || existing.location;
        existing.capacity = payload.capacity !== undefined ? Number(payload.capacity) : existing.capacity;
        if (Array.isArray(payload.participants)) existing.participants = payload.participants;

        await existing.save();

        // notify participants about update
        await sendNotification({
            recipients: existing.participants,
            subject: `Event updated: ${existing.title}`,
            message: `Event updated: ${existing.title}\nStart: ${existing.start}\nEnd: ${existing.end}\nLocation: ${existing.location}`
        });

        return res.status(200).json(existing);
    } catch (err) {
        console.error('updateEvent error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

async function deleteEvent(req, res) {
    try {
        const id = req.params.id;
        const existing = await Event.findByIdAndDelete(id).exec();
        if (!existing) return res.status(404).json({ error: 'Event not found' });

        // notify participants of cancellation
        await sendNotification({
            recipients: existing.participants,
            subject: `Event canceled: ${existing.title}`,
            message: `Event canceled: ${existing.title}\nOriginal Start: ${existing.start}\nOriginal End: ${existing.end}`
        });

        // Optionally remove bookings associated with event
        await Booking.deleteMany({ event: existing._id }).catch(() => {});

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('deleteEvent error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/* ---------- Booking Processing ---------- */

/**
 * Process a booking request:
 * - payload: { user: {name,email,id?}, eventId, seats?: number }
 * - checks event exists, capacity, date conflicts for the user (if applicable)
 * - creates a booking document and notifies event organizers/participants
 */
async function createBooking(req, res) {
    try {
        const payload = req.body || {};
        const user = payload.user;
        const eventId = payload.eventId;
        const seats = payload.seats ? Number(payload.seats) : 1;

        if (!eventId) return res.status(400).json({ error: 'eventId is required' });
        if (!user || !user.email || !user.name) return res.status(400).json({ error: 'user with name and email required' });
        if (!Number.isInteger(seats) || seats <= 0) return res.status(400).json({ error: 'seats must be positive integer' });

        const event = await Event.findById(eventId).exec();
        if (!event) return res.status(404).json({ error: 'Event not found' });

        // capacity check
        if (event.capacity !== null && event.capacity !== undefined) {
            // count existing confirmed bookings
            const agg = await Booking.aggregate([
                { $match: { event: event._id, status: 'confirmed' } },
                { $group: { _id: null, total: { $sum: '$seats' } } }
            ]).exec();
            const already = (agg[0] && agg[0].total) || 0;
            if (already + seats > event.capacity) {
                return res.status(409).json({ error: 'Not enough capacity for requested seats' });
            }
        }

        // Optional: check if user already has booking overlapping (business rule)
        // For now, allow multiple bookings.

        // Create booking (status: confirmed)
        const booking = new Booking({
            event: event._id,
            user: {
                id: user.id || null,
                name: user.name,
                email: user.email
            },
            seats,
            status: 'confirmed',
            createdAt: new Date()
        });
        await booking.save();

        // Add user to event.participants if not present (store emails or objects depending on model)
        const existingParticipantEmails = (event.participants || []).map(p => (typeof p === 'string' ? p : p.email || '')).filter(Boolean);
        if (!existingParticipantEmails.includes(user.email)) {
            event.participants = event.participants || [];
            event.participants.push({ name: user.name, email: user.email });
            await event.save();
        }

        // Notify user and event organizers/participants
        await Promise.all([
            sendNotification({
                recipients: [user.email],
                subject: `Booking confirmed: ${event.title}`,
                message: `Thank you ${user.name}, your booking for ${event.title} on ${event.start} is confirmed. Seats: ${seats}`
            }),
            sendNotification({
                recipients: event.participants,
                subject: `New booking for ${event.title}`,
                message: `${user.name} (${user.email}) booked ${seats} seat(s) for ${event.title}.`
            })
        ]);

        return res.status(201).json(booking);
    } catch (err) {
        console.error('createBooking error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/* ---------- Exported handlers ---------- */

module.exports = {
    createEvent,
    getEvents,
    getEventById,
    updateEvent,
    deleteEvent,
    createBooking,
    hasDateConflict,
    validateEventData,
    sendNotification
};