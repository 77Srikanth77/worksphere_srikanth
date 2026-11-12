-- 007: per-assignment worksite address, client-side reporting manager and LCA details (for Legal).
ALTER TABLE work ADD COLUMN worksite_address TEXT;          -- street address of the client worksite
ALTER TABLE work ADD COLUMN worksite_zip TEXT;
ALTER TABLE work ADD COLUMN client_manager_name TEXT;       -- who the employee reports to at the client
ALTER TABLE work ADD COLUMN client_manager_title TEXT;
ALTER TABLE work ADD COLUMN client_manager_email TEXT;
ALTER TABLE work ADD COLUMN client_manager_phone TEXT;
ALTER TABLE work ADD COLUMN lca_case_number TEXT;           -- certified LCA covering this worksite
ALTER TABLE work ADD COLUMN lca_wage_cents INTEGER CHECK (lca_wage_cents IS NULL OR lca_wage_cents > 0);  -- wage on the LCA
ALTER TABLE work ADD COLUMN lca_wage_unit TEXT CHECK (lca_wage_unit IS NULL OR lca_wage_unit IN ('YEAR','HOUR'));
