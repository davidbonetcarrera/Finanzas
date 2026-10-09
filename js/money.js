// Importes en centavos (enteros) para evitar errores de coma flotante.

const MAX_CENTS = 99_999_999_999; // $999,999,999.99

/**
 * Convierte un texto escrito por el usuario a centavos.
 * Acepta "475.50", "475,50", "1,075.50", "1.075,50", "$600", "  12 ".
 * Devuelve null si el texto no es un importe válido. "" devuelve 0.
 */
export function parseAmount(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return clamp(Math.round(input * 100));
  }
  let s = String(input ?? '').trim().replace(/[\s$€]/g, '').replace(/^USD/i, '');
  if (s === '') return 0;
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart, decPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? '.' : ',';
    const i = s.lastIndexOf(decSep);
    intPart = s.slice(0, i); decPart = s.slice(i + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const i = s.lastIndexOf(sep);
    const after = s.slice(i + 1);
    const count = s.split(sep).length - 1;
    // "1,075" o "1.075.000" => separador de miles; "475,5" / "475.50" => decimales
    if (count > 1) {
      // varios separadores iguales: sólo válidos como miles ("1.075.000")
      if (!s.split(sep).slice(1).every((g) => g.length === 3)) return null;
      intPart = s; decPart = '';
    } else if (after.length === 3) { intPart = s; decPart = ''; }
    else { intPart = s.slice(0, i); decPart = after; }
  } else {
    intPart = s;
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (decPart.length > 2 || /[.,]/.test(decPart)) return null;
  if (intPart === '' && decPart === '') return null;
  const cents = Number(intPart || '0') * 100 + Number((decPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return clamp(neg ? -cents : cents);
}

function clamp(c) {
  if (c > MAX_CENTS) return MAX_CENTS;
  if (c < -MAX_CENTS) return -MAX_CENTS;
  return c;
}

/** 107550 => "$1,075.50"; -2000 => "-$20.00" */
export function fmt(cents) {
  const c = Math.round(Number(cents) || 0);
  const neg = c < 0;
  const abs = Math.abs(c);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = String(abs % 100).padStart(2, '0');
  return (neg ? '-$' : '$') + int + '.' + dec;
}

/** Valor para un campo de texto editable: 47550 => "475.50", 0 => "" */
export function toInput(cents) {
  if (!cents) return '';
  return (cents / 100).toFixed(2);
}

export function toNumber(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

export function sum(list, fn = (x) => x) {
  let t = 0;
  for (const x of list) t += fn(x) || 0;
  return t;
}
