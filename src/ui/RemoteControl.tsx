import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { openRemote, openWatchLink, useRemote } from '@/workshop/remote';
import styles from './RemoteControl.module.css';

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

/**
 * While presenting: "Remote control", which makes a link that opens presenter view on
 * a phone or in another tab and moves the slides from there. Shown as a QR code for a
 * phone's camera, and as the link itself, to copy.
 */
export function RemoteControlButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const remote = useRemote((state) => state.url);
  return (
    <>
      <button
        type="button"
        className={compact ? styles.icon : `${styles.button} ${styles.pane}`}
        aria-label="Remote control"
        title="Control the slides from a phone or another tab"
        data-testid="remote-open"
        onMouseDown={keepFocus}
        onClick={() => {
          openRemote();
          setOpen(true);
        }}
      >
        <PhoneIcon />
        {compact ? null : <span>Remote control</span>}
      </button>
      {open ? (
        <LinkDialog
          title="Remote control"
          lead="Open this on a phone, or in another tab, to see your notes and the next slide there and move the slides from it."
          small="Anyone with this link can move the slides and read the notes until you stop presenting; then it stops working."
          url={remote}
          testPrefix="remote"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * While presenting: "Share slides", a link that shows the slides alone — the audience
 * window — on any device: a projector's computer, a TV, the class's phones. It follows
 * the presentation and cannot move it (asked for on 26 November).
 */
export function ShareSlidesButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const url = useRemote((state) => state.watchUrl);
  return (
    <>
      <button
        type="button"
        className={compact ? styles.icon : `${styles.button} ${styles.pane}`}
        aria-label="Share slides"
        title="A link that shows only the slides, on any screen"
        data-testid="watch-link-open"
        onMouseDown={keepFocus}
        onClick={() => {
          openWatchLink();
          setOpen(true);
        }}
      >
        <ScreenIcon />
        {compact ? null : <span>Share slides</span>}
      </button>
      {open ? (
        <LinkDialog
          title="Share the slides"
          lead="Open this on any screen — a projector's computer, a TV, phones — to show the slides alone, following you. Nothing there can move them."
          small="Anyone with this link sees the slides (and so the board's contents) until you stop presenting; then it stops working."
          url={url}
          testPrefix="watch-link"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function LinkDialog({
  title,
  lead,
  small,
  url,
  testPrefix,
  onClose,
}: {
  title: string;
  lead: string;
  small: string;
  url: string | null;
  testPrefix: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  return (
    <div className={styles.backdrop} data-hud onPointerDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label={title}
        data-testid={`${testPrefix}-dialog`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className={styles.heading}>{title}</h2>
        <p className={styles.lead}>{lead}</p>
        <QrCode text={url} testId={`${testPrefix}-qr`} />
        <div className={styles.linkRow}>
          <input
            className={styles.link}
            readOnly
            value={url}
            aria-label={`${title} link`}
            data-testid={`${testPrefix}-link`}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className={styles.copy}
            data-testid={`${testPrefix}-copy`}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(url)
                .then(() => setCopied(true))
                .catch(() => {});
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className={styles.small}>{small}</p>
        <button
          type="button"
          className={styles.done}
          data-testid={`${testPrefix}-done`}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** The link as a QR code, drawn as squares in an SVG (no markup from a string). */
function QrCode({ text, testId }: { text: string; testId: string }) {
  const cells = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    const dark: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (code.isDark(row, col)) dark.push(`M${col} ${row}h1v1h-1z`);
      }
    }
    return { count, path: dark.join('') };
  }, [text]);
  return (
    <svg
      className={styles.qr}
      viewBox={`-2 -2 ${cells.count + 4} ${cells.count + 4}`}
      role="img"
      aria-label="QR code for the remote control link"
      data-testid={testId}
      shapeRendering="crispEdges"
    >
      <rect x="-2" y="-2" width={cells.count + 4} height={cells.count + 4} fill="#fff" />
      <path d={cells.path} fill="#000" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect
        x="7"
        y="2.5"
        width="10"
        height="19"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ScreenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect
        x="3"
        y="4.5"
        width="18"
        height="12"
        rx="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
