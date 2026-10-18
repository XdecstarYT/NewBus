/** Format an integer Bits amount for display: 1234567 -> "1.23M BT". */
export function formatBits(n: number, withUnit = true): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  let s: string;
  if (a >= 1e12) s = (a / 1e12).toFixed(2) + 'T';
  else if (a >= 1e9) s = (a / 1e9).toFixed(2) + 'B';
  else if (a >= 1e6) s = (a / 1e6).toFixed(2) + 'M';
  else if (a >= 1e4) s = (a / 1e3).toFixed(1) + 'K';
  else s = Math.round(a).toLocaleString('en-US');
  return sign + s + (withUnit ? ' BT' : '');
}

/** Zero-padded account numbers: 1 -> "01", 12 -> "12", 123 -> "123". */
export function padAccountNumber(n: number): string {
  return String(n).padStart(2, '0');
}
