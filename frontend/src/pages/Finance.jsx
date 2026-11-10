import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, fmtDate, fmtMoney, fmtRate } from '../api';
import { DrillPanel, Loading, Stat, StatusPill, Table, useApi, useDrill } from '../components/ui';

const today = () => new Date().toLocaleDateString('en-CA');
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const endOfMonth = (d) => { const x = new Date(`${d}T00:00:00`); return new Date(x.getFullYear(), x.getMonth() + 1, 0).toLocaleDateString('en-CA'); };
const CYCLE = { WEEKLY: 'Weekly', BIWEEKLY: 'Every 2 weeks', SEMIMONTHLY: 'Twice a month', MONTHLY: 'Monthly' };
const AGING = [['current', 'Not yet due'], ['d1_30', '1–30 days late'], ['d31_60', '31–60 days late'], ['d61_90', '61–90 days late'], ['d90_plus', '90+ days late']];

/** Billing status of an active assignment */
function InvoicingStatus({ b }) {
  if (!b.has_rate) return <span className="pill warning">No bill rate</span>;
  if (b.ended) return <span className="pill critical">Ended {fmtDate(b.end_date)} · final invoice due</span>;
  if (b.invoicing_behind) {
    return <span className="pill critical">{b.last_invoiced_through ? `Not invoiced after ${fmtDate(b.last_invoiced_through)}` : 'Never invoiced'}</span>;
  }
  return <span className="pill ok">Up to date</span>;
}

