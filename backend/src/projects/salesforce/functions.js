import * as dotenv from 'dotenv';
import jsforce from 'jsforce';

dotenv.config();

export async function getSalesforceConnection() {
  // Check if credentials are available
  const username = process.env.SALESFORCE_EMAIL;
  const password = process.env.SALESFORCE_PASSWORD;
  const token = process.env.SALESFORCE_TOKEN;

  if (!username || !password) {
    throw new Error(
      'Salesforce credentials not configured. Please set SALESFORCE_EMAIL, SALESFORCE_PASSWORD, and SALESFORCE_TOKEN environment variables.',
    );
  }

  // Try a simple approach - use the standard login URL
  let conn = new jsforce.Connection();

  try {
    const fullPassword = password + (token || '');

    await conn.login(username, fullPassword);

    return conn;
  } catch (error) {
    console.error('Salesforce login failed:', error.message);
    console.error('Full error:', error);
    throw error;
  }
}

export function getQuarterName(quarterKey, groupingsDown) {
  if (quarterKey === 'T!T') return 'Total';

  const quarterIndex = parseInt(quarterKey.split('!')[0]);
  const quarter = groupingsDown.groupings[quarterIndex];
  return quarter ? quarter.label : `Quarter ${quarterIndex}`;
}
