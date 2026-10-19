import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A QR code (SVG) for any text or link. */
export function QR({ text, size = 112, label }: { text: string; size?: number; label?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg(''));
  }, [text]);
  return <div className="shrink-0 bg-white p-2 rounded-xl [&>svg]:w-full [&>svg]:h-full" style={{ width: size, height: size }} role="img" aria-label={label ?? `QR code for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
