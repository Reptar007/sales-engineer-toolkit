import OpenAI from 'openai';

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export const openaiService = {
  async callOpenAI(systemPrompt, userPrompt) {
    if (!openai) {
      throw new Error(
        'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.',
      );
    }

    try {
      const response = await openai.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      });

      return response.choices[0]?.message?.content || 'No response generated';
    } catch (error) {
      console.error('OpenAI API Error:', error);
      throw new Error(`OpenAI API call failed: ${error.message}`);
    }
  },

  isConfigured() {
    return !!openai;
  },

  getModel() {
    return DEFAULT_MODEL;
  },
};
