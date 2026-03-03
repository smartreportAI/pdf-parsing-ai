import type {
    GeminiLabResult,
    GeminiParameter,
    GeminiReferenceRange,
    ParameterResult,
    ParameterStatus,
    ProfileResult,
    LabReportResponse,
    LabReportSummary,
} from '../types';

// ──────────────────────────────────────────────────────────────────────────────
// Status classification — compare value vs reference range
// ──────────────────────────────────────────────────────────────────────────────

function classifyStatus(param: GeminiParameter): ParameterStatus {
    const { value, referenceRange } = param;

    // Qualitative result (string like Positive / Negative / Reactive)
    if (typeof value === 'string') return 'QUALITATIVE';

    // No reference range to compare against
    if (!referenceRange) return 'UNKNOWN';

    const { min, max } = referenceRange;

    if (max !== null && value > max) return 'HIGH';
    if (min !== null && value < min) return 'LOW';
    if ((min !== null || max !== null)) return 'NORMAL';

    return 'UNKNOWN';
}

// ──────────────────────────────────────────────────────────────────────────────
// Build a single enriched parameter result
// ──────────────────────────────────────────────────────────────────────────────

function buildParameterResult(param: GeminiParameter): ParameterResult {
    const status = classifyStatus(param);

    return {
        testName: param.testName.trim(),
        value: param.value,
        unit: param.unit?.trim() || null,
        referenceRange: param.referenceRange,
        status,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Public — build the full JSON response
// ──────────────────────────────────────────────────────────────────────────────

const SKIP_VALUES = new Set([
    'not done', 'not tested', 'not applicable', 'n/a', 'pending', '',
]);

/**
 * Converts the Gemini extraction result into the full LabReportResponse —
 * with per-parameter status, recommendations, and an overall summary.
 */
export function buildLabReport(geminiResult: GeminiLabResult): LabReportResponse {
    const profiles: ProfileResult[] = geminiResult.profiles
        .map((profile) => {
            const parameters = profile.parameters
                .filter((p) => {
                    if (p.value === null || p.value === undefined) return false;
                    return !SKIP_VALUES.has(String(p.value).trim().toLowerCase());
                })
                .map(buildParameterResult);

            return {
                profileName: profile.profileName.trim(),
                parameters,
            };
        })
        .filter((p) => p.parameters.length > 0);

    // Build summary counts
    let normal = 0, high = 0, low = 0, qualitative = 0, unknown = 0;
    let totalTests = 0;
    for (const profile of profiles) {
        for (const param of profile.parameters) {
            totalTests++;
            switch (param.status) {
                case 'NORMAL': normal++; break;
                case 'HIGH': high++; break;
                case 'LOW': low++; break;
                case 'QUALITATIVE': qualitative++; break;
                case 'UNKNOWN': unknown++; break;
            }
        }
    }

    const summary: LabReportSummary = {
        totalProfiles: profiles.length,
        totalTests,
        normal,
        high,
        low,
        qualitative,
        unknown,
        attentionNeeded: high + low,
    };

    return {
        patient: geminiResult.patient,
        profiles,
        summary,
        aiAssessment: geminiResult.aiAssessment,
    };
}
