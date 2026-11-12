import { useState } from 'react';

import { Link } from 'react-router-dom';

// Company branding shown on every screen. Images live in frontend/public/branding/:
//   sysintelli-logo.png      small logo (home page, "Powered by")
//   sysintelli-header.jpg    emblem + "SysIntelli · We do it for you" strip (header band on every screen)
//   sysintelli-banner.jpg    full banner (login page)
// Replace a file with one of the same name to change it.
export const COMPANY_NAME = 'Sysintelli Inc';
export const LOGO_URL = '/branding/sysintelli-logo.png';
const HEADER_URL = '/branding/sysintelli-header.jpg';
export const BANNER_URL = '/branding/sysintelli-banner.jpg';

/** Image that quietly disappears if its file is missing */
function BrandImg({ src, className, alt = '' }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}

/** Branded header band at the top of every screen: emblem + "SysIntelli · We do it for you" + product name */
export function BrandBanner() {
  return (
    <div className="brand-banner">
      <Link to="/home" className="brand-banner-logo" aria-label={`${COMPANY_NAME}, WorkSphere home`}>
        <BrandImg src={HEADER_URL} className="brand-header-img" alt={`${COMPANY_NAME}: We do it for you`} />
      </Link>
      <div className="brand-banner-product">
        <strong>WorkSphere</strong>
        <span>Workforce compliance &amp; performance</span>
      </div>
    </div>
  );
}

/** Full banner image (login page) */
export function FullBanner({ className = 'login-banner' }) {
  return <BrandImg src={BANNER_URL} className={className} alt={`${COMPANY_NAME}: We do it for you`} />;
}

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
