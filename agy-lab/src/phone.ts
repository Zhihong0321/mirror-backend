// Malaysian and international phone number parser and normalizer
export function normalizePhoneNumber(raw: string, defaultCountry = 'MY'): {
  raw: string;
  e164: string | null;
  digits: string;
  isMobile: boolean;
  whatsappUrl: string | null;
  dialUrl: string;
} {
  const clean = String(raw == null ? '' : raw).trim();
  const digits = clean.replace(/\D/g, '');
  if (!digits || digits.length < 7) {
    return { raw: clean, e164: null, digits, isMobile: false, whatsappUrl: null, dialUrl: `tel:${clean.replace(/[^+\d]/g, '')}` };
  }

  let e164: string | null = null;
  let isMobile = false;

  if (defaultCountry === 'MY' || digits.startsWith('60') || clean.startsWith('+60') || digits.startsWith('01')) {
    let national = digits;
    if (national.startsWith('60')) national = '0' + national.slice(2);
    else if (!national.startsWith('0')) national = '0' + national;

    // Malaysian mobile prefixes: 010, 011, 012, 013, 014, 015, 016, 017, 018, 019
    isMobile = /^01[0-9]/.test(national);
    const intlDigits = '60' + national.slice(1);
    e164 = '+' + intlDigits;
    const whatsappUrl = isMobile ? `https://wa.me/${intlDigits}` : null;
    return {
      raw: clean,
      e164,
      digits: intlDigits,
      isMobile,
      whatsappUrl,
      dialUrl: `tel:${e164}`,
    };
  }

  if (clean.startsWith('+')) {
    e164 = '+' + digits;
  } else {
    e164 = '+' + digits;
  }
  return {
    raw: clean,
    e164,
    digits,
    isMobile: false,
    whatsappUrl: null,
    dialUrl: `tel:${e164 || digits}`,
  };
}
