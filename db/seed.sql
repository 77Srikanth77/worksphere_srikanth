-- WorkSphere sample data. Dates are relative to today so the alert job
-- always has something to find.
-- Run AFTER schema.sql:  sqlite3 db/worksphere.db < db/seed.sql
-- Then set demo passwords:  cd api-node && npm run set-passwords
PRAGMA foreign_keys = ON;

INSERT INTO emp (employee_id, first_name, middle_name, last_name, date_of_birth, hire_date, email, phone_number, emergency_contact_name, emergency_contact_number, bio) VALUES
('EMP001','Ravi',NULL,'Kumar','1990-04-12','2021-02-15','ravi.kumar@example.com','555-0101','Anitha Kumar','555-0901','Java / Spring Boot developer with 8 years of experience in banking platforms.'),
('EMP002','Priya','S','Reddy','1993-09-03','2022-07-01','priya.reddy@example.com','555-0102','Suresh Reddy','555-0902','Data engineer: Python, Spark, Airflow, Snowflake.'),
('EMP003','Arjun',NULL,'Patel','1995-01-25','2023-03-20','arjun.patel@example.com','555-0103','Meena Patel','555-0903','React and Node.js full-stack developer.'),
('EMP004','Sneha',NULL,'Rao','1992-11-30','2020-10-05','sneha.rao@example.com','555-0104','Kiran Rao','555-0904','QA automation engineer: Selenium, Cypress, Playwright.');

INSERT INTO clients (client_name, contact_name, contact_email, phone, address) VALUES
('Northwind Bank','Laura Hill','laura.hill@example.com','555-0201','Charlotte, NC'),
('BlueRiver Health','Mark Evans','mark.evans@example.com','555-0202','Dallas, TX');

INSERT INTO vendors (vendor_name, contact_name, contact_email, phone) VALUES
('Apex Staffing','Tom Reed','tom.reed@example.com','555-0301'),
('Summit IT Partners','Nina Shah','nina.shah@example.com','555-0302'),
('Keystone Solutions','Owen Price','owen.price@example.com','555-0303');

INSERT INTO work (employee_id, client_id, vendor_id, project_name, job_title, job_duties, work_location, city, state, status, start_date, end_date) VALUES
('EMP001',1,1,'Core Payments Modernization','Senior Java Developer','Build Spring Boot microservices for payment processing; code reviews; production support.','Client site','Charlotte','NC','PROJECT','2023-01-09',NULL),
('EMP001',NULL,NULL,'Internal - Loan Portal','Java Developer','Maintained loan origination modules; wrote REST APIs.','Office','Dallas','TX','PROJECT','2021-02-15','2022-12-30'),
('EMP002',2,2,'Claims Data Lake','Data Engineer','Design Airflow DAGs; build Spark ETL into Snowflake; data quality checks.','Remote','Austin','TX','PROJECT','2024-05-01',NULL),
('EMP003',NULL,NULL,NULL,'Full-stack Developer','On bench: completing AWS certification and interview preparation.','Office','Dallas','TX','BENCH','2025-09-01',NULL),
('EMP003',1,3,'Online Banking UI','React Developer','Built customer dashboard screens in React; integrated REST APIs.','Client site','Charlotte','NC','PROJECT','2023-04-01','2025-08-29'),
('EMP004',NULL,NULL,NULL,'QA Automation Engineer','On bench: Playwright training.','Remote','Atlanta','GA','BENCH','2026-06-15',NULL);

-- Expiry dates spread across the 180 / 90 / 60 / 30 day windows
INSERT INTO immigration (employee_id, visa_type, receipt_number, start_date, expiry_date, lca_number, lca_start_date, lca_expiry_date, case_status, notes) VALUES
('EMP001','H1B','WAC2390012345', date('now','localtime','-1000 days'), date('now','localtime','+150 days'),'I-200-23001-111111', date('now','localtime','-1000 days'), date('now','localtime','+150 days'),'ACTIVE','Extension to be filed.'),
('EMP002','H1B','EAC2490054321', date('now','localtime','-600 days'), date('now','localtime','+45 days'),'I-200-24002-222222', date('now','localtime','-600 days'), date('now','localtime','+45 days'),'IN_PROGRESS','Amendment drafted by Legal.'),
('EMP003','STEM-OPT','YSC2512345678', date('now','localtime','-300 days'), date('now','localtime','+400 days'), NULL, NULL, NULL,'ACTIVE',NULL),
('EMP004','H1B','WAC2290099999', date('now','localtime','-1050 days'), date('now','localtime','+20 days'),'I-200-22003-333333', date('now','localtime','-1050 days'), date('now','localtime','+20 days'),'ACTIVE','URGENT: on bench, needs project for extension.');

