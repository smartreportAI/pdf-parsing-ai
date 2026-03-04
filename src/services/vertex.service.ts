import { VertexAI } from '@google-cloud/vertexai';
import type { GeminiLabResult } from '../types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────────────────────
// Vertex AI client initialisation
//
// On Render:  set env var GOOGLE_CREDENTIALS_JSON to the full service account
//             JSON string. This code will parse it and write to a temp file.
//
// Locally:    set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
//             and the SDK will pick it up automatically.
// ──────────────────────────────────────────────────────────────────────────────

function initCredentials(): void {
    const rawJson = process.env.GOOGLE_CREDENTIALS_JSON;

    // Check if we are running in a production deployment like Render
    if (rawJson) {
        try {
            // Validate the JSON before writing it
            const parsed = JSON.parse(rawJson);
            if (parsed.type !== 'service_account' || !parsed.project_id) {
                throw new Error(
                    'GOOGLE_CREDENTIALS_JSON must be a Google Cloud service account key (type "service_account" with project_id).'
                );
            }
            const tmpPath = path.join(os.tmpdir(), 'gcp-credentials.json');
            fs.writeFileSync(tmpPath, rawJson, { encoding: 'utf-8' });
            process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
            console.log('[vertex] Successfully loaded & wrote credentials from GOOGLE_CREDENTIALS_JSON');
        } catch (err: any) {
            const msg = err.message || String(err);
            if (msg.includes('service_account') && msg.includes('project_id')) {
                throw err;
            }
            throw new Error(
                'GOOGLE_CREDENTIALS_JSON is not valid JSON. On Render: use the env var GOOGLE_CREDENTIALS_JSON and paste the entire service account JSON (minify to one line to avoid newline issues).'
            );
        }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        let credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!fs.existsSync(credPath)) {
            // Render: Secret Files are mounted in service root for Node, not only /etc/secrets/
            const fileName = path.basename(credPath);
            const fallbacks = [
                path.join(process.cwd(), fileName),
                path.join(process.cwd(), 'gcp-key.json'),
                path.join('/etc/secrets', fileName),
                '/etc/secrets/gcp-key.json',
            ].filter((p) => p !== credPath);
            const found = fallbacks.find((p) => fs.existsSync(p));
            if (found) {
                credPath = found;
                process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
                console.log(`[vertex] Credentials file not at configured path; using: ${credPath}`);
            } else {
                throw new Error(
                    `GOOGLE_APPLICATION_CREDENTIALS is set to "${process.env.GOOGLE_APPLICATION_CREDENTIALS}" but that file does not exist. On Render: set env to "gcp-key.json" (Secret File in service root) or use GOOGLE_CREDENTIALS_JSON with the full JSON.`
                );
            }
        }
        console.log(`[vertex] Using credentials file at: ${credPath}`);
    } else {
        const isProduction = process.env.NODE_ENV === 'production';
        if (isProduction) {
            throw new Error(
                'No Google credentials found. Set GOOGLE_CREDENTIALS_JSON (full service account JSON string) in Render Dashboard → Environment.'
            );
        }
        console.warn('[vertex] WARNING: Neither GOOGLE_CREDENTIALS_JSON nor GOOGLE_APPLICATION_CREDENTIALS is set.');
    }
}

function buildVertexClient(): VertexAI {
    initCredentials();
    const projectId = process.env.GOOGLE_PROJECT_ID;
    const location = process.env.GOOGLE_LOCATION || 'us-central1';
    if (!projectId) {
        throw new Error('Missing required env var: GOOGLE_PROJECT_ID');
    }
    return new VertexAI({ project: projectId, location });
}

/**
 * Returns credential status for the /auth-check endpoint (no secrets exposed).
 */
