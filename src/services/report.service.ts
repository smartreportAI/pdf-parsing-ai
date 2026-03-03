import axios from 'axios';
import type { SrePayload, SreApiResponse } from '../types';

// ──────────────────────────────────────────────────────────────────────────────
// Smart Report Engine client
// ──────────────────────────────────────────────────────────────────────────────

function getSreUrl(): string {
    const url = process.env.SMART_REPORT_ENGINE_URL;
    if (!url) {
        throw new Error('Missing required env var: SMART_REPORT_ENGINE_URL');
    }
    return url.replace(/\/$/, ''); // strip trailing slash if any
}

/**
 * Sends the structured lab payload to the Smart Report Engine and
 * returns the generated PDF as a Buffer.
 *
 * @throws {Error} if the SRE call fails or returns a non-200 status
 */
export async function generateReport(payload: SrePayload): Promise<Buffer> {
    const sreUrl = getSreUrl();
    const endpoint = `${sreUrl}/reports/generate`;

    console.log(`[report] Calling Smart Report Engine at ${endpoint}`);
    console.log(`[report] Tenant: ${payload.tenantId} | Patient: ${payload.reportData.patientId}`);
    console.log(
        `[report] Profiles: ${payload.reportData.profiles.map((p) => p.profileName).join(', ')}`
    );

    let response: SreApiResponse;

    try {
        const { data } = await axios.post<SreApiResponse>(endpoint, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 120_000, // 2 minutes — PDF generation can take time
        });
        response = data;
    } catch (err: any) {
        const status = err.response?.status;
        const body = JSON.stringify(err.response?.data ?? err.message);
        throw new Error(`Smart Report Engine call failed (HTTP ${status ?? 'no response'}): ${body}`);
    }

    if (!response.success || !response.data?.pdfBase64) {
        throw new Error(
            `Smart Report Engine returned an error: ${JSON.stringify(response)}`
        );
    }

    // Convert base64-encoded PDF → raw Buffer to stream back to the portal
    return Buffer.from(response.data.pdfBase64, 'base64');
}