INSERT INTO trainings (employee_id, training_name, provider, start_date, end_date, status) VALUES
('EMP001','Spring Security Deep Dive','Udemy','2024-03-01','2024-03-20','COMPLETED'),
('EMP002','Snowflake SnowPro Core','Snowflake','2024-02-01','2024-03-01','COMPLETED'),
('EMP003','AWS Solutions Architect Associate','AWS','2025-09-10',NULL,'IN_PROGRESS'),
('EMP003','Advanced React Patterns','Frontend Masters','2025-09-05','2025-09-25','COMPLETED'),
('EMP004','Playwright with TypeScript','Udemy','2026-07-01',NULL,'IN_PROGRESS');

-- Login accounts. password_hash is a placeholder: run `npm run set-passwords`
-- in api-node to give every account the demo password.
INSERT INTO users (email, password_hash, full_name, role_id, employee_id) VALUES
('ceo@example.com',       'CHANGE_ME','Company CEO',    (SELECT role_id FROM roles WHERE role_name='CEO'),       NULL),
('admin@example.com',     'CHANGE_ME','System Admin',   (SELECT role_id FROM roles WHERE role_name='ADMIN'),     NULL),
('hr@example.com',        'CHANGE_ME','HR Manager',     (SELECT role_id FROM roles WHERE role_name='HR'),        NULL),
('legal@example.com',     'CHANGE_ME','Immigration Attorney',(SELECT role_id FROM roles WHERE role_name='LEGAL'),NULL),
('marketing@example.com', 'CHANGE_ME','Vikram (Marketing)',(SELECT role_id FROM roles WHERE role_name='MARKETING'),NULL),
('manager@example.com',   'CHANGE_ME','Meera (Marketing Manager)',(SELECT role_id FROM roles WHERE role_name='MARKETING_MANAGER'),NULL),
('ravi.kumar@example.com','CHANGE_ME','Ravi Kumar',     (SELECT role_id FROM roles WHERE role_name='EMPLOYEE'),  'EMP001'),
('priya.reddy@example.com','CHANGE_ME','Priya Reddy',   (SELECT role_id FROM roles WHERE role_name='EMPLOYEE'),  'EMP002'),
('arjun.patel@example.com','CHANGE_ME','Arjun Patel',   (SELECT role_id FROM roles WHERE role_name='EMPLOYEE'),  'EMP003'),
('sneha.rao@example.com', 'CHANGE_ME','Sneha Rao',      (SELECT role_id FROM roles WHERE role_name='EMPLOYEE'),  'EMP004');

INSERT INTO marketing_assignments (employee_id, agent_user_id, assigned_on, is_active) VALUES
('EMP003', (SELECT user_id FROM users WHERE email='marketing@example.com'), date('now','localtime','-60 days'), 1),
('EMP004', (SELECT user_id FROM users WHERE email='marketing@example.com'), date('now','localtime','-30 days'), 1);

