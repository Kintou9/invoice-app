const Anthropic = require('@anthropic-ai/sdk/index.js');
const config = require('../config');

let _client = null;
const getClient = () => {
  if (!_client) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is missing. Get yours at console.anthropic.com');
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
            text: `You are a field service technician assistant. Look at this equipment photo and extract the model number and serial number from any labels, nameplates, or tags.

Model number may be labeled as: Model, Model #, Model No, MOD, M/N, MN, or similar.
Serial number may be labeled as: Serial, Serial #, Serial No, SER, S/N, SN, or similar.

Respond ONLY with valid JSON in this exact format, no other text:
{"model_number": "...", "serial_number": "...", "confidence": "high|medium|low", "notes": "any caveats"}

If you cannot find a value, use null for that field.`,
          },
        ],
      },
    ],
  });

  const raw = response.content[0].text.trim().replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'');
  try {
    return JSON.parse(raw);
  } catch {
    return { model_number: null, serial_number: null, confidence: 'low', notes: raw };
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

  const raw = response.content[0].text.trim().replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'');
  try {
    return JSON.parse(raw);
  } catch {
    return { parts: [] };
  }
}

/**
 * Extract claim information from an insurance claim screenshot.
 */
async function extractClaimInfo(imageBase64, mediaType = 'image/jpeg', templateBase64 = null, templateMediaType = 'image/jpeg') {
  const content = [];

  if (templateBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: templateMediaType, data: templateBase64 },
    });
    content.push({
      type: 'text',
      text: 'This is the blank service form template — use it to understand the layout and identify where each field is located.',
    });
  }

  content.push({
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: imageBase64 },
  });
  content.push({
    type: 'text',
    text: `You are an appliance repair service assistant. Extract all filled-in field values from this service order form.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "invoice_number": "the invoice or job number",
  "customer_name": "customer full name",
  "customer_phone": "home or cell phone number",
  "date_of_service": "date in YYYY-MM-DD format or null",
  "job_address": "full service address",
  "type_brand": "appliance type and brand (e.g. Samsung Refrigerator)",
  "model_number": "model number",
  "serial_number": "serial number",
  "nature_of_service": "description of the issue or service requested",
  "technician": "technician name if present",
  "confidence": "high|medium|low"
}

If you cannot find a value, use null for that field.`,
  });

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const raw = response.content[0].text.trim().replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'');
  try {
    return JSON.parse(raw);
  } catch {
    return {
      invoice_number: null, customer_name: null, customer_phone: null,
      date_of_service: null, job_address: null, type_brand: null,
      model_number: null, serial_number: null, nature_of_service: null,
      technician: null, confidence: 'low',
    };
  }
}

module.exports = { extractEquipmentInfo, generateIssueDescription, suggestParts, extractClaimInfo };
