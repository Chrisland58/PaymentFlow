import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import SyncButton from "../components/SyncButton";
import ErrorBoundary from "../components/ErrorBoundary";
import ErrorAlert from "../components/ErrorAlert";
import StudentForm from "../components/StudentForm";
import PageHero, { StatCard } from "../components/PageHero";
import SseDegradedBanner from "../components/SseDegradedBanner";
import RequireAdmin from "../components/RequireAdmin";
import BlockchainStatusBadge from "../components/BlockchainStatusBadge";
import { TableDensityControl, useTableDensity } from "../components/TableDensityControl";
import { usePaymentEvents } from "../hooks/usePaymentEvents";
import { useRetry } from "../hooks/useRetry";
import { getSyncStatus, getPaymentSummary, getStudents, getStudent, getSchool } from "../services/api";
import {
  IconUsers, IconCheck, IconAlertTriangle, IconDollarSign,
  IconSearch, IconChevronLeft, IconChevronRight,
} from "../components/Icons";
import { DEFAULT_CLASS_OPTIONS, loadSchoolClassOptions } from "../utils/classOptions";

const PAGE_SIZE = 20;

function Dashboard() {
  const { t } = useTranslation();
  const timeAgo = (iso) => {
    if (!iso) return t("time.never");
    const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return t("time.justNow");
    if (mins < 60) return t("time.minutesAgo", { mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("time.hoursAgo", { hrs });
    return new Date(iso).toLocaleDateString();
  };

  const STATUS_BADGE = {
    paid:    { cls: "badge badge-success", label: t("status.student.paid") },
    partial: { cls: "badge badge-warning", label: t("status.student.partial") },
    unpaid:  { cls: "badge badge-danger",  label: t("status.student.unpaid") },
  };

  const [lastSyncAt, setLastSyncAt]           = useState(null);
  const [syncMsg, setSyncMsg]                 = useState(null);
  const [summary, setSummary]                 = useState(null);
  const [students, setStudents]               = useState([]);
  const [page, setPage]                       = useState(1);
  const [pages, setPages]                     = useState(1);
  const [total, setTotal]                     = useState(0);
  const [search, setSearch]                   = useState("");
  const [statusFilter, setStatusFilter]       = useState("all");
  const [classFilter, setClassFilter]         = useState("");
  const [classOptions, setClassOptions]       = useState(DEFAULT_CLASS_OPTIONS);
  const [error, setError]                     = useState(null);
  const [editingStudent, setEditingStudent]   = useState(null);
  const [editingStudentData, setEditingStudentData] = useState(null);

  // Table density (compact / default / comfortable) — Issue #113
  const { density, setDensity } = useTableDensity();
  // Set of student IDs whose detail row is currently expanded — Issue #113
  const [expandedRows, setExpandedRows] = useState(new Set());

  const searchDebounceRef = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Holds the AbortController for the most-recent fetchStudents call so
  // superseded (stale) requests can be cancelled before the next one starts.
  const studentsAbortRef = useRef(null);

  // ── useRetry instances ─────────────────────────────────────────────────────
  //
  // Each retry hook wraps a mutable ref-backed fn so execute() always calls
  // the most recent closure (with up-to-date filter values / AbortController).
  // useRetry manages its own `loading` field inside retryState, so there is no
  // separate summaryLoading / studentsLoading state to keep in sync.

  const summaryFnRef  = useRef(() => Promise.resolve());
  const studentsFnRef = useRef(() => Promise.resolve());

  const summaryRetry  = useRetry(() => summaryFnRef.current());
  const studentsRetry = useRetry(() => studentsFnRef.current());

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  //
  // Each helper updates the ref-backed fn with a fresh closure over the current
  // args, resets the retry counter (new filter = new fetch), then calls execute()
  // once.  execute() itself calls the fn via the ref, so scroll position and
  // filters are preserved across retries (the closure already captures them).

  const fetchSummary = useCallback(() => {
    summaryFnRef.current = () =>
      getPaymentSummary().then(({ data }) => setSummary(data));
    summaryRetry.reset();
    summaryRetry.execute();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchStudents = useCallback((p, srch, st, cls) => {
    // Cancel any in-flight student fetch before issuing a new one.
    studentsAbortRef.current?.abort();
    const controller = new AbortController();
    studentsAbortRef.current = controller;

    studentsFnRef.current = () =>
      getStudents(p, PAGE_SIZE, { search: srch, status: st, className: cls }, { signal: controller.signal })
        .then(({ data }) => {
          setStudents(data.students);
          setPages(data.pages || 1);
          setTotal(data.total || 0);
        });

    studentsRetry.reset();
    studentsRetry.execute();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time SSE — surfaces degraded/reconnecting/failed state (Issues #1054, #1078).
  const { degraded, connectionStatus } = usePaymentEvents({
    onEvent: (type) => {
      // Refresh summary/students whenever a payment or dispute event arrives.
      if (type === 'payment' || type.startsWith('dispute')) {
        fetchSummary();
        fetchStudents(page, debouncedSearch, statusFilter, classFilter);
      }
    },
  });

  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchDebounceRef.current);
  }, [search]);

  // Tracks whether the page effect is running for the very first time.
  // On mount the filter effect already calls fetchStudents(1, …), so the page
  // effect must skip that initial run to avoid a duplicate /students request
  // (#1214).  Subsequent page changes (user clicks Next/Prev) are not skipped.
  const isInitialPageRender = useRef(true);

  useEffect(() => {
    getSyncStatus()
      .then(({ data }) => setLastSyncAt(data.lastSyncAt))
      .catch(() => setError(t("dashboard.failedToLoadSyncStatus")));
    fetchSummary();
    loadSchoolClassOptions(getSchool, setClassOptions);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPage(1);
    fetchStudents(1, debouncedSearch, statusFilter, classFilter);
  }, [debouncedSearch, statusFilter, classFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Skip the initial render — the filter effect above already fetched page 1.
    if (isInitialPageRender.current) {
      isInitialPageRender.current = false;
      return;
    }
    fetchStudents(page, debouncedSearch, statusFilter, classFilter);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSyncComplete(data) {
    setLastSyncAt(new Date().toISOString());
    setSyncMsg(data?.message || t("dashboard.syncComplete"));
    setTimeout(() => setSyncMsg(null), 3500);
    fetchSummary();
    setPage(1);
    fetchStudents(1, debouncedSearch, statusFilter, classFilter);
  }

  async function handleEditStudent(student) {
    try {
      const { data } = await getStudent(student.studentId);
      setEditingStudentData(data);
      setEditingStudent(student.studentId);
    } catch {
      setError(t("dashboard.failedToLoadStudentDetails"));
    }
  }

  function handleCloseForm() {
    setEditingStudent(null);
    setEditingStudentData(null);
  }

  function handleSaveStudent() {
    handleCloseForm();
    fetchStudents(page, debouncedSearch, statusFilter, classFilter);
  }

  // Toggle expanded detail row for a student — Issue #113
  function handleRowClick(studentId) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }

  const stats = [
    {
      label: t("dashboard.statTotalStudents"),
      value: summary?.totalStudents ?? summary?.total ?? "—",
      Icon: IconUsers,
      color: "cyan",
    },
    {
      label: t("status.student.paid"),
      value: summary?.paidCount ?? summary?.counts?.paid ?? "—",
      Icon: IconCheck,
      color: "green",
    },
    {
      label: t("dashboard.statPending"),
      value: summary ? ((summary.unpaidCount || 0) + (summary.counts?.partial || 0)) || "—" : "—",
      Icon: IconAlertTriangle,
      color: "amber",
    },
    {
      label: t("dashboard.statXlmCollected"),
      value: summary
        ? (summary.totalXlmCollected || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
        : "—",
      sub: t("dashboard.statXlmTotalSub"),
      Icon: IconDollarSign,
      color: "violet",
    },
  ];

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd   = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <SseDegradedBanner degraded={degraded} connectionStatus={connectionStatus} />
      <style>{`        @keyframes dashFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dash-wrap { animation: dashFadeUp 0.35s ease both; }
        .dash-stat-row { --stat-accent: var(--c); }

        /* Inline toolbar override for search */
        .dash-search {
          position: relative;
        }
        .dash-search-icon {
          position: absolute;
          left: 0.65rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
          display: flex;
        }
        .dash-search input {
          padding-left: 2.125rem !important;
        }

        .student-row-name { font-weight: 500; color: var(--text); }
        .student-row-id { font-family: monospace; font-size: 0.78rem; color: var(--text-muted); }
        .student-row-class { font-size: 0.8125rem; color: var(--text-muted); }
        .student-row-fee { font-variant-numeric: tabular-nums; font-size: 0.875rem; }

        .stat-card-inner {
          display: flex;
          flex-direction: column;
        }
        .stat-card-icon-wrap {
          width: 36px; height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 0.875rem;
          flex-shrink: 0;
        }

        /* Skeleton pulse */
        @keyframes skel-pulse {
          0%,100% { opacity:1; } 50% { opacity:0.5; }
        }
        .skel-block {
          border-radius: 4px;
          background: var(--border);
          animation: skel-pulse 1.4s ease-in-out infinite;
        }

        /* ── Table density — Issue #113 ──────────────────── */
        .data-table[data-density='compact'] td,
        .data-table[data-density='compact'] th {
          padding: 0.3rem 0.75rem;
          font-size: 0.8rem;
        }
        .data-table[data-density='comfortable'] td,
        .data-table[data-density='comfortable'] th {
          padding: 1rem 1.25rem;
          font-size: 0.9375rem;
        }

        /* ── Responsive column hiding — Issue #113 ───────── */
        @media (max-width: 640px) {
          .col-hide-sm { display: none; }
        }
        @media (max-width: 480px) {
          .col-hide-xs { display: none; }
        }

        /* ── Expandable row detail — Issue #113 ──────────── */
        .row-clickable {
          cursor: pointer;
          user-select: none;
        }
        .row-clickable:hover td {
          background: var(--accent-subtle);
        }
        .row-clickable:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .row-expanded td {
          background: var(--accent-subtle);
        }
        .row-detail td {
          padding: 0.75rem 1rem;
          background: var(--bg-subtle, var(--bg));
          border-top: 1px solid var(--border);
          border-bottom: 2px solid var(--accent-subtle);
        }
        .row-detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 0.75rem 1.5rem;
        }
        .row-detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .row-detail-label {
          font-size: 0.68rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
        }
        .row-detail-value {
          font-size: 0.875rem;
          color: var(--text);
        }
      `}</style>

      {/* Accessibility live regions */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {summaryRetry.retryState.loading || studentsRetry.retryState.loading ? t("dashboard.loadingAria") : t("dashboard.loadedAria")}
      </div>
      {(summaryRetry.retryState.error || studentsRetry.retryState.error) && (
        <div aria-live="assertive" aria-atomic="true" className="sr-only">
          {summaryRetry.retryState.error || studentsRetry.retryState.error}
        </div>
      )}

      <div className="page-wrap dash-wrap">

        {/* ── Centered Hero Header ──────────────────── */}
        <PageHero
          eyebrow={t("dashboard.eyebrow")}
          title={t("dashboard.title")}
          subtitle={t("dashboard.subtitle")}
        >
          <SyncButton onSyncComplete={handleSyncComplete} lastSyncTime={lastSyncAt} />
          <span style={{ alignSelf: "center", fontSize: "0.82rem", color: "rgba(255,255,255,0.85)" }}>
            {t("actions.lastSync")} <strong style={{ color: "#fff" }}>{timeAgo(lastSyncAt)}</strong>
          </span>
        </PageHero>

        {/* ── Alerts ────────────────────────────────── */}
        {syncMsg && (
          <div role="status" className="alert alert-success" style={{ marginBottom: "1.25rem" }}>
            <IconCheck size={16} />
            <span>{syncMsg}</span>
          </div>
        )}
        {error && (
          <div role="alert" className="alert alert-danger" style={{ marginBottom: "1.25rem" }}>
            <IconAlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Stat Cards ────────────────────────────── */}
        <ErrorBoundary>
          {summaryRetry.retryState.error ? (
            <ErrorAlert
              retryState={summaryRetry.retryState}
              onRetry={summaryRetry.execute}
              loading={summaryRetry.retryState.loading}
              style={{ marginBottom: "1.5rem" }}
            />
          ) : (
            <div className="stat-grid" style={{ marginBottom: "1.75rem" }}>
              {summaryRetry.retryState.loading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="stat-card" aria-hidden="true">
                      <div className="skel-block" style={{ width: 42, height: 42, borderRadius: 12, marginBottom: 16 }} />
                      <div className="skel-block" style={{ width: "60%", height: 10, marginBottom: 12 }} />
                      <div className="skel-block" style={{ width: "45%", height: 30 }} />
                    </div>
                  ))
                : stats.map((s) => <StatCard key={s.label} {...s} />)
              }
            </div>
          )}
        </ErrorBoundary>

        {/* ── Student Table ─────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">{t("dashboard.studentsTitle")}</div>
              {!studentsRetry.retryState.loading && total > 0 && (
                <div className="card-subtitle">{t("dashboard.studentsTotal", { count: total })}</div>
              )}
            </div>

            {/* Toolbar */}
            <div className="toolbar" role="search" aria-label={t("dashboard.filterStudentsAria")} style={{ margin: 0 }}>
              <div className="dash-search">
                <span className="dash-search-icon"><IconSearch size={14} /></span>
                <input
                  type="search"
                  placeholder={t("dashboard.searchPlaceholder")}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  aria-label={t("dashboard.searchAria")}
                  style={{
                    padding: "0.4rem 0.7rem",
                    paddingLeft: "2.125rem",
                    border: "1.5px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.8125rem",
                    fontFamily: "inherit",
                    color: "var(--text)",
                    background: "var(--card-bg)",
                    outline: "none",
                    width: 180,
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "var(--accent)"; e.target.style.boxShadow = "0 0 0 3px var(--accent-subtle)"; }}
                  onBlur={e  => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                aria-label={t("dashboard.filterByStatusAria")}
                style={{
                  padding: "0.4rem 0.7rem",
                  border: "1.5px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8125rem",
                  fontFamily: "inherit",
                  color: "var(--text)",
                  background: "var(--card-bg)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="all">{t("dashboard.allStatus")}</option>
                <option value="paid">{t("status.student.paid")}</option>
                <option value="partial">{t("status.student.partial")}</option>
                <option value="unpaid">{t("status.student.unpaid")}</option>
              </select>
              <select
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
                aria-label={t("dashboard.filterByClassAria")}
                style={{
                  padding: "0.4rem 0.7rem",
                  border: "1.5px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8125rem",
                  fontFamily: "inherit",
                  color: "var(--text)",
                  background: "var(--card-bg)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">{t("dashboard.allClasses")}</option>
                {classOptions.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {/* Density toggle — Issue #113 */}
              <TableDensityControl density={density} setDensity={setDensity} />
            </div>
          </div>

          {/* Table */}
          <ErrorBoundary>
            {studentsRetry.retryState.error ? (
              <div className="card-body">
                <ErrorAlert
                  retryState={studentsRetry.retryState}
                  onRetry={studentsRetry.execute}
                  loading={studentsRetry.retryState.loading}
                />
              </div>
            ) : (
              <div style={{ overflowX: "auto" }} aria-busy={studentsRetry.retryState.loading} aria-label={t("dashboard.studentTableAria")}>
                <table
                  className="data-table"
                  data-density={density}
                  aria-label={studentsRetry.retryState.loading ? t("dashboard.studentsLoadingAria") : t("dashboard.studentTableAria")}
                >
                  <thead>
                    <tr>
                      <th scope="col">{t("dashboard.colStudentId")}</th>
                      <th scope="col">{t("dashboard.colName")}</th>
                      <th scope="col" className="col-hide-sm">{t("dashboard.colClass")}</th>
                      <th scope="col" className="col-hide-sm">{t("dashboard.colFee")}</th>
                      <th scope="col" className="col-hide-xs">{t("dashboard.colStatus")}</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentsRetry.retryState.loading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i}>
                          <td><div className="skel-block" style={{ height: 12, width: 72 }} /></td>
                          <td><div className="skel-block" style={{ height: 12, width: 130 }} /></td>
                          <td className="col-hide-sm"><div className="skel-block" style={{ height: 12, width: 44 }} /></td>
                          <td className="col-hide-sm"><div className="skel-block" style={{ height: 12, width: 56 }} /></td>
                          <td className="col-hide-xs"><div className="skel-block" style={{ height: 20, width: 52, borderRadius: 20 }} /></td>
                          <td><div className="skel-block" style={{ height: 28, width: 42, borderRadius: 6 }} /></td>
                        </tr>
                      ))
                    ) : students.length === 0 ? (
                      <tr>
                        <td colSpan="6">
                          <div className="empty-state">
                            <div className="empty-state-icon"><IconSearch size={26} /></div>
                            <div className="empty-state-title">{t("dashboard.emptyTitle")}</div>
                            <div className="empty-state-desc">
                              {search || statusFilter !== "all" || classFilter ? t("dashboard.emptyFilters") : t("dashboard.emptyNone")}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : students.map(s => {
                      const st = (s.status || "unpaid").toLowerCase();
                      const badge = STATUS_BADGE[st] || STATUS_BADGE.unpaid;
                      const isExpanded = expandedRows.has(s.studentId);
                      return (
                        <>
                          <tr
                            key={s.studentId}
                            className={`row-clickable${isExpanded ? " row-expanded" : ""}`}
                            onClick={() => handleRowClick(s.studentId)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? t("dashboard.collapseRow") : t("dashboard.expandRow")}
                            tabIndex={0}
                            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(s.studentId); } }}
                          >
                            <td className="col-mono">{s.studentId}</td>
                            <td className="student-row-name">{s.name}</td>
                            <td className="student-row-class col-hide-sm">{s.class}</td>
                            <td className="student-row-fee col-hide-sm">
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.feeAmount}</span>
                              <span style={{ marginLeft: "0.25rem", fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>XLM</span>
                            </td>
                            <td className="col-hide-xs">
                              <span className={badge.cls}>{badge.label}</span>
                            </td>
                            <td>
                              <button
                                onClick={e => { e.stopPropagation(); handleEditStudent(s); }}
                                className="btn btn-sm btn-ghost"
                              >
                                {t("actions.edit")}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${s.studentId}-detail`} className="row-detail">
                              <td colSpan="6">
                                <div className="row-detail-grid" aria-label={t("dashboard.expandedDetails")}>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colStudentId")}</span>
                                    <span className="row-detail-value col-mono">{s.studentId}</span>
                                  </div>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colName")}</span>
                                    <span className="row-detail-value">{s.name}</span>
                                  </div>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colClass")}</span>
                                    <span className="row-detail-value">{s.class}</span>
                                  </div>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colFee")}</span>
                                    <span className="row-detail-value">{s.feeAmount} XLM</span>
                                  </div>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colStatus")}</span>
                                    <span className="row-detail-value">
                                      <span className={badge.cls}>{badge.label}</span>
                                    </span>
                                  </div>
                                  {s.parentEmail && (
                                    <div className="row-detail-item">
                                      <span className="row-detail-label">{t("studentForm.parentEmail")}</span>
                                      <span className="row-detail-value">{s.parentEmail}</span>
                                    </div>
                                  )}
                                  {s.parentPhone && (
                                    <div className="row-detail-item">
                                      <span className="row-detail-label">{t("studentForm.parentPhone")}</span>
                                      <span className="row-detail-value">{s.parentPhone}</span>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ErrorBoundary>

          {/* Pagination */}
          {total > 0 && (
            <div style={{ padding: "0.875rem 1.25rem", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
              <span className="pagination-info" aria-live="polite" aria-atomic="true">
                {studentsRetry.retryState.loading ? t("actions.loading") : t("dashboard.rangeOf", { start: rangeStart, end: rangeEnd, total: total.toLocaleString() })}
              </span>
              <nav className="pagination-controls" aria-label={t("dashboard.paginationAria")}>
                <button
                  className="page-btn"
                  disabled={page === 1 || studentsRetry.retryState.loading}
                  onClick={() => setPage(p => p - 1)}
                  aria-label={t("actions.previousPage")}
                  style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
                >
                  <IconChevronLeft size={15} /> {t("actions.prev")}
                </button>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", padding: "0 0.25rem" }} aria-current="page">
                  {page} / {pages}
                </span>
                <button
                  className="page-btn"
                  disabled={page === pages || studentsRetry.retryState.loading}
                  onClick={() => setPage(p => p + 1)}
                  aria-label={t("actions.nextPage")}
                  style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}
                >
                  {t("actions.next")} <IconChevronRight size={15} />
                </button>
              </nav>
            </div>
          )}
        </div>
      </div>

      {editingStudentData && (
        <StudentForm
          student={editingStudentData}
          onClose={handleCloseForm}
          onSave={handleSaveStudent}
        />
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <RequireAdmin>
      <Dashboard />
    </RequireAdmin>
  );
}
