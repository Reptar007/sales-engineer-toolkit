import * as dotenv from 'dotenv';
import jsforce from 'jsforce';

dotenv.config();

export async function getSalesforceConnection() {
  // Try a simple approach - use the standard login URL
  let conn = new jsforce.Connection();

  try {
    const username = process.env.SALESFORCE_EMAIL;
    const password = process.env.SALESFORCE_PASSWORD + process.env.SALESFORCE_TOKEN;

    await conn.login(username, password);

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
