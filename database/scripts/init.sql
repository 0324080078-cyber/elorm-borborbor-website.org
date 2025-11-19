-- database/scripts/init.sql
-- Schema for images, contacts, events, and bookings

PRAGMA foreign_keys = ON;

-- IMAGES TABLE
CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT,
    file_path TEXT NOT NULL,
    file_size INTEGER CHECK (file_size >= 0),
    width INTEGER CHECK (width >= 0),
    height INTEGER CHECK (height >= 0),
    category TEXT NOT NULL CHECK (category IN ('performance', 'ceremony', 'practice', 'event')),
    description TEXT,
    source_url TEXT,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_featured BOOLEAN NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_images_category ON images(category);
CREATE INDEX IF NOT EXISTS idx_images_upload_date ON images(upload_date);

-- CONTACTS TABLE
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    message TEXT,
    submission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_responded BOOLEAN NOT NULL DEFAULT 0,
    response_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_contacts_submission_date ON contacts(submission_date);

-- EVENTS TABLE
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    event_date DATE,
    event_time TIME,
    location TEXT,
    event_type TEXT CHECK (event_type IN ('performance', 'rehearsal', 'ceremony')),
    contact_person TEXT,
    contact_phone TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    client_email TEXT,
    client_phone TEXT,
    booking_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    guest_count INTEGER CHECK (guest_count >= 0),
    special_requests TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);