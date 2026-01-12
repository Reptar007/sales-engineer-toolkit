import * as dotenv from 'dotenv';
import jsforce from 'jsforce';
import { execSync } from 'child_process';

dotenv.config();

/**
 * Resolve a value from 1Password if it's an op:// reference, otherwise return as-is
 * @param {string} value - The value to resolve (may be op:// reference or plain value)
 * @returns {string} The resolved value
 */
function resolve1PasswordValue(value) {
  if (!value) return value;

  // Check if it's a 1Password reference
  if (value.startsWith('op://')) {
    try {
      // For field references like op://vault/item/field, use op read
      return execSync(`op read "${value}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr to prevent it from being displayed
      }).trim();
    } catch (error) {
      // If op read fails, try op item get as fallback
      try {
        // Extract vault, item, and field from the op:// path
        // Format: op://vault/item/field
        const pathParts = value.replace('op://', '').split('/');
        const vault = pathParts[0];
        const item = pathParts[1]; // Item name is the second part
        const fieldName = pathParts[2]; // Field name is the third part

        // Try to get the item and extract the field value
        const result = execSync(`op item get "${item}" --vault "${vault}" --format json`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr
        });
        const itemData = JSON.parse(result);

        // Find the field by label or id (case-insensitive)
        // First try exact match (case-insensitive)
        let field = itemData.fields?.find(
          (f) =>
            f.label?.toLowerCase() === fieldName?.toLowerCase() ||
            f.id?.toLowerCase() === fieldName?.toLowerCase() ||
            f.id === fieldName ||
            f.label === fieldName,
        );

        // If not found, try partial match
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
          // Last resort: return first field (but log a warning)
          console.warn(
            `Field "${fieldName}" not found in 1Password item "${item}". Available fields: ${itemData.fields.map((f) => f.label || f.id).join(', ')}. Using first field.`,
          );
          return itemData.fields[0].value;
        } else {
          throw new Error(`No fields found in 1Password item "${item}"`);
        }
      } catch (fallbackError) {
        // In production (Heroku), 1Password CLI might not be available
        // Log the error but don't crash - return the original value or empty string
        console.error(
          `Failed to resolve 1Password value "${value}": ${error.message}. Fallback also failed: ${fallbackError.message}. ` +
            `If running on Heroku, ensure SALESFORCE_TOKEN is set to the actual token value, not an op:// reference.`,
        );
        // Return empty string to allow the app to continue, but getSalesforceConnection will handle the missing token
        return '';
      }
    }
  }

  // Not a 1Password reference, return as-is
  return value;
}

export async function getSalesforceConnection() {
  // Check if credentials are available and resolve 1Password references
  const username = resolve1PasswordValue(process.env.SALESFORCE_EMAIL);
  const password = resolve1PasswordValue(process.env.SALESFORCE_PASSWORD);
  const token = resolve1PasswordValue(process.env.SALESFORCE_TOKEN);
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';

  if (!username || !password) {
    throw new Error(
      'Salesforce credentials not configured. Please set SALESFORCE_EMAIL, SALESFORCE_PASSWORD, and SALESFORCE_TOKEN environment variables.',
    );
  }

  // Create connection with login URL (defaults to production, can be set to sandbox)
  let conn = new jsforce.Connection({
    loginUrl: loginUrl,
  });

  try {
    // Combine password and token (security token is appended to password)
    const fullPassword = password + (token || '');

    await conn.login(username, fullPassword);
    return conn;
  } catch (error) {
    console.error('Salesforce login failed:', error.message);
    console.error('Error code:', error.errorCode);
    console.error('Full error:', error);

    // Provide more helpful error messages
    if (error.errorCode === 'INVALID_LOGIN') {
      throw new Error(
        'Invalid Salesforce credentials. Please verify your email, password, and security token. Note: If your security token was reset, you need to use the new token.',
      );
    }

    throw error;
  }
}

export function getQuarterName(quarterKey, groupingsDown) {
  if (quarterKey === 'T!T') return 'Total';

  const quarterIndex = parseInt(quarterKey.split('!')[0]);
  const quarter = groupingsDown.groupings[quarterIndex];
  return quarter ? quarter.label : `Quarter ${quarterIndex}`;
}
