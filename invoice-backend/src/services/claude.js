const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

let _client = null;
const getClient = () => {
  if (!_client) {
    if (!config.anthropic.apiKey || !config.anthropic.apiKey.startsWith('sk-ant-')) {
      throw new Error('ANTHROPIC_API_KEY is missing or invalid. Get yours at console.anthropic.com');
    }
    _client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return _client;
};

/**
 * Extract model number and serial number from an equipment photo.
 * imageBase64: base64-encoded image string
 * mediaType: 'image/jpeg' | 'image/png'
 */
async function extractEquipmentInfo(imageBase64, mediaType = 'image/jpeg') {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `You are a field service technician assistant. Look at this equipment photo and extract:
1. Model number (look for labels, nameplates, or tags)
2. Serial number (look for labels, nameplates, or tags)

Respond ONLY with valid JSON in this exact format, no other text:
{"model_number": "...", "serial_number": "...", "confidence": "high|medium|low", "notes": "any caveats"}

If you cannot find a value, use null for that field.`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { model_number: null, serial_number: null, confidence: 'low', notes: text };
  }
}

/**
 * Generate a professional issue description based on technician notes and equipment info.
 */
async function generateIssueDescription({ techNotes, modelNumber, serialNumber, claimNumber, templatePrompt }) {
  const context = [
    templatePrompt ? `Invoice template context:\n${templatePrompt}` : '',
    `Claim number: ${claimNumber || 'N/A'}`,
    `Equipment model: ${modelNumber || 'Unknown'}`,
    `Equipment serial: ${serialNumber || 'Unknown'}`,
    `Technician notes: ${techNotes}`,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are a professional service documentation writer. Based on the following technician notes and equipment information, write a clear, professional issue description suitable for a service invoice. Be concise but thorough. Use technical language appropriate for a service report.

${context}

Write only the issue description text, no preamble.`,
      },
    ],
  });

  return response.content[0].text.trim();
}

/**
 * Suggest parts needed based on issue description and equipment info.
 */
async function suggestParts({ issueDescription, modelNumber, serialNumber }) {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are a field service parts specialist. Based on the following service issue, suggest parts that may be needed for the repair.

Equipment model: ${modelNumber || 'Unknown'}
Equipment serial: ${serialNumber || 'Unknown'}
Issue description: ${issueDescription}

Respond ONLY with valid JSON in this exact format:
{
  "parts": [
    {"name": "Part name", "part_number": "estimated part # or null", "quantity": 1, "notes": "why this part"}
  ]
}

List only the most likely needed parts (max 8). If you cannot determine specific part numbers, use null.`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { parts: [] };
  }
}

/**
 * Extract claim information from an insurance claim screenshot.
 */
async function extractClaimInfo(imageBase64, mediaType = 'image/jpeg') {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `You are an insurance claims assistant. Look at this insurance claim document or screenshot and extract the key information.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "claim_number": "...",
  "title": "brief description of the claim",
  "description": "full description or notes from the claim",
  "confidence": "high|medium|low"
}

If you cannot find a value, use null for that field. The title should be a short summary (under 100 characters).`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { claim_number: null, title: null, description: null, confidence: 'low' };
  }
}

module.exports = { extractEquipmentInfo, generateIssueDescription, suggestParts, extractClaimInfo };
