-- 011: every work assignment (project or bench, past or present) must have a job title.
-- Enforced with triggers because SQLite can't add NOT NULL to an existing column without rebuilding the table.
-- Older rows without a title stay readable; they just can't be saved again until a title is entered.
CREATE TRIGGER trg_work_title_insert BEFORE INSERT ON work
WHEN trim(coalesce(NEW.job_title, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'Job title is required for every assignment.');
END;

CREATE TRIGGER trg_work_title_update BEFORE UPDATE OF job_title ON work
WHEN trim(coalesce(NEW.job_title, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'Job title is required for every assignment.');
END;
