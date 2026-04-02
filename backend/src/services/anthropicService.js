import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

// Lazily initialized so the key is read at call time, not at module load time
let _anthropic = null;
function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.startsWith('op://')) {
    throw new Error(
      'Anthropic API key not configured. Please set ANTHROPIC_API_KEY environment variable.',
    );
  }
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

export const anthropicService = {
  async callAnthropic(systemPrompt, userPrompt) {
    const anthropic = getClient();

    try {
      const message = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      return message.content[0]?.text || 'No response generated';
    } catch (error) {
      console.error('Anthropic API Error:', error);
      throw new Error(`Anthropic API call failed: ${error.message}`);
    }
  },

  isConfigured() {
    const key = process.env.ANTHROPIC_API_KEY;
    return !!key && !key.startsWith('op://');
  },

  getModel() {
    return DEFAULT_MODEL;
  },
};
