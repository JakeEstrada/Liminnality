PRAGMA foreign_keys = ON;

-- Local CRM — SQLite schema
-- Converted from the DBML/PostgreSQL-style schema.
-- SQLite notes:
-- - UUIDs are stored as TEXT using lower(hex(randomblob(16))) defaults.
-- - Booleans are INTEGER values constrained to 0 or 1.
-- - Enums are TEXT columns with CHECK constraints.
-- - Dates/timestamps are TEXT in ISO-8601 format using CURRENT_TIMESTAMP defaults.
-- - JSON fields are TEXT with json_valid(...) checks.
-- - Email uniqueness/search should use COLLATE NOCASE where useful.

CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    company_name TEXT NOT NULL DEFAULT 'My Company',
    timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    default_board_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (default_board_id) REFERENCES kanban_boards(id) ON DELETE SET NULL
);

CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','manager','sales','installer','read_only','employee')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    mobile TEXT,
    address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE calendars (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    timezone TEXT,
    color TEXT NOT NULL DEFAULT '#1976D2',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE kanban_boards (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    calendar_id TEXT,
    on_schedule_stage_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE SET NULL,
    FOREIGN KEY (on_schedule_stage_id) REFERENCES pipeline_stages(id) ON DELETE SET NULL
);

CREATE TABLE kanban_sections (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    board_id TEXT NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    is_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (is_collapsed IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
);

CREATE TABLE pipeline_stages (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    board_id TEXT NOT NULL,
    section_id TEXT NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#1976D2',
    moves_to_bench INTEGER NOT NULL DEFAULT 0 CHECK (moves_to_bench IN (0,1)),
    is_scheduled_stage INTEGER NOT NULL DEFAULT 0 CHECK (is_scheduled_stage IN (0,1)),
    is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE,
    FOREIGN KEY (section_id) REFERENCES kanban_sections(id) ON DELETE CASCADE
);

CREATE TABLE job_field_definitions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    board_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    label TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','textarea','number','currency','phone','email','date','boolean')),
    show_on_card INTEGER NOT NULL DEFAULT 0 CHECK (show_on_card IN (0,1)),
    required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    builtin_column TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE,
    UNIQUE (board_id, field_key)
);

CREATE TABLE customers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    primary_phone TEXT,
    primary_email TEXT COLLATE NOCASE,
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'other' CHECK (source IN ('referral','yelp','instagram','facebook','website','repeat','other')),
    created_by_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE customer_phones (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    customer_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Phone',
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE customer_emails (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    customer_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Email',
    value TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE customer_addresses (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    customer_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Address',
    street TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    job_number INTEGER UNIQUE,
    customer_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount REAL,
    job_site_street TEXT,
    job_site_city TEXT,
    job_site_state TEXT,
    job_site_zip TEXT,
    color TEXT NOT NULL DEFAULT '#1976D2',
    custom_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_fields)),
    assigned_to_id TEXT,
    created_by_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE RESTRICT,
    FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
    FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE job_notes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    job_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by_id TEXT,
    is_stage_change INTEGER NOT NULL DEFAULT 0 CHECK (is_stage_change IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE installer_lanes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    calendar_id TEXT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
    UNIQUE (calendar_id, name)
);

CREATE TABLE job_schedule_entries (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    job_id TEXT NOT NULL,
    installer_lane_id TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_at > start_at),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (installer_lane_id) REFERENCES installer_lanes(id) ON DELETE RESTRICT
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_at TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
    job_id TEXT,
    customer_id TEXT,
    assigned_to_id TEXT,
    completed_at TEXT,
    completed_by_id TEXT,
    created_by_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (completed_by_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE appointments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    location TEXT,
    reason TEXT,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
    calendar_id TEXT,
    job_id TEXT,
    customer_id TEXT,
    walk_in_name TEXT,
    walk_in_phone TEXT,
    walk_in_email TEXT COLLATE NOCASE,
    created_by_id TEXT,
    google_event_id TEXT UNIQUE,
    google_calendar_id TEXT,
    last_synced_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','failed','deleted')),
    sync_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ends_at > starts_at),
    FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE SET NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE activities (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    activity_type TEXT NOT NULL CHECK (activity_type IN ('note','stage_changed','job_created','job_updated','schedule_added','schedule_updated','schedule_removed','task_created','task_completed','appointment_created','appointment_completed','file_uploaded','customer_updated')),
    note TEXT,
    metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
    job_id TEXT,
    customer_id TEXT,
    task_id TEXT,
    appointment_id TEXT,
    created_by_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE files (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    filename TEXT NOT NULL,
    local_path TEXT NOT NULL,
    mime_type TEXT,
    byte_size INTEGER,
    job_id TEXT,
    customer_id TEXT,
    task_id TEXT,
    uploaded_by_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (job_id IS NOT NULL OR customer_id IS NOT NULL OR task_id IS NOT NULL),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
    FOREIGN KEY (uploaded_by_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE tags (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#1976D2',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE job_tags (
    job_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (job_id, tag_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX users_role_idx ON users(role);
CREATE INDEX calendars_sort_idx ON calendars(sort_order);
CREATE INDEX kanban_boards_sort_idx ON kanban_boards(sort_order);
CREATE INDEX kanban_boards_default_idx ON kanban_boards(is_default);
CREATE INDEX kanban_sections_board_sort_idx ON kanban_sections(board_id, sort_order);
CREATE INDEX pipeline_stages_board_idx ON pipeline_stages(board_id);
CREATE INDEX pipeline_stages_board_section_sort_idx ON pipeline_stages(board_id, section_id, sort_order);
CREATE INDEX pipeline_stages_bench_idx ON pipeline_stages(moves_to_bench);
CREATE INDEX pipeline_stages_scheduled_idx ON pipeline_stages(is_scheduled_stage);
CREATE INDEX pipeline_stages_closed_idx ON pipeline_stages(is_closed);
CREATE INDEX job_field_definitions_board_sort_idx ON job_field_definitions(board_id, sort_order);
CREATE INDEX customers_name_idx ON customers(name);
CREATE INDEX customers_primary_email_idx ON customers(primary_email);
CREATE INDEX customer_phones_customer_idx ON customer_phones(customer_id);
CREATE INDEX customer_phones_value_idx ON customer_phones(value);
CREATE INDEX customer_emails_customer_idx ON customer_emails(customer_id);
CREATE INDEX customer_emails_value_idx ON customer_emails(value);
CREATE INDEX customer_addresses_customer_idx ON customer_addresses(customer_id);
CREATE INDEX jobs_job_number_idx ON jobs(job_number);
CREATE INDEX jobs_customer_idx ON jobs(customer_id);
CREATE INDEX jobs_board_idx ON jobs(board_id);
CREATE INDEX jobs_stage_idx ON jobs(stage_id);
CREATE INDEX jobs_board_stage_idx ON jobs(board_id, stage_id);
CREATE INDEX jobs_assigned_idx ON jobs(assigned_to_id);
CREATE INDEX job_notes_job_id_created_at_idx ON job_notes(job_id, created_at);
CREATE INDEX installer_lanes_calendar_sort_idx ON installer_lanes(calendar_id, sort_order);
CREATE INDEX job_schedule_entries_job_id_idx ON job_schedule_entries(job_id);
CREATE INDEX job_schedule_entries_range_idx ON job_schedule_entries(start_at, end_at);
CREATE INDEX job_schedule_entries_installer_lane_idx ON job_schedule_entries(installer_lane_id);
CREATE INDEX tasks_due_idx ON tasks(due_at);
CREATE INDEX idx_tasks_job_id ON tasks(job_id);
CREATE INDEX tasks_customer_idx ON tasks(customer_id);
CREATE INDEX tasks_assigned_idx ON tasks(assigned_to_id, status);
CREATE INDEX appointments_starts_idx ON appointments(starts_at);
CREATE INDEX appointments_calendar_idx ON appointments(calendar_id);
CREATE INDEX idx_appointments_job_id ON appointments(job_id);
CREATE INDEX appointments_customer_idx ON appointments(customer_id);
CREATE INDEX appointments_google_event_idx ON appointments(google_event_id);
CREATE INDEX appointments_sync_status_idx ON appointments(sync_status);
CREATE INDEX idx_activities_job_created ON activities(job_id, created_at);
CREATE INDEX activities_customer_idx ON activities(customer_id, created_at);
CREATE INDEX activities_created_idx ON activities(created_at);
CREATE INDEX idx_files_job_id ON files(job_id);
CREATE INDEX files_customer_idx ON files(customer_id);
CREATE INDEX files_task_idx ON files(task_id);
CREATE INDEX job_tags_tag_idx ON job_tags(tag_id);

-- Optional JSON indexes. These only work when SQLite is compiled with JSON1, which most modern builds are.
-- Create expression indexes later for specific JSON keys you actually query, for example:
-- CREATE INDEX jobs_custom_fields_project_type_idx ON jobs(json_extract(custom_fields, '$.project_type'));
-- CREATE INDEX activities_metadata_entity_idx ON activities(json_extract(metadata, '$.entity'));

-- updated_at triggers
CREATE TRIGGER app_settings_updated_at
AFTER UPDATE ON app_settings
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE app_settings SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER calendars_updated_at
AFTER UPDATE ON calendars
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE calendars SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER kanban_boards_updated_at
AFTER UPDATE ON kanban_boards
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE kanban_boards SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER kanban_sections_updated_at
AFTER UPDATE ON kanban_sections
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE kanban_sections SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER pipeline_stages_updated_at
AFTER UPDATE ON pipeline_stages
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE pipeline_stages SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER job_field_definitions_updated_at
AFTER UPDATE ON job_field_definitions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE job_field_definitions SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER customers_updated_at
AFTER UPDATE ON customers
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE customers SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER jobs_updated_at
AFTER UPDATE ON jobs
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER job_schedule_entries_updated_at
AFTER UPDATE ON job_schedule_entries
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE job_schedule_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER appointments_updated_at
AFTER UPDATE ON appointments
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE appointments SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Seed singleton app settings row.
INSERT OR IGNORE INTO app_settings (id, company_name, timezone)
VALUES (1, 'My Company', 'America/Los_Angeles');