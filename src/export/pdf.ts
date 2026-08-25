/**
 * A one-page PDF wrapping a JPEG. PDF can embed JPEG bytes directly through the
 * DCTDecode filter, so no encoder and no dependency are needed — the alternative
 * was pulling in a PDF library for a single page containing a single image.
 */

function toLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export interface PdfPageOptions {
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** Points per inch of the source bitmap; 96 keeps a screen pixel a CSS pixel. */
  dpi?: number;
}

export function jpegToPdf({ jpeg, widthPx, heightPx, dpi = 96 }: PdfPageOptions): Uint8Array {
  const scale = 72 / dpi;
  const width = +(widthPx * scale).toFixed(2);
  const height = +(heightPx * scale).toFixed(2);

  const objects: Uint8Array[] = [];
  const offsets: number[] = [];
  const header = toLatin1('%PDF-1.4\n');
  let position = header.length;

  const push = (body: Uint8Array) => {
    offsets.push(position);
    objects.push(body);
    position += body.length;
  };

  push(toLatin1('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  push(toLatin1('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'));
  push(
    toLatin1(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    ),
  );
  push(
    concat([
      toLatin1(
        `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      toLatin1('\nendstream\nendobj\n'),
    ]),
  );

  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;
  push(toLatin1(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`));

  const xrefStart = position;
  const rows = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const trailer = toLatin1(
    `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${rows}` +
      `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );

  return concat([header, ...objects, trailer]);
}