-- Submissions: some followed up on time, some overdue (no activity for 5+ business days)
INSERT INTO submissions (employee_id, agent_user_id, vendor_id, client_name, job_title, rate, position_ref, vendor_contact_name, submitted_on, status, last_activity_on, next_follow_up_on, closed_on) VALUES
('EMP003', (SELECT user_id FROM users WHERE email='marketing@example.com'), 1, 'Contoso Retail',  'React Developer',       '$70/hr', 'APX-4411', 'Tom Reed',  date('now','localtime','-20 days'), 'CLIENT_INTERVIEW',    date('now','localtime','-2 days'),  date('now','localtime','+1 days'), NULL),
('EMP003', (SELECT user_id FROM users WHERE email='marketing@example.com'), 2, 'Fabrikam Inc',    'Full-stack Engineer',   '$72/hr', 'SIT-2087', 'Nina Shah', date('now','localtime','-12 days'), 'ACKNOWLEDGED',        date('now','localtime','-9 days'),  date('now','localtime','-6 days'), NULL),
('EMP003', (SELECT user_id FROM users WHERE email='marketing@example.com'), 3, 'Litware',         'Node.js Developer',     '$68/hr', NULL,       'Owen Price',date('now','localtime','-5 days'),  'REJECTED',            date('now','localtime','-2 days'),  NULL,                              date('now','localtime','-2 days')),
('EMP004', (SELECT user_id FROM users WHERE email='marketing@example.com'), 1, 'Tailspin Air',    'QA Automation Engineer','$60/hr', 'APX-4420', 'Tom Reed',  date('now','localtime','-9 days'),  'SUBMITTED',           date('now','localtime','-9 days'),  date('now','localtime','-6 days'), NULL),
('EMP004', (SELECT user_id FROM users WHERE email='marketing@example.com'), 2, 'Wide World Imp.', 'SDET',                  '$62/hr', 'SIT-2101', 'Nina Shah', date('now','localtime','-3 days'),  'SCREENING_SCHEDULED', date('now','localtime','-1 days'),  date('now','localtime','+2 days'), NULL);

-- Timeline for each submission
INSERT INTO submission_activities (submission_id, user_id, activity_type, channel, vendor_contact_name, vendor_feedback, note, from_status, to_status, created_at) VALUES
(1, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'SUBMITTED', 'EMAIL', 'Tom Reed', NULL, 'Resume sent for React role at Contoso.', NULL, 'SUBMITTED', datetime('now','localtime','-20 days')),
(1, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'FOLLOW_UP', 'CALL', 'Tom Reed', 'Client liked the profile, screening call set up.', 'Shared availability with vendor.', 'SUBMITTED', 'SCREENING_SCHEDULED', datetime('now','localtime','-16 days')),
(1, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'FOLLOW_UP', 'CALL', 'Tom Reed', 'Screening went well; moving to technical round.', NULL, 'SCREENING_SCHEDULED', 'CLIENT_INTERVIEW', datetime('now','localtime','-11 days')),
(1, (SELECT user_id FROM users WHERE email='arjun.patel@example.com'), 'EMPLOYEE_FEEDBACK', NULL, NULL, NULL, 'Technical round done. They asked a lot about React performance.', NULL, NULL, datetime('now','localtime','-10 days')),
(1, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'FOLLOW_UP', 'EMAIL', 'Tom Reed', 'Manager round confirmed for this week.', 'Sent prep notes to Arjun.', NULL, NULL, datetime('now','localtime','-2 days')),
(2, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'SUBMITTED', 'PORTAL', 'Nina Shah', NULL, 'Submitted on Summit vendor portal.', NULL, 'SUBMITTED', datetime('now','localtime','-12 days')),
(2, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'FOLLOW_UP', 'EMAIL', 'Nina Shah', 'Received; will share with client.', NULL, 'SUBMITTED', 'ACKNOWLEDGED', datetime('now','localtime','-9 days')),
(3, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'SUBMITTED', 'EMAIL', 'Owen Price', NULL, NULL, NULL, 'SUBMITTED', datetime('now','localtime','-5 days')),
(3, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'FOLLOW_UP', 'CALL', 'Owen Price', 'Client needs deeper AWS experience.', 'Suggest finishing AWS certification.', 'SUBMITTED', 'REJECTED', datetime('now','localtime','-2 days')),
(4, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'SUBMITTED', 'EMAIL', 'Tom Reed', NULL, NULL, NULL, 'SUBMITTED', datetime('now','localtime','-9 days')),
(4, (SELECT user_id FROM users WHERE email='sneha.rao@example.com'), 'UPDATE_REQUEST', NULL, NULL, NULL, 'Any update from Tailspin? It has been over a week.', NULL, NULL, datetime('now','localtime','-4 days')),
(5, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'SUBMITTED', 'PORTAL', 'Nina Shah', NULL, NULL, NULL, 'SUBMITTED', datetime('now','localtime','-3 days')),
(5, (SELECT user_id FROM users WHERE email='marketing@example.com'), 'FOLLOW_UP', 'CALL', 'Nina Shah', 'Screening call booked for Thursday 11am.', 'Sneha confirmed the slot.', 'SUBMITTED', 'SCREENING_SCHEDULED', datetime('now','localtime','-1 days'));

