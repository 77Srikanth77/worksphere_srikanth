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
('ravi.kumar@example.com','CHANGE_ME','Ravi Kumar',     (SELECT role_id FROM roles WHERE role_name='EMPLOYEE'),  'EMP001'),
('priya.reddy@example.com','CHANGE_ME','Priya Reddy',   (SELECT role_id FROM roles WHERE role_name='EMPLOYEE'),  'EMP002'),
('arjun.patel@example.com','CHANGE_ME','Arjun Patel',   (SELECT role_id FROM roles WHERE role_name='EMPLOYEE'),  'EMP003'),
('sneha.rao@example.com', 'CHANGE_ME','Sneha Rao',      (SELECT role_id FROM roles WHERE role_name='EMPLOYEE'),  'EMP004');

INSERT INTO marketing_assignments (employee_id, agent_user_id, assigned_on, is_active) VALUES
('EMP003', (SELECT user_id FROM users WHERE email='marketing@example.com'), date('now','localtime','-60 days'), 1),
('EMP004', (SELECT user_id FROM users WHERE email='marketing@example.com'), date('now','localtime','-30 days'), 1);

INSERT INTO submissions (employee_id, agent_user_id, vendor_id, client_name, job_title, rate, submitted_on, status) VALUES
('EMP003', (SELECT user_id FROM users WHERE email='marketing@example.com'), 1, 'Contoso Retail',  'React Developer',       '$70/hr', date('now','localtime','-20 days'), 'SHORTLISTED'),
('EMP003', (SELECT user_id FROM users WHERE email='marketing@example.com'), 2, 'Fabrikam Inc',    'Full-stack Engineer',   '$72/hr', date('now','localtime','-12 days'), 'SUBMITTED'),
('EMP003', (SELECT user_id FROM users WHERE email='marketing@example.com'), 3, 'Litware',         'Node.js Developer',     '$68/hr', date('now','localtime','-5 days'),  'REJECTED'),
('EMP004', (SELECT user_id FROM users WHERE email='marketing@example.com'), 1, 'Tailspin Air',    'QA Automation Engineer','$60/hr', date('now','localtime','-9 days'),  'SUBMITTED'),
('EMP004', (SELECT user_id FROM users WHERE email='marketing@example.com'), 2, 'Wide World Imp.', 'SDET',                  '$62/hr', date('now','localtime','-3 days'),  'SHORTLISTED');

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
((SELECT user_id FROM users WHERE email='marketing@example.com'), date('now','localtime','-6 days','weekday 1','-7 days'), '3 submissions, 1 interview attended, 1 shortlisted.'),
((SELECT user_id FROM users WHERE email='marketing@example.com'), date('now','localtime','-6 days','weekday 1'), '2 submissions so far; Arjun has a manager round on Thursday.');
