import { useState } from 'react';

// Company branding shown on every screen. To change the logo, replace
// frontend/public/branding/sysintelli-logo.png (or point LOGO_URL at another file).
export const COMPANY_NAME = 'Sysintelli Inc';
export const LOGO_URL = '/branding/sysintelli-logo.png';

/** Company logo. Falls back to nothing if the file is missing, so the name alone still shows. */
export function CompanyLogo({ className = 'company-logo' }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className={className} src={LOGO_URL} alt={`${COMPANY_NAME} logo`} onError={() => setFailed(true)} />;
}

/** "Powered by [logo] Sysintelli Inc" */
export function PoweredBy({ className = '' }) {
  return (
    <span className={`powered-by ${className}`}>
      <span className="powered-label">Powered by</span>
      <CompanyLogo />
      <strong>{COMPANY_NAME}</strong>
    </span>
  );
}

/** Footer used on every screen. */
export function BrandFooter() {
  return (
    <footer className="brand-footer">
      <span>© {new Date().getFullYear()} {COMPANY_NAME}. Internal use only.</span>
    </footer>
  );
}
