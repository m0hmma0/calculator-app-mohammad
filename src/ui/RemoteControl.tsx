import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { openRemote, useRemote } from '@/workshop/remote';
import styles from './RemoteControl.module.css';

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

/**
 * While presenting: "Remote control", which makes a link that opens presenter view on
 * a phone or in another tab and moves the slides from there. Shown as a QR code for a
 * phone's camera, and as the link itself, to copy.
 */
export function RemoteControlButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
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
      {open ? <RemoteDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RemoteDialog({ onClose }: { onClose: () => void }) {
  const url = useRemote((state) => state.url);
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  return (
    <div className={styles.backdrop} data-hud onPointerDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Remote control"
        data-testid="remote-dialog"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className={styles.heading}>Remote control</h2>
        <p className={styles.lead}>
          Open this on a phone, or in another tab, to see your notes and the next slide there and
          move the slides from it.
        </p>
        <QrCode text={url} />
        <div className={styles.linkRow}>
          <input
            className={styles.link}
            readOnly
            value={url}
            aria-label="Remote control link"
            data-testid="remote-link"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className={styles.copy}
            data-testid="remote-copy"
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
        <p className={styles.small}>
          Anyone with this link can move the slides and read the notes until you stop presenting;
          then it stops working.
        </p>
        <button type="button" className={styles.done} data-testid="remote-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/** The link as a QR code, drawn as squares in an SVG (no markup from a string). */
function QrCode({ text }: { text: string }) {
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
      data-testid="remote-qr"
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
