'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  Network,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { request } from '../lib/api';
import { Badge, Field, Loading, Notice } from './UI';

type Availability = { enabled: boolean; setup_required: boolean; reason: string };
export default function Register() {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmation: '',
    workspace_name: '',
    scope: '',
    setup_token: '',
  });
  async function load() {
    setLoading(true);
    setError('');
    try {
      setAvailability(await request('/auth/registration-status'));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    document.title = 'Create account · AEGIS';
    void load();
  }, []);
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirmation) {
      setError('The password and confirmation must match.');
      return;
    }
    if (!availability?.enabled && !availability?.setup_required) {
      setError('Registration is disabled by this installation.');
      return;
    }
    setBusy(true);
    try {
      const { confirmation, setup_token, ...body } = form;
      void confirmation;
      await request(availability.setup_required ? '/auth/setup' : '/auth/register', {
        method: 'POST',
        body,
        setupToken: availability.setup_required ? setup_token : undefined,
      });
      window.location.assign('/');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <Link href="/" className="brand" aria-label="AEGIS home">
          <span className="brand-mark">
            <Shield size={33} />
            <b>A</b>
          </span>
          <div>
            <strong>AEGIS</strong>
            <small>SECURITY INTELLIGENCE</small>
          </div>
        </Link>
        <div>
          <Badge tone="green">YOUR WORKSPACE. YOUR CONTROL.</Badge>
          <h1>
            A considered start
            <br />
            to stronger defense.
          </h1>
          <p>
            Create a local account and a private workspace. Connect evidence, understand modeled
            risks, and keep human oversight at every decision.
          </p>
          <div className="auth-capabilities">
            <span>
              <Network />
              One connected security workspace
            </span>
            <span>
              <ShieldCheck />
              Access enforced by the backend
            </span>
            <span>
              <LockKeyhole />
              Your own password. No shared login.
            </span>
          </div>
        </div>
        <small>LOCAL PRODUCT / NO PRODUCTION SECURITY CLAIMS</small>
      </aside>
      <div className="auth-form-wrap">
        <div className="auth-form">
          <span className="auth-icon">
            <Fingerprint size={26} />
          </span>
          <p className="eyebrow">CREATE YOUR AEGIS ACCOUNT</p>
          <h2>
            {availability?.setup_required ? 'Initialize your first workspace' : 'Create an account'}
          </h2>
          <p>
            {availability?.setup_required
              ? 'This installation has no owner yet. Use the private setup token to initialize it securely.'
              : 'Registration creates a new private workspace. An existing workspace requires a separate invitation or administrator-granted membership.'}
          </p>
          {loading ? (
            <Loading text="Checking registration availability…" />
          ) : availability && (availability.enabled || availability.setup_required) ? (
            <form className="stack" onSubmit={submit}>
              {availability.setup_required && (
                <Field
                  label="Private setup token"
                  help="Read SETUP_TOKEN from your local full-product/.env, or use the documented owner bootstrap command."
                >
                  <input
                    type="password"
                    value={form.setup_token}
                    onChange={(e) => update('setup_token', e.target.value)}
                    required
                    autoComplete="off"
                  />
                </Field>
              )}
              <Field label="Your name">
                <input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  minLength={2}
                  maxLength={80}
                  required
                  autoComplete="name"
                />
              </Field>
              <Field label="Email address">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  maxLength={254}
                  required
                  autoComplete="username"
                />
              </Field>
              <div className="form-grid">
                <Field label="Password" help="At least 12 characters.">
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => update('password', e.target.value)}
                    minLength={12}
                    maxLength={256}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirm password">
                  <input
                    type="password"
                    value={form.confirmation}
                    onChange={(e) => update('confirmation', e.target.value)}
                    minLength={12}
                    maxLength={256}
                    required
                    autoComplete="new-password"
                  />
                </Field>
              </div>
              <Field label="Private workspace name">
                <input
                  value={form.workspace_name}
                  onChange={(e) => update('workspace_name', e.target.value)}
                  minLength={2}
                  maxLength={80}
                  required
                  placeholder="Your security workspace"
                />
              </Field>
              <Field label="Authorized demo scope">
                <textarea
                  value={form.scope}
                  onChange={(e) => update('scope', e.target.value)}
                  minLength={10}
                  maxLength={2000}
                  rows={3}
                  required
                  placeholder="Describe the synthetic or authorized infrastructure represented here. No scans will be performed."
                />
              </Field>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary full" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{' '}
                {busy
                  ? 'Creating your workspace…'
                  : availability.setup_required
                    ? 'Create first owner & workspace'
                    : 'Create account & private workspace'}
              </button>
            </form>
          ) : (
            <>
              <Notice>
                {availability?.reason || error || 'Registration is currently unavailable.'}
              </Notice>
              {!availability && (
                <button className="button secondary" onClick={() => void load()}>
                  Try again
                </button>
              )}
            </>
          )}
          <p className="section-note" style={{ textAlign: 'center', marginTop: 20 }}>
            Already have an account?{' '}
            <Link className="text-link" href="/">
              Sign in
            </Link>
          </p>
          <div className="auth-security">
            <LockKeyhole size={13} />
            <span>Argon2 passwords · HttpOnly sessions · Workspace isolation</span>
          </div>
        </div>
      </div>
    </div>
  );
}
