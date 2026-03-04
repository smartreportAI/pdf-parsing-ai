import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parsePdfWithGemini, getVertexCredentialStatus } from '../services/vertex.service';
import { buildLabReport } from '../utils/transform';

const router = Router();

// Keep uploaded file in memory — no writing to disk
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20 MB max
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            cb(new Error('Only PDF files are accepted.'));
        } else {
            cb(null, true);
        }
    },
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /parse-and-report
//
// Accepts:
//   multipart/form-data with ONE field only:
//     pdf  (file) — the lab report PDF
//
// Gemini automatically extracts from the PDF:
//   • Patient name, age, gender
//   • Patient ID, Lab ID, Report ID, Report Date
//   • Package/panel name
//   • All test results grouped by profile
//
// Returns:
//   application/json — containing the extracted patient info, 
//   test results with HIGH/LOW/NORMAL status classifications,
//   and per-test recommendations.
// ──────────────────────────────────────────────────────────────────────────────

router.post(
    '/parse-and-report',
    upload.single('pdf'),
    async (req: Request, res: Response): Promise<void> => {
        const startMs = Date.now();

        try {
            // ── 1. Validate file ──────────────────────────────────────────────
            if (!req.file) {
                res.status(400).json({ error: 'No PDF file uploaded. Send it as a form field named "pdf".' });
                return;
            }

            console.log(`\n[parse-and-report] New request — PDF: ${req.file.originalname} (${(req.file.buffer.length / 1024).toFixed(1)} KB)`);

            // ── 2. Parse PDF with Vertex AI Gemini ───────────────────────────
            console.log('[parse-and-report] Step 1: Sending PDF to Gemini for full extraction...');
            const geminiResult = await parsePdfWithGemini(req.file.buffer);

            const totalParams = geminiResult.profiles.reduce((sum, p) => sum + p.parameters.length, 0);
            console.log(`[parse-and-report] Extracted: ${geminiResult.profiles.length} profiles, ${totalParams} parameters`);

            // ── 3. Build Enriched JSON Report ────────────────────────────────
            console.log('[parse-and-report] Step 2: Classifying results and adding recommendations...');
            const labReportJson = buildLabReport(geminiResult);

            const pt = labReportJson.patient;
            console.log(`[parse-and-report] Patient: ${pt.patientName} | Age: ${pt.age} | Gender: ${pt.gender}`);
            console.log(`[parse-and-report] Summary: ${labReportJson.summary.attentionNeeded} tests need attention (High: ${labReportJson.summary.high}, Low: ${labReportJson.summary.low})`);

            const totalMs = Date.now() - startMs;
            console.log(`[parse-and-report] Done in ${totalMs}ms — returning JSON`);

            // ── 4. Return the enriched JSON result ───────────────────────────
            res.status(200).json(labReportJson);

        } catch (err: any) {
            const totalMs = Date.now() - startMs;
            console.error(`[parse-and-report] ERROR after ${totalMs}ms:`, err.message);
            res.status(500).json({
                error: 'PDF parsing failed.',
                detail: err.message,
            });
        }
    }
);

// ──────────────────────────────────────────────────────────────────────────────
// GET /health — liveness check for Render
// ──────────────────────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'pdf-parser-backend', timestamp: new Date().toISOString() });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /auth-check — verify Google/Vertex credentials are loaded (for debugging)
// ──────────────────────────────────────────────────────────────────────────────

router.get('/auth-check', (_req: Request, res: Response) => {
    const status = getVertexCredentialStatus();
    res.status(status.ok ? 200 : 503).json({
        credentials: status.ok ? 'loaded' : 'missing_or_invalid',
        projectId: status.projectId,
        message: status.message,
        timestamp: new Date().toISOString(),
    });
});

export default router;
