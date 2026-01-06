import { openaiService } from '../../../services/openaiService.js';

/**
 * Generate a summary of test code using OpenAI
 * @param {string} flowName - The name of the flow/workflow
 * @param {string} code - The combined code from all selected tests
 * @returns {Promise<string>} The generated summary
 */
export async function generateCodeSummary(flowName, code) {
  const systemPrompt = `You are an expert at analyzing and summarizing test automation code. 
Your task is to create clear, concise summaries of test code that explain what the tests do in business-friendly language.

Focus on:
- What the test is testing (the business functionality)
- Key actions and validations performed
- Important test data or scenarios covered
- Any notable patterns or helper functions used

Keep the summary professional, clear, and suitable for sharing with non-technical stakeholders.
IMPORTANT: The summary must be exactly 1-3 paragraphs. Be concise and focused.`;

  const userPrompt = `Please provide a concise summary of the following test code for the flow "${flowName}".

The summary should be 1-3 paragraphs covering:
1. The overall purpose of this test flow
2. Key test steps and what they validate
3. Important scenarios or test data covered

Here is the code:

\`\`\`javascript
${code}
\`\`\`

Please provide a concise, well-structured summary in 1-3 paragraphs that would be suitable for documentation or sharing with stakeholders.`;

  try {
    const summary = await openaiService.callOpenAI(systemPrompt, userPrompt);
    return summary;
  } catch (error) {
    console.error('Error generating code summary:', error);
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}

export const codeSummaryService = {
  generateCodeSummary,
};
