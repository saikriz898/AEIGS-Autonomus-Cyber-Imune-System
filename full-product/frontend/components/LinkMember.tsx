'use client';
import { useState, type FormEvent } from 'react';
import { Users } from 'lucide-react';
import { Field, Panel } from './UI';

export default function LinkMember({
  canManage,
  canGrantOwner,
  onLink,
}: {
  canManage: boolean;
  canGrantOwner: boolean;
  onLink: (body: { email: string; role: string }) => Promise<unknown>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess(false);
    setBusy(true);
    try {
      await onLink({ email: email.trim(), role });
      setEmail('');
      setSuccess(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Link an existing account"
      subtitle="Grant workspace membership without changing the account's password"
    >
      <form className="stack" onSubmit={submit}>
        <p className="section-note">
          An account created through Register starts in its own private workspace. An Owner/Admin
          can explicitly grant it access here.
        </p>
        <div className="form-grid">
          <Field label="Existing account email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
              disabled={!canManage}
            />
          </Field>
          <Field label="Role in this workspace">
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              disabled={!canManage}
            >
              {['Viewer', 'Analyst', 'Admin', ...(canGrantOwner ? ['Owner'] : [])].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="section-note">
            Membership linked. The account's password is unchanged; no email was sent.
          </p>
        )}
        <button className="button secondary" disabled={busy || !canManage}>
          <Users size={16} />
          {busy ? 'Linking account…' : 'Grant existing account access'}
        </button>
      </form>
    </Panel>
  );
}