-- Sneha asked for an update 4 days ago and nobody has answered
INSERT INTO update_requests (submission_id, employee_id, message, requested_on) VALUES
(4, 'EMP004', 'Any update from Tailspin? It has been over a week.', datetime('now','localtime','-4 days'));

INSERT INTO interviews (employee_id, submission_id, interview_date, round_name, mode, result, feedback) VALUES
('EMP003', 1, datetime('now','localtime','-10 days'), 'Technical 1', 'VIDEO', 'ATTENDED', 'Strong React skills.'),
('EMP003', 1, datetime('now','localtime','+2 days'),  'Manager',     'VIDEO', 'PIPELINE', NULL),
('EMP003', 3, datetime('now','localtime','-4 days'),  'Technical 1', 'PHONE', 'REJECTED', 'Needed more AWS depth.'),
('EMP004', 5, datetime('now','localtime','-1 days'),  'Technical 1', 'VIDEO', 'AWAITING_RESULT', NULL),
('EMP001', NULL, '2022-12-01 10:00:00', 'Client round', 'ONSITE', 'SELECTED', 'Placed at Northwind Bank.');

INSERT INTO vendor_contacts (agent_user_id, vendor_id, contacted_on, notes) VALUES
((SELECT user_id FROM users WHERE email='marketing@example.com'), 1, date('now','localtime','-21 days'), 'Shared hot list of bench consultants.'),
((SELECT user_id FROM users WHERE email='marketing@example.com'), 2, date('now','localtime','-13 days'), 'Discussed Fabrikam full-stack role.'),
((SELECT user_id FROM users WHERE email='marketing@example.com'), 3, date('now','localtime','-6 days'),  'New vendor onboarding call.');

INSERT INTO weekly_status (agent_user_id, week_start, summary) VALUES
((SELECT user_id FROM users WHERE email='marketing@example.com'), date('now','localtime','-6 days','weekday 1','-7 days'), '3 submissions, 1 interview attended, 1 screening scheduled.'),
((SELECT user_id FROM users WHERE email='marketing@example.com'), date('now','localtime','-6 days','weekday 1'), '2 submissions so far; Arjun has a manager round on Thursday.');

-- Finance: bill rates for the two consultants on projects, plus invoices and payments.
-- Ravi (EMP001): Northwind Bank via Apex Staffing, $95/hr, Net 45, monthly.
-- Priya (EMP002): BlueRiver Health via Summit IT Partners, $88/hr, Net 30, monthly.
INSERT INTO billing_rates (work_id, bill_rate_cents, rate_unit, payment_terms_days, invoice_cycle, effective_from, effective_to, notes) VALUES
((SELECT work_id FROM work WHERE employee_id='EMP001' AND end_date IS NULL), 9000, 'HOUR', 45, 'MONTHLY', '2023-01-09', '2025-12-31', 'Original PO rate'),
((SELECT work_id FROM work WHERE employee_id='EMP001' AND end_date IS NULL), 9500, 'HOUR', 45, 'MONTHLY', '2026-01-01', NULL, 'Rate increase from Jan 2026'),
((SELECT work_id FROM work WHERE employee_id='EMP002' AND end_date IS NULL), 8800, 'HOUR', 30, 'MONTHLY', '2024-05-01', NULL, NULL);

