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
You are an expert medical lab report parser.

Your job: act as a top-tier, highly accurate medical professional (the "best doctor"). Read the attached lab report PDF and extract THREE things:
1. All patient/report metadata from the report header
2. Every single test result from the report body
3. A tremendous, highly accurate overall medical assessment and score based on the entire report's context.

Return ONLY a valid JSON object — no explanation, no markdown, no code fences, nothing else.

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
1. For patient.gender: look for words like Male/Female/M/F/Sex — map to exactly 'male', 'female', or 'other'.
2. For patient.age: extract only the number (e.g. "45 Yrs" -> 45, "F/45Y" -> 45).
3. Group test results by their section/panel heading in the PDF.
4. If tests have no clear group heading, use profileName: "General Panel".
5. Range "70 - 100"  -> min: 70,  max: 100, text: null
6. Range "< 200"     -> min: null, max: 200, text: "< 200"
7. Range "> 40"      -> min: 40,  max: null, text: "> 40"
8. No reference range -> referenceRange: null
9. NEVER put units inside the value field.
10. Include EVERY test — do NOT skip any.
11. Do NOT invent or hallucinate data — for test parameters, ONLY extract what is actually printed in the PDF.
12. For the aiAssessment, provide a highly accurate, critical medical evaluation. This is healthcare-related, so be rigorous. Do not give any financial advice or generic filler defaults. Provide a true health score based on the severity of the flags.
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

    const model = vertexAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            temperature: 0,       // Deterministic — critical for accurate parsing
            maxOutputTokens: 8192,
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

    let rawText = candidate.content.parts[0].text ?? '';

    // Strip markdown code fences if Gemini wraps the JSON in them
    rawText = rawText.trim();
    if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```[a-z]*\n?/, '').replace(/```\s*$/, '').trim();
    }

    let parsed: GeminiLabResult;
    try {
        parsed = JSON.parse(rawText) as GeminiLabResult;
    } catch {
        throw new Error(
            `Gemini returned invalid JSON. First 400 chars: ${rawText.substring(0, 400)}`
        );
    }

    if (!parsed.profiles || !Array.isArray(parsed.profiles)) {
        throw new Error('Gemini output is missing the "profiles" array.');
    }

    // Non-fatal — create an empty patient object if Gemini omitted it
    if (!parsed.patient) {
        parsed.patient = {
            patientName: null, age: null, gender: null,
            patientId: null, labId: null, reportId: null,
            reportDate: null, packageName: null,
        };
    }

    console.log(`[vertex] Extracted patient: ${parsed.patient.patientName ?? 'unknown'}, age: ${parsed.patient.age ?? '?'}, gender: ${parsed.patient.gender ?? '?'}`);
    console.log(`[vertex] Extracted ${parsed.profiles.length} profiles`);

    return parsed;
}
