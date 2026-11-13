'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Database, FileQuestion, LoaderCircle, X } from 'lucide-react';
import { date, label, title, type Row } from '../lib/api';
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function tone(value: unknown) {
  const text = String(value || '').toLowerCase();
  return ['critical', 'failed', 'rejected', 'blocked', 'error'].some((s) => text.includes(s))
    ? 'red'
    : ['high', 'queued', 'pending', 'unknown', 'review', 'exposure', 'potential'].some((s) =>
        text.includes(s),
      )
      ? 'amber'
      : ['succeeded', 'approved', 'active', 'protected', 'ready', 'resolved', 'no modeled path', 'mitigated'].some((s) =>
            text.includes(s),
          )
        ? 'green'
        : text === 'medium'
          ? 'blue'
          : 'muted';
}
export function Status({ value }: { value: unknown }) {
  return <Badge tone={tone(value)}>{label(value)}</Badge>;
}
export function Header({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </header>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  action,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function Notice({ children, tone = 'blue' }: { children: ReactNode; tone?: string }) {
  return (
    <div className={`notice ${tone}`}>
      <AlertCircle size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <FileQuestion size={31} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Loading({ text = 'Loading workspace records…' }: { text?: string }) {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={25} />
      <span>{text}</span>
    </div>
  );
}
export function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
export function RecordTable({
  items,
  columns,
  onOpen,
  empty = 'No records yet',
}: {
  items: Row[];
  columns: { key: string; label: string; render?: (row: Row) => ReactNode }[];
  onOpen?: (row: Row) => void;
  empty?: string;
}) {
  if (!items.length)
    return (
      <Empty
        title={empty}
        description="Records will appear here when the corresponding workspace action completes."
      />
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            {onOpen && (
              <th>
                <span className="sr-only">Details</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              {columns.map((c, i) => (
                <td key={c.key}>
                  {c.render ? (
                    c.render(row)
                  ) : i === 0 && onOpen ? (
                    <button className="record-name" onClick={() => onOpen(row)}>
                      {row[c.key] ?? title(row)}
                      <small>{row.id}</small>
                    </button>
                  ) : [
                      'status',
                      'severity',
                      'role',
                      'criticality',
                      'exposure',
                      'license_status',
                      'task',
                    ].includes(c.key) ? (
                    <Status value={row[c.key]} />
                  ) : c.key.endsWith('_at') ? (
                    date(row[c.key])
                  ) : typeof row[c.key] === 'object' ? (
                    JSON.stringify(row[c.key])
                  ) : (
                    label(row[c.key])
                  )}
                </td>
              ))}
              {onOpen && (
                <td>
                  <button
                    aria-label={`Open ${title(row)}`}
                    className="icon-button"
                    onClick={() => onOpen(row)}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Drawer({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
      );
      if (!elements?.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0],
        last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <p className="eyebrow">WORKSPACE RECORD</p>
            <h2>{title}</h2>
            {subtitle && <small>{subtitle}</small>}
          </div>
          <button className="icon-button" aria-label="Close details" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Details({ record, omit = [] }: { record: Row; omit?: string[] }) {
  return (
    <dl className="details-list">
      {Object.entries(record)
        .filter(([key, value]) => !omit.includes(key) && value !== null && value !== undefined)
        .map(([key, value]) => (
          <div key={key}>
            <dt>{label(key)}</dt>
            <dd>
              {typeof value === 'object' ? (
                <pre>{JSON.stringify(value, null, 2)}</pre>
              ) : key.endsWith('_at') ? (
                date(value)
              ) : (
                String(value)
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function ServiceLabel() {
  return (
    <span className="service-label">
      <Database size={13} />
      <span className="status-dot" />
      PostgreSQL records
    </span>
  );
}
