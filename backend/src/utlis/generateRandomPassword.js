import crypto from 'crypto';

/**
 * Build a cryptographically random temporary password that satisfies the
 * app's password policy (>= 8 chars, at least one uppercase, lowercase,
 * digit, and special). We pick one char from each required class first
 * (so validation can never reject the result), then fill the rest from the
 * combined alphabet, then Fisher-Yates shuffle so the required-class chars
 * aren't predictably positioned.
 *
 * Ambiguous characters (0/O, 1/l/I) are excluded so admins can read the
 * value over Slack/voice without confusion.
 */
export default function generateRandomPassword(length = 14) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*-_=+';
  const all = upper + lower + digits + special;

  function pick(charset) {
    return charset[crypto.randomInt(charset.length)];
  }

  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
