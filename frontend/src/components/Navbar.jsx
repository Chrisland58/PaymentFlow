/**
 * Navbar — Issue #109 role-aware navigation affordances
 *
 * Changes from the base implementation:
 * 1. Admin-only links are completely omitted for non-admin users (no leakage).
 * 2. A subtle "Admin" role badge appears next to the brand when authenticated
 *    as an admin, so the user knows which capability set is active.
 * 3. A visual section divider separates PUBLIC_LINKS from ADMIN_LINKS in the
 *    desktop nav so admins can distinguish general vs. admin-only areas at a
 *    glance.
 * 4. Admin-only links receive an `aria-description` noting they require admin
 *    access, improving screen-reader context for admins.
 * 5. The mobile menu mirrors the same role-based omission and divider.
 * 6. The "Admin Login" CTA is only shown to unauthenticated users; admins see
 *    their role badge and a sign-out button instead — consistent, no confusion.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useTranslation } from "react-i18next";
import TestnetBanner from "./TestnetBanner";
import { useTheme } from "../pages/_app";
import { useAdminAuthContext } from "../hooks/AdminAuthContext";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "../i18n";

const PUBLIC_LINKS = [
  { href: "/pay-fees",  i18nKey: "nav.payFees",   adminOnly: false },
  { href: "/dashboard", i18nKey: "nav.dashboard", adminOnly: false },
  { href: "/reports",   i18nKey: "nav.reports",   adminOnly: false },
];

/**
 * ADMIN_LINKS are completely hidden from non-admin users.
 * They are never rendered in the DOM so unauthenticated users have no
 * visual or source-code hint that these routes exist.
 */
const ADMIN_LINKS = [
  { href: "/fee-adjustments", i18nKey: "nav.feeRules",   adminOnly: true },
  { href: "/audit-logs",      i18nKey: "nav.auditLogs",  adminOnly: true },
  { href: "/disputes",        i18nKey: "nav.disputes",   adminOnly: true },
  { href: "/webhooks",        i18nKey: "nav.webhooks",   adminOnly: true },
];

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

