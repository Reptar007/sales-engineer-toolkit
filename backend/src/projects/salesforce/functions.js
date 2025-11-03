import * as dotenv from 'dotenv';
import jsforce from 'jsforce';

dotenv.config();

export async function getSalesforceConnection() {
  // Check if credentials are available
  const username = process.env.SALESFORCE_EMAIL;
  const password = process.env.SALESFORCE_PASSWORD;
  const token = process.env.SALESFORCE_TOKEN;
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

    console.log('Attempting Salesforce login for:', username);
    console.log('Using login URL:', loginUrl);

    await conn.login(username, fullPassword);

    console.log('Salesforce login successful');
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
