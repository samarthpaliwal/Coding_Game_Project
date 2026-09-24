// Optional AI content generation through the Anthropic SDK.
// Active only when ANTHROPIC_API_KEY (or an `ant auth login` profile) is available; every caller
// must handle a null result and fall back to the built-in banks.

let clientPromise = null;

export function aiEnabled() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.CONTRABAND_NO_AI !== '1';
}

async function client() {
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk')
      .then((m) => new m.default())
      .catch((err) => {
        console.error('anthropic sdk unavailable', err.message);
        return null;
      });
  }
  return clientPromise;
}

const MODEL = process.env.CONTRABAND_AI_MODEL || 'claude-opus-5';

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Generate themed cards for Cardsmith: prompt cards (with a ____ blank) and answer cards.
// Resolves to { black: string[], white: string[] } or null (no key, network error, refusal).
export async function generateCards({ category, blackCount = 16, whiteCount = 40, examples = [] }) {
  if (!aiEnabled()) return null;
  const c = await client();
  if (!c) return null;
  const theme = (category || '').trim() || 'a random mix of everyday life';
  const sample = examples
    .slice(0, 12)
    .map((t) => `- ${t}`)
    .join('\n');
  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system:
        'You write cards for a fill-in-the-blank party game played by friends aged 13+. Voice: deadpan, specific, mundane-meets-absurd. Never: real people, brands, politics, religion, slurs, sex, drugs, self-harm, or jokes about anyone’s body. Output only JSON.',
      messages: [
        {
          role: 'user',
          content: `Theme chosen by the players: "${theme}".\n${sample ? `Answer cards the players already wrote, for tone (do not repeat them):\n${sample}\n` : ''}\nWrite ${blackCount} prompt cards and ${whiteCount} answer cards on this theme.\nPrompt cards: a sentence with exactly one blank written as ____ (four underscores), max 90 characters, funniest when almost any answer fits.\nAnswer cards: a short noun phrase, lowercase unless a proper noun, max 45 characters, oddly specific, no trailing period.\nReturn JSON only: {"black": ["..."], "white": ["..."]}`,
        },
      ],
    });
    if (res.stop_reason === 'refusal') return null;
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const json = extractJson(text);
    if (!json) return null;
    const clean = (arr, max, needBlank) =>
      (Array.isArray(arr) ? arr : [])
        .filter((t) => typeof t === 'string')
        .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, max))
        .filter((t) => t.length >= 3 && (!needBlank || t.includes('____')));
    const black = clean(json.black, 90, true);
    const white = clean(json.white, 45, false);
    if (!black.length && !white.length) return null;
    return { black, white };
  } catch (err) {
    console.error('AI card generation failed:', err?.message || err);
    return null;
  }
}