export default function Navbar() {
  const { pathname } = useRouter();
  const [open, setOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const { dark, toggle } = useTheme();
  const { isAdmin, logout } = useAdminAuthContext();

  // Role-aware link resolution (#109):
  // Admin-only links are completely omitted for non-admin users — they are
  // never rendered in the DOM so there is no visible or source-level hint.
  const publicLinks = PUBLIC_LINKS;
  const adminLinks  = isAdmin ? ADMIN_LINKS : [];

  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <style>{`
        .nav {
          background: #0e1424;
          background-image: radial-gradient(600px 120px at 18% 0%, rgba(16,185,129,0.20), transparent 70%);
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          position: sticky;
          top: 0;
          z-index: 200;
          backdrop-filter: saturate(140%);
        }
        .nav-inner {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 1.5rem;
          height: 60px;
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }
        .nav-brand {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          text-decoration: none;
          flex-shrink: 0;
          margin-right: 0.5rem;
        }
        .nav-logo {
          width: 32px; height: 32px;
          background: linear-gradient(135deg, #34d399 0%, #059669 55%, #0d9488 100%);
          border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 0.85rem; color: #fff;
          flex-shrink: 0;
          letter-spacing: -0.05em;
          box-shadow: 0 4px 14px -2px rgba(5,150,105,0.6);
        }
        .nav-name {
          color: #f1f5f9;
          font-weight: 700;
          font-size: 0.9375rem;
          letter-spacing: -0.02em;
          white-space: nowrap;
        }
        /* Role badge shown next to brand when logged in as admin (#109) */
        .nav-role-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          background: rgba(5, 150, 105, 0.22);
          border: 1px solid rgba(52, 211, 153, 0.3);
          color: #34d399;
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .nav-links {
          display: flex;
          align-items: center;
          gap: 0.125rem;
          flex: 1;
        }
        .nav-link {
          color: rgba(255, 255, 255, 0.5);
          text-decoration: none;
          font-size: 0.8375rem;
          font-weight: 500;
          padding: 0.375rem 0.7rem;
          border-radius: 6px;
          transition: color 0.12s, background 0.12s;
          white-space: nowrap;
        }
        .nav-link:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
        .nav-link.active { color: #fff; background: rgba(255, 255, 255, 0.1); font-weight: 600; }
        /* Section divider between public and admin nav groups (#109) */
        .nav-section-divider {
          width: 1px;
          height: 20px;
          background: rgba(255, 255, 255, 0.12);
          margin: 0 0.25rem;
          flex-shrink: 0;
          align-self: center;
        }
        /* Subtle accent on admin-only links so admins can tell at a glance (#109) */
        .nav-link-admin {
          color: rgba(52, 211, 153, 0.65);
        }
        .nav-link-admin:hover {
          color: #34d399;
          background: rgba(5, 150, 105, 0.14);
        }
        .nav-link-admin.active {
          color: #34d399;
          background: rgba(5, 150, 105, 0.18);
        }
        .nav-right { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
        .nav-theme-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px; height: 32px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.6);
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s, color 0.12s;
        }
        .nav-theme-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.2);
          color: #fff;
        }
        .nav-pill {
          display: inline-flex; align-items: center;
          background: transparent;
          border: 1.5px solid rgba(255, 255, 255, 0.14);
          border-radius: 7px;
          color: rgba(255, 255, 255, 0.65);
          cursor: pointer;
          font: 500 0.8rem/1 inherit;
          padding: 0.375rem 0.875rem;
          transition: all 0.12s;
          text-decoration: none;
          white-space: nowrap;
        }
        .nav-pill:hover {
          border-color: rgba(255, 255, 255, 0.3);
          color: #fff;
          background: rgba(255, 255, 255, 0.06);
        }
        .nav-pill-accent {
          background: linear-gradient(135deg, #059669 0%, #0d9488 100%);
          border: none;
          color: #fff;
          font-weight: 700;
          box-shadow: 0 4px 14px -3px rgba(5,150,105,0.6);
        }
        .nav-pill-accent:hover {
          filter: brightness(1.08);
          color: #fff;
          background: linear-gradient(135deg, #059669 0%, #0d9488 100%);
        }
        .nav-lang {
          appearance: none;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 7px;
          color: rgba(255, 255, 255, 0.8);
          font: 500 0.8rem/1 inherit;
          padding: 0.4rem 0.55rem;
          cursor: pointer;
          outline: none;
        }
        .nav-lang:hover {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.22);
        }
        .nav-hamburger {
          display: none;
          align-items: center;
          justify-content: center;
          width: 32px; height: 32px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 7px;
          cursor: pointer;
          color: rgba(255, 255, 255, 0.7);
          font-size: 1.1rem;
          line-height: 1;
        }
        .nav-mobile {
          display: none;
          flex-direction: column;
          background: #0c1525;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          padding: 0.5rem 1rem 1rem;
          gap: 0.125rem;
        }
        .nav-mobile.open { display: flex; }
        .nav-mobile-divider {
          height: 1px;
          background: rgba(255,255,255,0.07);
          margin: 0.5rem 0;
        }
        /* Mobile admin section label (#109) */
        .nav-mobile-section-label {
          font-size: 0.6rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: rgba(52, 211, 153, 0.55);
          padding: 0.375rem 0.7rem 0.1rem;
          pointer-events: none;
          user-select: none;
        }
        @media (max-width: 720px) {
          .nav-links { display: none; }
          .nav-hamburger { display: flex; }
          .nav-lang { max-width: 130px; }
          .nav-role-badge { display: none; }
        }
      `}</style>

      <TestnetBanner />
      <nav className="nav" aria-label={t("nav.mainNavAria")}>
        <div className="nav-inner">
          {/* Brand + optional admin role badge (#109) */}
          <Link href="/" className="nav-brand">
            <div className="nav-logo">S</div>
            <span className="nav-name">StellarEduPay</span>
          </Link>
          {isAdmin && (
            <span
              className="nav-role-badge"
              aria-label={t("nav.adminRoleBadgeAria")}
              title={t("nav.adminRoleBadgeAria")}
            >
              {t("nav.adminSection")}
            </span>
          )}

          {/* Desktop nav links — role-aware (#109) */}
          <nav
            className="nav-links"
            aria-label={isAdmin ? t("nav.mainNavAria") : undefined}
          >
            {/* Public links */}
            {publicLinks.map(({ href, i18nKey }) => (
              <Link
                key={href}
                href={href}
                className={`nav-link${pathname === href ? " active" : ""}`}
                aria-current={pathname === href ? "page" : undefined}
              >
                {t(i18nKey)}
              </Link>
            ))}

            {/* Section divider + admin links — only rendered for admins (#109) */}
            {adminLinks.length > 0 && (
              <>
                <div
                  className="nav-section-divider"
                  role="separator"
                  aria-label={t("nav.adminSection")}
                />
                {adminLinks.map(({ href, i18nKey }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-link nav-link-admin${pathname === href ? " active" : ""}`}
                    aria-current={pathname === href ? "page" : undefined}
                    aria-description={t("nav.adminOnlyLinkAria")}
                  >
                    {t(i18nKey)}
                  </Link>
                ))}
              </>
            )}
          </nav>

          <div className="nav-right">
            <select
              className="nav-lang"
              value={i18n.resolvedLanguage || "en"}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              aria-label={t("nav.language")}
            >
              {SUPPORTED_LOCALES.map((lng) => (
                <option key={lng} value={lng}>{LOCALE_NAMES[lng]}</option>
              ))}
            </select>
            <button
              className="nav-theme-btn"
              onClick={toggle}
              aria-label={dark ? t("nav.switchToLight") : t("nav.switchToDark")}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            {isAdmin
              ? <button className="nav-pill" onClick={logout}>{t("actions.signOut")}</button>
              : <Link href="/login" className="nav-pill nav-pill-accent">{t("nav.adminLogin")}</Link>
            }
            <button
              className="nav-hamburger"
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              aria-controls="nav-mobile-menu"
              aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
            >
              {open ? "✕" : "☰"}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu — role-aware (#109) */}
      <div
        id="nav-mobile-menu"
        className={`nav-mobile${open ? " open" : ""}`}
        aria-hidden={!open}
        aria-label={t("nav.mainNavAria")}
      >
        {/* Public links in mobile */}
        {publicLinks.map(({ href, i18nKey }) => (
          <Link
            key={href}
            href={href}
            className={`nav-link${pathname === href ? " active" : ""}`}
            onClick={() => setOpen(false)}
          >
            {t(i18nKey)}
          </Link>
        ))}

        {/* Admin-only section in mobile — only rendered for admins (#109) */}
        {adminLinks.length > 0 && (
          <>
            <div className="nav-mobile-divider" />
            <span className="nav-mobile-section-label" aria-hidden="true">
              {t("nav.adminSection")}
            </span>
            {adminLinks.map(({ href, i18nKey }) => (
              <Link
                key={href}
                href={href}
                className={`nav-link nav-link-admin${pathname === href ? " active" : ""}`}
                onClick={() => setOpen(false)}
                aria-description={t("nav.adminOnlyLinkAria")}
              >
                {t(i18nKey)}
              </Link>
            ))}
          </>
        )}

        <div className="nav-mobile-divider" />
        {isAdmin
          ? <button className="nav-pill" onClick={() => { logout(); setOpen(false); }} style={{ marginTop: "0.25rem", width: "fit-content" }}>{t("actions.signOut")}</button>
          : <Link href="/login" className="nav-pill nav-pill-accent" style={{ marginTop: "0.25rem", width: "fit-content" }} onClick={() => setOpen(false)}>{t("nav.adminLogin")}</Link>
        }
      </div>
    </>
  );
}