-- Monthly invoices for the last four months (dates relative to today)
INSERT INTO invoices (invoice_number, work_id, employee_id, vendor_id, client_id, period_start, period_end, quantity, rate_unit, rate_cents, amount_cents, invoice_date, due_date) VALUES
('INV-1001', (SELECT work_id FROM work WHERE employee_id='EMP001' AND end_date IS NULL), 'EMP001', 1, 1, date('now','localtime','start of month','-4 months'), date('now','localtime','start of month','-3 months','-1 day'), 168, 'HOUR', 9500, 1596000, date('now','localtime','start of month','-3 months','+2 days'), date('now','localtime','start of month','-3 months','+47 days')),
('INV-1002', (SELECT work_id FROM work WHERE employee_id='EMP002' AND end_date IS NULL), 'EMP002', 2, 2, date('now','localtime','start of month','-4 months'), date('now','localtime','start of month','-3 months','-1 day'), 160, 'HOUR', 8800, 1408000, date('now','localtime','start of month','-3 months','+2 days'), date('now','localtime','start of month','-3 months','+32 days')),
('INV-1003', (SELECT work_id FROM work WHERE employee_id='EMP001' AND end_date IS NULL), 'EMP001', 1, 1, date('now','localtime','start of month','-3 months'), date('now','localtime','start of month','-2 months','-1 day'), 176, 'HOUR', 9500, 1672000, date('now','localtime','start of month','-2 months','+2 days'), date('now','localtime','start of month','-2 months','+47 days')),
('INV-1004', (SELECT work_id FROM work WHERE employee_id='EMP002' AND end_date IS NULL), 'EMP002', 2, 2, date('now','localtime','start of month','-3 months'), date('now','localtime','start of month','-2 months','-1 day'), 168, 'HOUR', 8800, 1478400, date('now','localtime','start of month','-2 months','+2 days'), date('now','localtime','start of month','-2 months','+32 days')),
('INV-1005', (SELECT work_id FROM work WHERE employee_id='EMP001' AND end_date IS NULL), 'EMP001', 1, 1, date('now','localtime','start of month','-2 months'), date('now','localtime','start of month','-1 months','-1 day'), 160, 'HOUR', 9500, 1520000, date('now','localtime','start of month','-1 months','+2 days'), date('now','localtime','start of month','-1 months','+47 days')),
('INV-1006', (SELECT work_id FROM work WHERE employee_id='EMP002' AND end_date IS NULL), 'EMP002', 2, 2, date('now','localtime','start of month','-2 months'), date('now','localtime','start of month','-1 months','-1 day'), 152, 'HOUR', 8800, 1337600, date('now','localtime','start of month','-1 months','+2 days'), date('now','localtime','start of month','-1 months','+32 days'));

-- Apex paid INV-1001 in full and INV-1003 partly; Summit paid INV-1002 only (INV-1004 is overdue)
INSERT INTO invoice_payments (invoice_id, amount_cents, paid_on, reference) VALUES
((SELECT invoice_id FROM invoices WHERE invoice_number='INV-1001'), 1596000, date('now','localtime','start of month','-2 months','+15 days'), 'ACH 88213'),
((SELECT invoice_id FROM invoices WHERE invoice_number='INV-1002'), 1408000, date('now','localtime','start of month','-2 months','+1 days'),  'ACH 55102'),
((SELECT invoice_id FROM invoices WHERE invoice_number='INV-1003'), 1000000, date('now','localtime','start of month','-1 months','+12 days'), 'Wire 7731');

-- Timesheets for Priya (EMP002, on project): 8h Mon–Fri for the last 10 weeks.
-- Older weeks approved, last week submitted (waiting for HR), the week 3 weeks ago missing.
WITH RECURSIVE weeks(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM weeks WHERE n < 10)
INSERT INTO timesheets (employee_id, work_id, week_start, status, submitted_at, reviewed_by, reviewed_at)
SELECT 'EMP002', (SELECT work_id FROM work WHERE employee_id='EMP002' AND end_date IS NULL),
       date('now','localtime','-6 days','weekday 1', '-' || (7 * n) || ' days'),
       CASE WHEN n = 1 THEN 'SUBMITTED' ELSE 'APPROVED' END,
       datetime('now','localtime','-6 days','weekday 1', '-' || (7 * n - 4) || ' days', '+17 hours'),
       CASE WHEN n = 1 THEN NULL ELSE (SELECT user_id FROM users WHERE email='hr@example.com') END,
       CASE WHEN n = 1 THEN NULL ELSE datetime('now','localtime','-6 days','weekday 1', '-' || (7 * n - 7) || ' days', '+10 hours') END
FROM weeks WHERE n <> 3;

WITH RECURSIVE days(d) AS (SELECT 0 UNION ALL SELECT d + 1 FROM days WHERE d < 4)
INSERT INTO timesheet_entries (timesheet_id, work_date, hours)
SELECT t.timesheet_id, date(t.week_start, '+' || d || ' days'), 8 FROM timesheets t, days;

-- Summit IT Partners requires a client-approved timesheet every week for Priya's project
UPDATE work SET client_timesheet_required = 1 WHERE employee_id = 'EMP002' AND end_date IS NULL;
