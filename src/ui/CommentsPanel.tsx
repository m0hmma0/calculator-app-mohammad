import { useEffect, useMemo, useRef, useState } from 'react';
import type { Person } from '@shared/sharing';
import { selectCanComment, useBoardAccess } from '@/sharing/boardAccess';
import { mentionsIn, threadsOf, useComments } from '@/sharing/comments';
import styles from './CommentsPanel.module.css';

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A text box that suggests people after "@". Picking one inserts "@Name"; the
 * mention is recognised again from the text when the comment is posted.
 */
function Composer({
  placeholder,
  submitLabel,
  testId,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  testId: string;
  onSubmit: (body: string, mentions: string[]) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const people = useComments((state) => state.people);
  const loadPeople = useComments((state) => state.loadPeople);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  const query = /@([^\s@]*)$/.exec(body)?.[1];
  const suggestions = useMemo(() => {
    if (query === undefined) return [];
    const needle = query.toLowerCase();
    return people
      .filter(
        (person) =>
          person.email.toLowerCase().includes(needle) ||
          (person.name ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 5);
  }, [people, query]);

  const pick = (person: Person) => {
    setBody((current) => current.replace(/@[^\s@]*$/, `@${person.name ?? person.email} `));
    ref.current?.focus();
  };

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const posted = await onSubmit(body.trim(), mentionsIn(body, people));
    setBusy(false);
    if (posted) setBody('');
  };

  return (
    <div className={styles.composer}>
      <textarea
        ref={ref}
        value={body}
        rows={2}
        maxLength={2000}
        placeholder={placeholder}
        data-testid={testId}
        // It opens because the person asked to write.
        autoFocus
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
          if (event.key === 'Escape') onCancel?.();
          event.stopPropagation();
        }}
      />
      {suggestions.length > 0 ? (
        <ul className={styles.suggestions} role="listbox" aria-label="People to mention">
          {suggestions.map((person) => (
            <li key={person.email}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                data-testid="mention-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(person)}
              >
                <strong>{person.name ?? person.email}</strong>
                {person.name ? <span>{person.email}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.composerActions}>
        {onCancel ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className={styles.primary}
          disabled={!body.trim() || busy}
          data-testid={`${testId}-submit`}
          onClick={() => void submit()}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/** Comment threads, the composer for a new one, replies, and resolving. */
export function CommentsPanel({ boardId }: { boardId: string }) {
  const visible = useComments((state) => state.visible);
  const comments = useComments((state) => state.comments);
  const placing = useComments((state) => state.placing);
  const draftAt = useComments((state) => state.draftAt);
  const openThread = useComments((state) => state.openThread);
  const showResolved = useComments((state) => state.showResolved);
  const error = useComments((state) => state.error);
  const post = useComments((state) => state.post);
  const resolve = useComments((state) => state.resolve);
  const canComment = useBoardAccess(selectCanComment);

  void boardId;
  if (!visible) return null;

  const threads = threadsOf(comments);
  const shown = threads.filter((thread) => showResolved || thread.root.resolvedAt === null);
  const resolvedCount =
    threads.length - threads.filter((thread) => thread.root.resolvedAt === null).length;

  return (
    <aside className={styles.panel} aria-label="Comments" data-testid="comments-panel">
      <header className={styles.head}>
        <h2>Comments</h2>
        <button
          type="button"
          aria-label="Close comments"
          onClick={() => useComments.setState({ visible: false, placing: false, draftAt: null })}
        >
          ×
        </button>
      </header>

      {canComment ? (
        draftAt ? (
          <Composer
            placeholder="Write a comment — type @ to mention someone"
            submitLabel="Comment"
            testId="comment-input"
            onSubmit={(body, mentions) => post(body, mentions, draftAt)}
            onCancel={() => useComments.setState({ draftAt: null })}
          />
        ) : (
          <button
            type="button"
            className={styles.newThread}
            aria-pressed={placing}
            data-testid="new-comment"
            onClick={() => useComments.setState({ placing: !placing })}
          >
            {placing ? 'Click the board where it goes…' : 'New comment'}
          </button>
        )
      ) : (
        <p className={styles.muted}>You can read comments on this board but not add them.</p>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {resolvedCount > 0 ? (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showResolved}
            data-testid="show-resolved"
            onChange={(event) => useComments.setState({ showResolved: event.target.checked })}
          />
          Show {resolvedCount} resolved
        </label>
      ) : null}

      {shown.length === 0 ? (
        <p className={styles.muted}>No comments yet.</p>
      ) : (
        <ol className={styles.threads}>
          {shown.map((thread, index) => (
            <li
              key={thread.root.id}
              className={styles.thread}
              data-testid="comment-thread"
              data-resolved={thread.root.resolvedAt !== null}
              aria-current={openThread === thread.root.id ? 'true' : undefined}
            >
              <button
                type="button"
                className={styles.threadHead}
                onClick={() => useComments.setState({ openThread: thread.root.id })}
              >
                <span className={styles.number}>{index + 1}</span>
                <strong>{thread.root.authorName}</strong>
                <span className={styles.time}>{when(thread.root.createdAt)}</span>
              </button>
              <p className={styles.body}>{thread.root.body}</p>
              {thread.replies.map((reply) => (
                <div key={reply.id} className={styles.reply}>
                  <strong>{reply.authorName}</strong>
                  <p className={styles.body}>{reply.body}</p>
                </div>
              ))}
              {canComment ? (
                <div className={styles.threadActions}>
                  {openThread === thread.root.id && thread.root.resolvedAt === null ? (
                    <Composer
                      placeholder="Reply…"
                      submitLabel="Reply"
                      testId="reply-input"
                      onSubmit={(body, mentions) =>
                        post(body, mentions, { threadId: thread.root.id })
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    data-testid="resolve-thread"
                    onClick={() => void resolve(thread.root.id, thread.root.resolvedAt === null)}
                  >
                    {thread.root.resolvedAt === null ? 'Resolve' : 'Reopen'}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
