// ──────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for the PDF Parser Backend
// ──────────────────────────────────────────────────────────────────────────────

// ---------- Gemini extraction output ----------

export interface GeminiReferenceRange {
    min: number | null;
    max: number | null;
    text: string | null;
}

export interface GeminiParameter {
    testName: string;
    value: number | string;
    unit: string | null;
    referenceRange: GeminiReferenceRange | null;
}

export interface GeminiProfile {
    profileName: string;
    parameters: GeminiParameter[];
}

/**
 * Patient metadata extracted directly from the PDF by Gemini.
 * All fields are optional because not every lab report includes everything.
 */
export interface GeminiPatientInfo {
    patientName: string | null;
    age: number | null;
    gender: 'male' | 'female' | 'other' | null;
    patientId: string | null;
    labId: string | null;
    reportId: string | null;
    reportDate: string | null;
    packageName: string | null;
}

export interface GeminiLabResult {
    patient: GeminiPatientInfo;
    profiles: GeminiProfile[];
    aiAssessment: {
        /** Overall health score out of 100 based on the results */
        healthScore: number;
        /** A list of high-level, tremendous medical recommendations for the overall report */
        overallRecommendations: string[];
    };
}

// ---------- /parse-and-report response shape ----------

/** Result of comparing the measured value against the reference range */
export type ParameterStatus = 'HIGH' | 'LOW' | 'NORMAL' | 'QUALITATIVE' | 'UNKNOWN';

export interface ParameterResult {
    testName: string;
    value: number | string;
    unit: string | null;
    referenceRange: GeminiReferenceRange | null;
    /** Whether the value is above/below/within the normal range */
    status: ParameterStatus;
}

export interface ProfileResult {
    profileName: string;
    parameters: ParameterResult[];
}

export interface LabReportSummary {
    totalProfiles: number;
    totalTests: number;
    normal: number;
    high: number;
    low: number;
    qualitative: number;
    unknown: number;
    /** Tests needing attention = high + low */
    attentionNeeded: number;
}

/**
 * The full JSON response returned by POST /parse-and-report.
 * Contains extracted patient info, all test results with status,
 * and an overall AI health assessment (score and recommendations).
 */
export interface LabReportResponse {
    patient: GeminiPatientInfo;
    profiles: ProfileResult[];
    summary: LabReportSummary;
    aiAssessment: {
        healthScore: number;
        overallRecommendations: string[];
    };
}

// ---------- Smart Report Engine types (kept for the separate SRE call if needed) ----------

export interface SreReferenceRange {
    min?: number;
    max?: number;
    text?: string;
}

export interface SreParameter {
    testName: string;
    value: number | string;
    unit?: string;
    referenceRange?: SreReferenceRange;
}

export interface SreProfile {
    profileName: string;
    parameters: SreParameter[];
}

export interface SrePayload {
    tenantId: string;
    output: 'pdf';
    reportData: {
        patientId: string;
        age: number;
        gender: 'male' | 'female' | 'other';
        profiles: SreProfile[];
    };
}

export interface SreApiResponse {
    success: boolean;
    data: {
        pdfBase64: string;
        overallScore: number;
        overallSeverity: string;
        renderedPages: string[];
        skippedPages: string[];
    };
}
