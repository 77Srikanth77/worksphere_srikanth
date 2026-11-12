-- 012: an approved cap case points at the H-1B visa / LCA record it created on the employee's file.
ALTER TABLE h1b_cap_cases ADD COLUMN visa_id INTEGER REFERENCES immigration(visa_id) ON DELETE SET NULL;
