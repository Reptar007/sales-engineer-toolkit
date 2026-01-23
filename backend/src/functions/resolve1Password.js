/**
 * 1Password Value Resolution Utility
 *
 * Reusable function to resolve 1Password references (op://) to actual values
 * Can be used throughout the project for any environment variable that uses 1Password
 */

import { execSync } from 'node:child_process';

/**
 * Resolve a value from 1Password if it's an op:// reference, otherwise return as-is
 * @param {string} value - The value to resolve (may be op:// reference or plain value)
 * @returns {string} The resolved value
 */
export function resolve1PasswordValue(value) {
  if (!value) return value;

  // Check if it's a 1Password reference
  if (value.startsWith('op://')) {
    try {
      return execSync(`op read "${value}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (error) {
      // If op read fails, try op item get as fallback
      try {
        const pathParts = value.replace('op://', '').split('/');
        const vault = pathParts[0];
        const item = pathParts[1];
        const fieldName = pathParts[2];

        const result = execSync(`op item get "${item}" --vault "${vault}" --format json`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const itemData = JSON.parse(result);

        let field = itemData.fields?.find(
          (f) =>
            f.label?.toLowerCase() === fieldName?.toLowerCase() ||
            f.id?.toLowerCase() === fieldName?.toLowerCase() ||
            f.id === fieldName ||
            f.label === fieldName,
        );

        if (!field && fieldName) {
          field = itemData.fields?.find(
            (f) =>
              f.label?.toLowerCase().includes(fieldName?.toLowerCase()) ||
              f.id?.toLowerCase().includes(fieldName?.toLowerCase()),
          );
        }

        if (field) {
          return field.value;
        } else if (itemData.fields && itemData.fields.length > 0) {
          console.warn(
            `Field "${fieldName}" not found in 1Password item "${item}". Using first field.`,
          );
          return itemData.fields[0].value;
        } else {
          throw new Error(`No fields found in 1Password item "${item}"`);
        }
      } catch (fallbackError) {
        console.error(
          `Failed to resolve 1Password value "${value}": ${error.message}. Fallback also failed: ${fallbackError.message}. ` +
            `If running on Heroku, ensure the value is set to the actual value, not an op:// reference.`,
        );
        return '';
      }
    }
  }

  return value;
}
