import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import parseRouter from './routes/parse.route';

// ──────────────────────────────────────────────────────────────────────────────
// Express app setup
// ──────────────────────────────────────────────────────────────────────────────

const app = express();

// Allow all origins for the demo (portal can be on any domain)
app.use(cors());

// Accept JSON bodies (for future use)
app.use(express.json({ limit: '1mb' }));

// Mount routes
app.use('/', parseRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4000', 10);

app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║        PDF Parser Backend — Running              ║');
    console.log(`║   URL  : http://localhost:${PORT}                   ║`);
    console.log(`║   SRE  : ${process.env.SMART_REPORT_ENGINE_URL ?? '(not set)'}  ║`);
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log('Endpoints:');
    console.log(`  POST http://localhost:${PORT}/parse-and-report  ← main endpoint`);
    console.log(`  GET  http://localhost:${PORT}/health            ← liveness check`);
    console.log('');
});