export function getVertexCredentialStatus(): { ok: boolean; projectId: string | null; message: string } {
    const projectId = process.env.GOOGLE_PROJECT_ID || null;
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath) {
        return {
            ok: false,
            projectId,
            message: 'GOOGLE_APPLICATION_CREDENTIALS is not set. On Render, set GOOGLE_CREDENTIALS_JSON to the full service account JSON.',
        };
    }
    if (!fs.existsSync(credPath)) {
        return {
            ok: false,
            projectId,
            message: `Credentials file not found at ${credPath}. Check that GOOGLE_CREDENTIALS_JSON was valid JSON.`,
        };
    }
    if (!projectId) {
        return { ok: false, projectId: null, message: 'GOOGLE_PROJECT_ID is not set.' };
    }
    return {
        ok: true,
        projectId,
        message: 'Credentials and project ID are set. If API calls still fail, check service account has "Vertex AI User" and Vertex AI API is enabled.',
    };
}

const vertexAI = buildVertexClient();

// ──────────────────────────────────────────────────────────────────────────────
// Extraction prompt
// Tells Gemini to extract BOTH patient metadata AND all test results from PDF
// ──────────────────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `
You are an expert medical lab report parser. Your output will be parsed by code. You MUST follow the rules strictly.

CRITICAL: You must return ONLY a single valid JSON object. Nothing else.
- No text, explanation, or comment before or after the JSON.
- No markdown (no \`\`\`json or \`\`\`).
- Start your response with { and end with }. The entire response must be parseable as JSON.
- For PDFs with many pages, include EVERY test from every page. Do not truncate. Output the complete JSON.

Your job: Read the attached lab report PDF and extract:
1. All patient/report metadata from the report header
2. Every single test result from the report body (every parameter must have testName, value, unit, referenceRange)
3. An overall medical assessment (healthScore 0-100 and overallRecommendations array)

The JSON must follow this EXACT structure:
{
  "patient": {
    "patientName": "string — full patient name as printed, or null if not found",
    "age": "number — patient age as a number (e.g. 45), or null if not found",
    "gender": "exactly one of: 'male', 'female', 'other' — or null if not found",
    "patientId": "string — patient ID / PID / MRN / patient number, or null",
    "labId": "string — lab ID / sample ID / barcode / accession number, or null",
    "reportId": "string — report number / report ID, or null",
    "reportDate": "string — report date / test date / collection date as printed, or null",
    "packageName": "string — test package / profile package name if mentioned, or null"
  },
  "aiAssessment": {
    "healthScore": "number — a true, critical health score out of 100 based directly on the severity of the flagged parameters. Be rigorous.",
    "overallRecommendations": [
      "string — Actionable, highly specific clinical recommendation 1 (e.g. 'Initiate strict glycemic control protocol due to HbA1c 6.4%...')",
      "string — Actionable, highly specific clinical recommendation 2",
      "string — Actionable, highly specific clinical recommendation 3"
    ]
  },
  "profiles": [
    {
      "profileName": "string — the panel/section heading (e.g. 'Lipid Profile', 'Complete Blood Count')",
      "parameters": [
        {
          "testName": "string — exact test name as it appears in the PDF",
          "value": "number OR string — numeric values as number, qualitative results (Positive/Negative/Reactive) as string",
          "unit": "string — e.g. 'mg/dL', 'g/dL', 'U/L' — or null if not present",
          "referenceRange": {
            "min": "number or null",
            "max": "number or null",
            "text": "string or null — e.g. '< 200', '> 40', 'Negative'"
          }
        }
      ]
    }
  ]
}

Rules you MUST follow:
1. Output ONLY the JSON object. No preamble, no "Here is the JSON", no trailing text.
2. patient.gender: exactly 'male', 'female', or 'other' (lowercase).
3. patient.age: number only (e.g. 45).
4. Group test results by section/panel heading. No heading -> profileName: "General Panel".
5. referenceRange: "70 - 100" -> min: 70, max: 100, text: null; "< 200" -> min: null, max: 200, text: "< 200"; "> 40" -> min: 40, max: null, text: "> 40"; none -> null.
6. value: numeric as number, qualitative (Positive/Negative) as string. Never put units in value.
7. Include EVERY test from the PDF. For long reports (many pages), output the FULL JSON — do not stop early.
8. Do not invent data. Only extract what is printed. Every parameter must have testName, value (never null if present in PDF), unit, referenceRange.
9. aiAssessment: healthScore (number 0-100), overallRecommendations (array of strings). Be rigorous and clinical.
`;

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Sends the PDF buffer to Vertex AI Gemini and returns the full structured
 * lab result — patient metadata + all test profiles extracted from the PDF.
 */
export async function parsePdfWithGemini(pdfBuffer: Buffer): Promise<GeminiLabResult> {
    // gemini-2.0-flash-001 is widely available; override via GEMINI_MODEL env var.
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-001';
    console.log(`[vertex] Using model: ${modelName}`);

    // Gemini 2.0 Flash supports max 8192 output tokens; use env to override (capped at 8192)
    const maxOutputTokens = Math.min(
        parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '8192', 10) || 8192,
        8192
    );
    const model = vertexAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            temperature: 0,
            maxOutputTokens: Math.max(2048, maxOutputTokens),
        },
    });

    const pdfBase64 = pdfBuffer.toString('base64');

    const result = await model.generateContent({
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType: 'application/pdf',
                            data: pdfBase64,
                        },
                    },
                    { text: EXTRACTION_PROMPT },
                ],
            },
        ],
    });

    const candidate = result.response.candidates?.[0];
    if (!candidate) {
        throw new Error('Gemini returned no candidates — PDF may be unreadable or too large.');
    }

    // Concatenate ALL parts — long responses (many pages) can be split across multiple parts
    const rawText = (candidate.content.parts ?? [])
        .map((p: { text?: string | null }) => p.text ?? '')
        .join('')
        .trim();

    if (!rawText) {
        throw new Error('Gemini returned empty content.');
    }

    // Strip markdown code fences if present
    let jsonStr = rawText;
    if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```[a-z]*\n?/, '').replace(/\s*```\s*$/, '').trim();
    }

    // Extract the outermost JSON object (handles trailing text or extra whitespace)
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    let parsed: GeminiLabResult;
    try {
        parsed = JSON.parse(jsonStr) as GeminiLabResult;
    } catch (parseErr: any) {
        const preview = jsonStr.length > 500 ? `${jsonStr.substring(0, 500)}...` : jsonStr;
        throw new Error(
            `Gemini returned invalid JSON (length ${jsonStr.length}). Parse error: ${parseErr.message}. Preview: ${preview}`
        );
    }

    if (!parsed.profiles || !Array.isArray(parsed.profiles)) {
        throw new Error('Gemini output is missing the "profiles" array.');
    }

    // Normalise profiles: require testName; drop parameters with null/undefined value so response is consistent
    parsed.profiles = parsed.profiles.map((profile) => ({
        profileName: profile.profileName ?? 'General Panel',
        parameters: (profile.parameters ?? [])
            .filter((p) => p && String(p.testName ?? '').trim() && (p.value !== undefined && p.value !== null))
            .map((p) => ({
                testName: String(p.testName ?? '').trim(),
                value: p.value,
                unit: p.unit ?? null,
                referenceRange: p.referenceRange ?? null,
            })),
    }));

    if (!parsed.patient) {
        parsed.patient = {
            patientName: null, age: null, gender: null,
            patientId: null, labId: null, reportId: null,
            reportDate: null, packageName: null,
        };
    }

    if (!parsed.aiAssessment || typeof parsed.aiAssessment.healthScore !== 'number') {
        parsed.aiAssessment = {
            healthScore: 0,
            overallRecommendations: parsed.aiAssessment?.overallRecommendations ?? [],
        };
    }

    console.log(`[vertex] Extracted patient: ${parsed.patient.patientName ?? 'unknown'}, age: ${parsed.patient.age ?? '?'}, gender: ${parsed.patient.gender ?? '?'}`);
    console.log(`[vertex] Extracted ${parsed.profiles.length} profiles`);

    return parsed;
}
