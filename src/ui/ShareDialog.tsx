import { useEffect, useState } from 'react';
import {
  EXPIRY_CHOICES,
  ROLE_LABEL,
  type Audience,
  type GrantRole,
  type ResourceType,
  type ShareState,
} from '@shared/sharing';
import { api } from '@/api/client';
import styles from './ShareDialog.module.css';

const ROLES: GrantRole[] = ['viewer', 'commenter', 'answer', 'editor'];

function untilText(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Who can open a board or folder, and how. Private until the owner says otherwise:
 * a link with a role and an audience, named people by email, and — for a board —
 * whether viewers may export, and handing the board to someone else.
 */
export function ShareDialog({
  resource,
  onClose,
  onTransferred,
}: {
  resource: { type: ResourceType; id: string; title: string };
  onClose: () => void;
  onTransferred?: () => void;
}) {
  const [state, setState] = useState<ShareState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GrantRole>('editor');
  const [domain, setDomain] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .shares(resource.type, resource.id)
      .then((next) => {
        if (!live) return;
        setState(next);
        setDomain(next.link?.domain ?? '');
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Could not load sharing'),
      );
    return () => {
      live = false;
    };
  }, [resource.type, resource.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (action: () => Promise<ShareState>) => {
    setError(null);
    try {
      setState(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That did not work');
    }
  };

  const link = state?.link ?? null;
  const url = link ? `${location.origin}/s/${link.token}` : '';

  const putLink = (
    patch: Partial<{ role: GrantRole; audience: Audience; domain: string; minutes: number | null }>,
  ) => {
    // Minutes left on the current link, so changing something else keeps its expiry.
    const remaining = link?.expiresAt
      ? Math.max(1, Math.ceil((link.expiresAt - Date.now()) / 60_000))
      : null;
    return run(() =>
      api.putLink(resource.type, resource.id, {
        role: patch.role ?? link?.role ?? 'viewer',
        audience: patch.audience ?? link?.audience ?? 'anyone',
        domain: patch.domain ?? (domain || null),
        expiresInMinutes: 'minutes' in patch ? (patch.minutes ?? null) : remaining,
      }),
    );
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        data-testid="share-dialog"
      >
        <header className={styles.head}>
          <h2 id="share-title">Share “{resource.title}”</h2>
          <button type="button" aria-label="Close" data-testid="close-share" onClick={onClose}>
            ×
          </button>
        </header>

        {error ? (
          <p className={styles.error} role="alert" data-testid="share-error">
            {error}
          </p>
        ) : null}

        {!state ? (
          <p className={styles.muted}>Loading…</p>
        ) : (
          <>
            <section className={styles.section}>
              <h3>Link</h3>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={link !== null}
                  data-testid="link-enabled"
                  onChange={(event) =>
                    event.target.checked
                      ? void putLink({ role: 'viewer', audience: 'anyone', minutes: null })
                      : void run(() => api.revokeLink(resource.type, resource.id))
                  }
                />
                {link
                  ? 'Anyone with the link can open it, as below'
                  : 'Off — only the people listed can open it'}
              </label>

              {link ? (
                <div className={styles.grid}>
                  <label>
                    <span>Who</span>
                    <select
                      value={link.audience}
                      data-testid="link-audience"
                      onChange={(event) => {
                        const audience = event.target.value as Audience;
                        if (audience === 'domain' && !domain)
                          return void putLink({ audience: 'signed-in' });
                        void putLink({ audience });
                      }}
                    >
                      <option value="anyone">Anyone with the link</option>
                      <option value="signed-in">Signed-in people only</option>
                      <option value="domain">People at a domain</option>
                    </select>
                  </label>
                  <label>
                    <span>Can</span>
                    <select
                      value={link.role}
                      data-testid="link-role"
                      onChange={(event) => void putLink({ role: event.target.value as GrantRole })}
                    >
                      {ROLES.map((option) => (
                        <option key={option} value={option}>
                          {ROLE_LABEL[option]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.wide}>
                    <span>Domain</span>
                    <span className={styles.inline}>
                      <input
                        value={domain}
                        placeholder="example.com"
                        data-testid="link-domain"
                        onChange={(event) => setDomain(event.target.value)}
                      />
                      <button
                        type="button"
                        disabled={!domain.trim()}
                        data-testid="link-domain-apply"
                        onClick={() => void putLink({ audience: 'domain', domain: domain.trim() })}
                      >
                        Use
                      </button>
                    </span>
                  </label>
                  <label className={styles.wide}>
                    <span>Expires</span>
                    <select
                      value=""
                      data-testid="link-expiry"
                      onChange={(event) => {
                        const choice = EXPIRY_CHOICES[Number(event.target.value)];
                        if (choice) void putLink({ minutes: choice.minutes });
                      }}
                    >
                      <option value="" disabled>
                        {link.expiresAt ? `On ${untilText(link.expiresAt)}` : 'Never'} — change…
                      </option>
                      {EXPIRY_CHOICES.map((choice, index) => (
                        <option key={choice.label} value={index}>
                          {choice.minutes === null ? 'Never' : `In ${choice.label}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className={`${styles.wide} ${styles.inline}`}>
                    <input readOnly value={url} data-testid="link-url" aria-label="Share link" />
                    <button
                      type="button"
                      data-testid="copy-link"
                      onClick={() => {
                        void navigator.clipboard?.writeText(url).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                      }}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      title="The old link stops working; anyone with it is dropped"
                      data-testid="reset-link"
                      onClick={() => void run(() => api.resetLink(resource.type, resource.id))}
                    >
                      New link
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className={styles.section}>
              <h3>People</h3>
              <form
                className={styles.inline}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!email.trim()) return;
                  void run(() =>
                    api.addPerson(resource.type, resource.id, email.trim(), role),
                  ).then(() => setEmail(''));
                }}
              >
                <input
                  type="email"
                  value={email}
                  placeholder="Google account email"
                  aria-label="Email to share with"
                  data-testid="person-email"
                  onChange={(event) => setEmail(event.target.value)}
                />
                <select
                  value={role}
                  aria-label="What they can do"
                  data-testid="person-role"
                  onChange={(event) => setRole(event.target.value as GrantRole)}
                >
                  {ROLES.map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABEL[option]}
                    </option>
                  ))}
                </select>
                <button type="submit" className={styles.primary} data-testid="add-person">
                  Share
                </button>
              </form>
              {state.people.length === 0 ? (
                <p className={styles.muted}>Nobody yet.</p>
              ) : (
                <ul className={styles.people}>
                  {state.people.map((person) => (
                    <li key={person.id} data-testid="person-row" data-email={person.email}>
                      <span className={styles.who}>
                        <strong>{person.name ?? person.email}</strong>
                        {person.name ? <span>{person.email}</span> : null}
                      </span>
                      <select
                        value={person.role}
                        aria-label={`What ${person.email} can do`}
                        data-testid="person-row-role"
                        onChange={(event) =>
                          void run(() =>
                            api.addPerson(
                              resource.type,
                              resource.id,
                              person.email,
                              event.target.value as GrantRole,
                            ),
                          )
                        }
                      >
                        {ROLES.map((option) => (
                          <option key={option} value={option}>
                            {ROLE_LABEL[option]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`Remove ${person.email}`}
                        data-testid="person-remove"
                        onClick={() =>
                          void run(() => api.removePerson(resource.type, resource.id, person.id))
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {resource.type === 'folder' ? (
                <p className={styles.muted}>
                  Applies to every board in this folder and its subfolders, including ones added
                  later. A board can override it in its own sharing.
                </p>
              ) : null}
            </section>

            {resource.type === 'board' && state.viewerExport !== null ? (
              <section className={styles.section}>
                <h3>Viewers</h3>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={state.viewerExport}
                    data-testid="viewer-export"
                    onChange={(event) =>
                      void run(() => api.setViewerExport(resource.id, event.target.checked))
                    }
                  />
                  People who can only view or comment may export and copy
                </label>
              </section>
            ) : null}

            {resource.type === 'board' ? (
              <section className={styles.section}>
                <h3>Owner</h3>
                <form
                  className={styles.inline}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const to = transferTo.trim();
                    if (!to) return;
                    const sure = window.confirm(
                      `Make ${to} the owner of “${resource.title}”? You will keep editing it, but they will control sharing.`,
                    );
                    if (!sure) return;
                    setError(null);
                    api
                      .transfer(resource.id, to)
                      .then(() => {
                        onTransferred?.();
                        onClose();
                      })
                      .catch((reason: unknown) =>
                        setError(reason instanceof Error ? reason.message : 'That did not work'),
                      );
                  }}
                >
                  <input
                    type="email"
                    value={transferTo}
                    placeholder="New owner's email"
                    aria-label="New owner's email"
                    data-testid="transfer-email"
                    onChange={(event) => setTransferTo(event.target.value)}
                  />
                  <button type="submit" data-testid="transfer-submit">
                    Transfer
                  </button>
                </form>
              </section>
            ) : null}

            <section className={styles.section}>
              <h3>Activity</h3>
              {state.audit.length === 0 ? (
                <p className={styles.muted}>No sharing changes yet.</p>
              ) : (
                <ol className={styles.audit} data-testid="audit-log">
                  {state.audit.map((entry, index) => (
                    <li key={`${entry.at}:${index}`}>
                      <span className={styles.time}>{untilText(entry.at)}</span>
                      <span>
                        <strong>{entry.actor}</strong> · {entry.action}: {entry.detail}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
