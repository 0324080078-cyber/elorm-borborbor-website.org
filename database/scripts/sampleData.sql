-- Sample data for ELORM BORBORBOR GROUP
-- File: database/scripts/sampleData.sql

BEGIN;

-- EVENTS
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_date DATE,
    end_date DATE,
    event_type TEXT,          -- e.g. Festival, Wedding, Workshop, Participation, Community
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- IMAGES (optional relation to events)
CREATE TABLE IF NOT EXISTS images (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    caption TEXT,
    photographer TEXT,
    taken_at DATE,
    metadata JSONB DEFAULT '{}'::jsonb,  -- store camera/rights/tags as JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CONTACTS / INQUIRIES
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    inquiry_type TEXT,        -- e.g. Booking, Partnership, Media, General
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded BOOLEAN DEFAULT FALSE
);

-- Insert sample events
INSERT INTO events (title, description, location, start_date, end_date, event_type, is_public)
VALUES
    ('Annual Borborbor Festival in Saviefe Agorkpo',
     'The flagship annual Borborbor festival featuring traditional drumming, dancing, and community ceremonies.',
     'Saviefe Agorkpo, Volta Region',
     '2025-08-21', '2025-08-23', 'Festival', TRUE),

    ('Wedding Performance - Asante & Mensah',
     'Traditional Borborbor performance for the wedding ceremony of Asante & Mensah families.',
     'Hohoe Municipal Hall',
     '2024-11-16', '2024-11-16', 'Wedding', FALSE),

    ('Cultural Festival Participation - Keta Heritage Day',
     'Guest performance at Keta Heritage Day showcasing Borborbor dance and storytelling.',
     'Keta Central Grounds',
     '2025-03-12', '2025-03-12', 'Participation', TRUE),

    ('Community Celebration - Oti River Cleanup Celebration',
     'Performance and community ceremony after a community-led river cleanup and restoration project.',
     'Oti Riverbank, Community Park',
     '2024-06-05', '2024-06-05', 'Community', TRUE),

    ('Training Workshop for New Members (Batch 5)',
     'Three-day intensive training covering traditional steps, drumming patterns, and stage etiquette for new recruits.',
     'Group Practice Hall, Saviefe Agorkpo',
     '2024-09-10', '2024-09-12', 'Workshop', FALSE),

    ('Wedding Performance - Atta & Kofi',
     'Evening performance and procession at a family wedding in Accra.',
     'Accra - La Beach Resort',
     '2025-02-08', '2025-02-08', 'Wedding', FALSE),

    ('Cultural Exchange - Regional Arts Summit',
     'Borborbor delegation participating in a regional cultural exchange and workshop series.',
     'Greater Accra Cultural Centre',
     '2024-12-04', '2024-12-06', 'Participation', TRUE),

    ('Neighborhood Harvest Celebration',
     'Local harvest celebration with performances, storytelling, and youth showcases.',
     'Saviefe Agorkpo Community Square',
     '2024-10-01', '2024-10-01', 'Community', TRUE
;

-- Insert sample images (some linked to events)
INSERT INTO images (event_id, filename, caption, photographer, taken_at, metadata)
VALUES
    (1, '2025-08-21_festival_group.jpg', 'Group photo in full traditional attire at opening of Annual Borborbor Festival.', 'Kwame Adjei', '2025-08-21',
     '{"tags":["group","traditional","opening"], "rights":"ELORM BORBORBOR GROUP", "resolution":"6000x4000"}'),

    (1, '2025-08-22_performance_action.jpg', 'Dynamic performance shot showing leading dancer mid-jump.', 'Ama Yeboah', '2025-08-22',
     '{"tags":["performance","action","festival"], "camera":"Canon EOS R5"}'),

    (2, '2024-11-16_wedding_closeup.jpg', 'Close-up of footwork and skirt movements during wedding ceremony performance.', 'Kofi Boateng', '2024-11-16',
     '{"tags":["close-up","dance","wedding"], "notes":"Client provided permission for promotional use"}'),

    (3, '2025-03-12_keta_stage.jpg', 'Stage shot during cultural festival participation, full ensemble on stage.', 'Esi Mensah', '2025-03-12',
     '{"tags":["stage","festival","ensemble"]}'),

    (5, '2024-09-11_workshop_practice.jpg', 'Practice session image: new members rehearsing basic steps.', 'Group Archive', '2024-09-11',
     '{"tags":["practice","workshop","training"], "usage":"internal"}'),

    (4, '2024-06-05_cleanup_ceremony.jpg', 'Ceremonial event coverage following community cleanup.', 'Kwasi Amoako', '2024-06-05',
     '{"tags":["community","ceremony"], "notes":"Used in local press release"}'),

    (1, '2025-08-23_festival_closeup_drum.jpg', 'Close-up of hand and drum motion during climax of festival.', 'Ama Yeboah', '2025-08-23',
     '{"tags":["close-up","drumming","festival"], "camera":"Sony A7III"}'),

    (7, '2024-12-05_exchange_collage.jpg', 'Collage of moments from the regional arts summit exchange.', 'Esi Mensah', '2024-12-05',
     '{"tags":["exchange","collage","participation"]}');

-- Insert sample contacts / inquiries
INSERT INTO contacts (name, email, phone, inquiry_type, message, responded)
VALUES
    ('Mrs. Lydia Akoto', 'l.akoto@example.com', '+233201234567', 'Booking',
     'We would like to book ELORM BORBORBOR GROUP for a community event on 2025-05-30. Please send availability and pricing.', FALSE),

    ('Mr. David Owusu', 'd.owusu@culturepartners.org', '+233209876543', 'Partnership',
     'Interest in establishing a cultural exchange partnership for next year''s regional festival. Requesting meeting and past performance materials.', FALSE),

    ('Sophie Turner (Local Press)', 'sophie.turner@newsgh.com', '+233246112233', 'Media',
     'Requesting images and interviews for an article about traditional festivals. Are there media packs available?', TRUE),

    ('General Inquiry', 'info@elormborborbor.org', '+233200000000', 'General',
     'How can new members join? What are practice days and membership fees?', TRUE),

    ('Mr. Kwabena Badu', 'kwabena.badu@weddingsghana.com', '+233255667788', 'Booking',
     'Seeking a team to perform at a series of wedding ceremonies in December. Need pricing for 2 performances.', FALSE),

    ('Ms. Adjoa Dede', 'adjoa.dede@artsngo.org', '+233244556677', 'Partnership',
     'Proposal for workshop funding and co-hosted training workshops for youth cultural preservation.', FALSE);

COMMIT;