/** HR: create an invoice for an assignment */
function NewInvoice({ billable, preset, onDone, onCancel }) {
  const withRate = billable.filter((b) => b.has_rate);
  const pickDefaults = (workId) => {
    const b = withRate.find((x) => String(x.work_id) === String(workId));
    if (!b) return {};
    const start = b.last_invoiced_through ? addDays(b.last_invoiced_through, 1) : b.start_date;
    const monthEnd = endOfMonth(start);
    return {
      work_id: String(b.work_id), period_start: start, period_end: b.end_date && b.end_date < monthEnd ? b.end_date : monthEnd,
      rate: (b.bill_rate_cents / 100).toFixed(2), rate_unit: b.rate_unit, payment_terms_days: String(b.payment_terms_days),
    };
  };
  const [f, setF] = useState({
    work_id: '', invoice_number: '', period_start: '', period_end: '', quantity: '', rate: '', rate_unit: 'HOUR',
    invoice_date: today(), payment_terms_days: '30', notes: '', ...pickDefaults(preset),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [ts, setTs] = useState(null); // approved / pending timesheet hours in the period
  const autoQty = useRef(true); // keep filling hours from timesheets until HR types their own
  const ref = useRef(null);

  // Approved timesheet hours for the chosen assignment and period
  useEffect(() => {
    setTs(null);
    if (!f.work_id || !f.period_start || !f.period_end || f.period_end < f.period_start) return undefined;
    let live = true;
    api(`/timesheets/hours?work_id=${f.work_id}&from=${f.period_start}&to=${f.period_end}`)
      .then((rows) => {
        if (!live) return;
        const r = rows[0] || { approved_hours: 0, pending_hours: 0, unsubmitted_hours: 0 };
        setTs(r);
        if (autoQty.current && f.rate_unit === 'HOUR') setF((x) => ({ ...x, quantity: r.approved_hours ? String(r.approved_hours) : '' }));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [f.work_id, f.period_start, f.period_end, f.rate_unit]);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    api('/finance/next-invoice-number').then((r) => setF((x) => ({ ...x, invoice_number: x.invoice_number || r.invoice_number }))).catch(() => {});
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const amount = Math.round((Number(f.quantity) || 0) * Math.round((Number(f.rate) || 0) * 100));
  const due = f.invoice_date ? addDays(f.invoice_date, Number(f.payment_terms_days) || 0) : '';
  const unitWord = { HOUR: 'Hours', DAY: 'Days', MONTH: 'Months' }[f.rate_unit] || 'Hours';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api('/finance/invoices', { method: 'POST', body: { ...f, work_id: Number(f.work_id) } });
      onDone(`Invoice ${f.invoice_number} created for ${fmtMoney(amount)}.`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <section className="card drill" ref={ref}>
      <div className="page-head"><h3>New invoice</h3><button className="link" onClick={onCancel}>Cancel</button></div>
      <form className="form-grid" onSubmit={submit}>
        <div className="field wide"><label htmlFor="inv-work">Consultant / assignment *</label>
          <select id="inv-work" value={f.work_id} onChange={(e) => setF({ ...f, ...pickDefaults(e.target.value), work_id: e.target.value })} required>
            <option value="">Choose…</option>
            {withRate.map((b) => (
              <option key={b.work_id} value={b.work_id}>{b.employee_name} · {b.client_name || '—'} · bill to {b.bill_to} · {fmtRate(b.bill_rate_cents, b.rate_unit)}{b.ended ? ` · ended ${fmtDate(b.end_date)}` : ''}</option>
            ))}
          </select>
          {billable.some((b) => !b.has_rate) && <p className="hint">Consultants without a bill rate aren&apos;t listed. Set their rate on the employee page.</p>}
        </div>
        <div className="field"><label htmlFor="inv-no">Invoice number *</label><input id="inv-no" value={f.invoice_number} onChange={set('invoice_number')} required /></div>
        <div className="field"><label htmlFor="inv-from">Period from *</label><input id="inv-from" type="date" value={f.period_start} onChange={set('period_start')} required /></div>
        <div className="field"><label htmlFor="inv-to">Period to *</label><input id="inv-to" type="date" value={f.period_end} onChange={set('period_end')} required /></div>
        <div className="field"><label htmlFor="inv-qty">{unitWord} *</label>
          <input id="inv-qty" type="number" min="0.25" step="0.25" value={f.quantity} required
            onChange={(e) => { autoQty.current = false; setF({ ...f, quantity: e.target.value }); }} />
          {ts && f.rate_unit === 'HOUR' && (
            <p className="hint">
              Approved timesheets: <strong>{ts.approved_hours} h</strong>
              {!autoQty.current && Number(f.quantity) !== ts.approved_hours && (
                <> · <button type="button" className="link" onClick={() => { autoQty.current = true; setF({ ...f, quantity: String(ts.approved_hours || '') }); }}>use approved hours</button></>
              )}
            </p>
          )}
        </div>
        <div className="field"><label htmlFor="inv-rate">Rate ($) *</label><input id="inv-rate" type="number" min="0.01" step="0.01" value={f.rate} onChange={set('rate')} required /></div>
        <div className="field"><label htmlFor="inv-date">Invoice date</label><input id="inv-date" type="date" value={f.invoice_date} onChange={set('invoice_date')} /></div>
        <div className="field"><label htmlFor="inv-terms">Payment terms (days)</label><input id="inv-terms" type="number" min="0" max="180" value={f.payment_terms_days} onChange={set('payment_terms_days')} />
          <p className="hint">Due {due ? fmtDate(due) : '—'}</p></div>
        <div className="field"><label>Amount</label><div className="money-big">{fmtMoney(amount)}</div></div>
        <div className="field wide"><label htmlFor="inv-notes">Notes</label><input id="inv-notes" value={f.notes} onChange={set('notes')} placeholder="PO number, timesheet reference…" /></div>
        {ts && f.rate_unit === 'HOUR' && (ts.pending_hours > 0 || ts.unsubmitted_hours > 0 || ts.weeks_missing_client_copy > 0 || Number(f.quantity) !== ts.approved_hours) && (
          <div className="error-box wide">
            {ts.pending_hours > 0 && <div>{ts.pending_hours} h in this period are still waiting for approval on the Timesheets page.</div>}
            {ts.unsubmitted_hours > 0 && <div>{ts.unsubmitted_hours} h are in draft or sent-back timesheets that the employee hasn&apos;t submitted.</div>}
            {ts.weeks_missing_client_copy > 0 && <div>{ts.weeks_missing_client_copy} week(s) in this period have no client-approved timesheet attached, which this vendor requires.</div>}
            {Number(f.quantity) !== ts.approved_hours && <div>You are billing {Number(f.quantity) || 0} h, but approved timesheets show {ts.approved_hours} h for this period.</div>}
          </div>
        )}
        {error && <p className="error wide">{error}</p>}
        <div className="actions wide"><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create invoice'}</button></div>
      </form>
    </section>
  );
}

/** HR: record money received against an invoice */
function RecordPayment({ inv, onDone, onCancel }) {
  const [f, setF] = useState({ amount: (inv.balance_cents / 100).toFixed(2), paid_on: today(), reference: '' });
  const [error, setError] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/finance/invoices/${inv.invoice_id}/payments`, { method: 'POST', body: f });
      onDone(`Payment of ${fmtMoney(Math.round(Number(f.amount) * 100))} recorded on ${inv.invoice_number}.`);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <section className="card drill" ref={ref}>
      <div className="page-head">
        <h3>Record payment · {inv.invoice_number} <span className="muted">· {inv.bill_to} · balance {fmtMoney(inv.balance_cents)}</span></h3>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="pay-amt">Amount received ($) *</label><input id="pay-amt" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></div>
        <div className="field"><label htmlFor="pay-date">Received on</label><input id="pay-date" type="date" max={today()} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></div>
        <div className="field"><label htmlFor="pay-ref">Reference</label><input id="pay-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="ACH / cheque / wire #" /></div>
        {error && <p className="error wide">{error}</p>}
        <div className="actions wide"><button type="submit">Save payment</button></div>
      </form>
    </section>
  );
}

// HR / CEO: who we bill, at what rate, what is owed, and what is late
export default function Finance() {
  const { user } = useAuth();
  const canEdit = ['HR', 'ADMIN'].includes(user.role);
  const summary = useApi('/finance/summary');
  const billable = useApi('/finance/billable');
  const invoices = useApi('/finance/invoices');
  const drill = useDrill();
  const [panel, setPanel] = useState(null); // { type: 'invoice', workId? } | { type: 'payment', inv }
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState('UNPAID');
  const [party, setParty] = useState('');
  const [search, setSearch] = useState('');
  const listRef = useRef(null);

  const reloadAll = (msg) => {
    setPanel(null);
    if (msg) setMessage(msg);
    summary.reload(); billable.reload(); invoices.reload();
  };
  const voidInvoice = async (inv) => {
    if (!window.confirm(`Void ${inv.invoice_number} for ${fmtMoney(inv.amount_cents)}? It stays on record but no longer counts toward balances.`)) return;
    try {
      await api(`/finance/invoices/${inv.invoice_id}/void`, { method: 'PATCH' });
      reloadAll(`${inv.invoice_number} voided.`);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const yearStart = `${today().slice(0, 4)}-01-01`;
  const inv = invoices.data || [];
  const filtered = useMemo(() => inv.filter((i) => {
    if (statusFilter === 'UNPAID' && !['OPEN', 'PARTIAL', 'OVERDUE'].includes(i.status)) return false;
    if (!['UNPAID', 'ALL'].includes(statusFilter) && i.status !== statusFilter) return false;
    if (party && `${i.bill_to_type}:${i.vendor_id || i.client_id}` !== party) return false;
    const q = search.trim().toLowerCase();
    return !q || [i.invoice_number, i.employee_name, i.bill_to, i.client_name].some((v) => String(v || '').toLowerCase().includes(q));
  }), [inv, statusFilter, party, search]);

  if (!summary.data) return <Loading {...summary} />;
  const s = summary.data;
  const b = billable.data || [];

  const INVOICE_COLUMNS = [
    { key: 'invoice_number', label: 'Invoice' },
    { key: 'employee_name', label: 'Consultant', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
    { key: 'bill_to', label: 'Bill to', render: (r) => <>{r.bill_to}{r.vendor_id && r.client_name ? <div className="muted small">for {r.client_name}</div> : null}</> },
    { key: 'period', label: 'Period', render: (r) => `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}` },
    { key: 'qty', label: 'Qty × rate', render: (r) => `${r.quantity} × ${fmtRate(r.rate_cents, r.rate_unit)}` },
    { key: 'amount_cents', label: 'Amount', render: (r) => <span className="num">{fmtMoney(r.amount_cents)}</span> },
    { key: 'paid_cents', label: 'Received', render: (r) => <span className="num">{fmtMoney(r.paid_cents)}</span> },
    { key: 'balance_cents', label: 'Balance', render: (r) => <span className="num strong">{fmtMoney(r.balance_cents)}</span> },
    { key: 'due_date', label: 'Due', render: (r) => <>{fmtDate(r.due_date)}{r.days_overdue > 0 ? <div className="error small">{r.days_overdue} days late</div> : null}</> },
    { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
    ...(canEdit ? [{ key: 'x', label: '', render: (r) => (
      <div className="row-actions">
        {r.balance_cents > 0 && <button className="link" onClick={() => setPanel({ type: 'payment', inv: r })}>Record payment</button>}
        {!r.is_void && r.paid_cents === 0 && <button className="link danger" onClick={() => voidInvoice(r)}>Void</button>}
      </div>) }] : []),
  ];
  const BILLABLE_COLUMNS = [
    { key: 'employee_name', label: 'Consultant', render: (r) => <Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> },
    { key: 'client_name', label: 'Client', render: (r) => <>{r.client_name || '—'}{r.project_name ? <div className="muted small">{r.project_name}{r.ended ? ' · ended' : ''}</div> : null}</> },
    { key: 'vendor_name', label: 'Vendor', render: (r) => r.vendor_name || <span className="muted">Direct</span> },
    { key: 'rate', label: 'Bill rate', render: (r) => (r.has_rate ? <span className="num strong">{fmtRate(r.bill_rate_cents, r.rate_unit)}</span> : '—') },
    { key: 'terms', label: 'Terms', render: (r) => (r.has_rate ? `Net ${r.payment_terms_days} · ${CYCLE[r.invoice_cycle]}` : '—') },
    { key: 'last_invoiced_through', label: 'Invoiced through', render: (r) => fmtDate(r.last_invoiced_through) },
    { key: 'hours', label: 'Timesheet hours to bill', render: (r) => (
      <>{r.approved_uninvoiced_hours ? <span className="num strong">{r.approved_uninvoiced_hours} h approved</span> : <span className="muted">—</span>}
        {r.pending_hours ? <div className="small"><Link to="/timesheet-review">{r.pending_hours} h awaiting approval</Link></div> : null}</>) },
    { key: 'st', label: 'Invoicing', render: (r) => <InvoicingStatus b={r} /> },
    ...(canEdit ? [{ key: 'x', label: '', render: (r) => (r.has_rate
      ? <button className="link" onClick={() => setPanel({ type: 'invoice', workId: r.work_id })}>New invoice</button>
      : <Link to={`/employees/${r.employee_id}`}>Set rate</Link>) }] : []),
  ];
  const DRILLS = {
    outstanding: { title: 'Unpaid invoices', rows: inv.filter((i) => i.balance_cents > 0), columns: INVOICE_COLUMNS },
    overdue: { title: 'Overdue invoices', rows: inv.filter((i) => i.status === 'OVERDUE'), columns: INVOICE_COLUMNS },
    invoiced: { title: `Invoiced this year (since ${fmtDate(yearStart)})`, rows: inv.filter((i) => !i.is_void && i.invoice_date >= yearStart), columns: INVOICE_COLUMNS },
    received: { title: 'Invoices with payments received this year', rows: inv.filter((i) => i.paid_cents > 0 && i.last_paid_on >= yearStart), columns: INVOICE_COLUMNS },
    billable: { title: 'Billable consultants', rows: b.filter((x) => x.has_rate), columns: BILLABLE_COLUMNS },
    behind: { title: 'Consultants not invoiced on time / without a bill rate', rows: b.filter((x) => x.invoicing_behind || !x.has_rate), columns: BILLABLE_COLUMNS },
  };
  const tile = (key) => ({ onClick: () => drill.toggle(key), active: drill.is(key) });
  const showParty = (key) => {
    setParty(key);
    setStatusFilter('UNPAID');
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const maxAging = Math.max(1, ...AGING.map(([k]) => s.aging[k]));

  return (
    <>
      <div className="page-head">
        <h2>Finance</h2>
        {canEdit && <button onClick={() => setPanel({ type: 'invoice' })}>New invoice</button>}
      </div>
      {message && <p className="notice-box">{message}</p>}

      <div className="stats">
        <Stat label="Outstanding (owed to us)" value={fmtMoney(s.outstanding_cents)} {...tile('outstanding')} />
        <Stat label="Overdue" value={fmtMoney(s.overdue_cents)} tone={s.overdue_cents ? 'bad' : 'good'} {...tile('overdue')} />
        <Stat label="Invoiced this year" value={fmtMoney(s.invoiced_ytd_cents)} {...tile('invoiced')} />
        <Stat label="Received this year" value={fmtMoney(s.received_ytd_cents)} tone="good" {...tile('received')} />
        <Stat label="Billable consultants" value={s.billable_consultants} {...tile('billable')} />
        <Stat label="Not invoiced on time / no rate" value={s.invoicing_behind + s.consultants_without_rate}
          tone={s.invoicing_behind + s.consultants_without_rate ? 'warn' : 'good'} {...tile('behind')} />
      </div>
      {DRILLS[drill.open] && (
        <DrillPanel title={DRILLS[drill.open].title} rows={DRILLS[drill.open].rows} columns={DRILLS[drill.open].columns}
          empty="Nothing here." onClose={drill.close} />
      )}
      {panel?.type === 'invoice' && billable.data && (
        <NewInvoice key={panel.workId || 'new'} billable={b} preset={panel.workId} onDone={reloadAll} onCancel={() => setPanel(null)} />
      )}
      {panel?.type === 'payment' && <RecordPayment key={panel.inv.invoice_id} inv={panel.inv} onDone={reloadAll} onCancel={() => setPanel(null)} />}

      <section className="card">
        <h3>Balance by vendor / client</h3>
        <div className="aging">
          {AGING.map(([k, l]) => (
            <div key={k} className={`aging-cell aging-${k}`}>
              <div className="aging-bar"><span style={{ width: `${(s.aging[k] / maxAging) * 100}%` }} /></div>
              <div className="num strong">{fmtMoney(s.aging[k])}</div>
              <div className="muted small">{l}</div>
            </div>
          ))}
        </div>
        <Table
          rows={s.balances}
          empty="No invoices yet."
          columns={[
            { key: 'bill_to', label: 'Bill to', render: (r) => <>{r.bill_to} <span className="pill">{r.bill_to_type === 'VENDOR' ? 'Vendor' : 'Client'}</span></> },
            { key: 'employees', label: 'Consultants', render: (r) => r.employees.join(', ') },
            { key: 'invoiced_cents', label: 'Invoiced', render: (r) => <span className="num">{fmtMoney(r.invoiced_cents)}</span> },
            { key: 'paid_cents', label: 'Received', render: (r) => <span className="num">{fmtMoney(r.paid_cents)}</span> },
            { key: 'balance_cents', label: 'Balance', render: (r) => <span className="num strong">{fmtMoney(r.balance_cents)}</span> },
            { key: 'overdue_cents', label: 'Overdue', render: (r) => (r.overdue_cents ? <span className="num error">{fmtMoney(r.overdue_cents)}</span> : <span className="muted">—</span>) },
            { key: 'oldest_due', label: 'Oldest unpaid due', render: (r) => fmtDate(r.oldest_due) },
            { key: 'x', label: '', render: (r) => (r.open_invoices ? <button className="link" onClick={() => showParty(r.key)}>{r.open_invoices} unpaid invoice{r.open_invoices > 1 ? 's' : ''}</button> : <span className="muted">Paid up</span>) },
          ]}
        />
      </section>

      <section className="card">
        <h3>Consultants &amp; bill rates</h3>
        <Loading {...billable} />
        {billable.data && <Table rows={b} empty="No consultants on a project right now." columns={BILLABLE_COLUMNS} />}
      </section>

      <section className="card" ref={listRef}>
        <div className="page-head">
          <h3>Invoices <span className="muted">· {filtered.length}</span></h3>
          <div className="filters">
            <input aria-label="Search invoices" placeholder="Invoice #, consultant, vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="UNPAID">Unpaid (open, partial, overdue)</option>
              <option value="OVERDUE">Overdue</option>
              <option value="PARTIAL">Partly paid</option>
              <option value="PAID">Paid</option>
              <option value="VOID">Void</option>
              <option value="ALL">All</option>
            </select>
            <select aria-label="Bill to" value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">All vendors / clients</option>
              {s.balances.map((p) => <option key={p.key} value={p.key}>{p.bill_to}</option>)}
            </select>
          </div>
        </div>
        <Loading {...invoices} />
        {invoices.data && <Table rows={filtered} empty="No invoices match." columns={INVOICE_COLUMNS} />}
      </section>
    </>
  );
}
