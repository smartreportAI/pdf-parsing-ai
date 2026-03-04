# Frontend Integration Guide — PDF Parser Backend

How to call the API from your frontend portal to upload a PDF and get the structured lab report JSON.

---

## Base URL

| Environment | Base URL |
|-------------|----------|
| **Local** | `http://localhost:4000` |
| **Deployed (Render)** | `https://pdf-parser-backend-ucsr.onrender.com` |

Use a config or env in your frontend, e.g.:

```ts
const API_BASE = import.meta.env.VITE_PDF_PARSER_API ?? 'https://pdf-parser-backend-ucsr.onrender.com';
```

---

## API to Use: Parse Lab Report

**Endpoint:** `POST /parse-and-report`  
**URL:** `{baseUrl}/parse-and-report`

**Purpose:** Send a lab report PDF and get back structured JSON (patient, profiles, aiAssessment).

### How to send the PDF

- **Content-Type:** `multipart/form-data` (browser will set this when you use `FormData`).
- **Form field name:** `pdf` (must be exactly `pdf`).
- **Value:** the PDF file (e.g. from `<input type="file">` or a `File` object).
- **Max file size:** 20 MB.
- **Allowed type:** PDF only (`application/pdf`).

You do **not** send JSON in the body. You send a **form** with one **file** field named `pdf`.

---

## Request Example (JavaScript / TypeScript)

### Using `fetch`

```ts
const API_BASE = 'https://pdf-parser-backend-ucsr.onrender.com';

async function parseLabReportPdf(file: File) {
  const formData = new FormData();
  formData.append('pdf', file);   // field name must be "pdf"

  const response = await fetch(`${API_BASE}/parse-and-report`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type header — browser sets it with boundary for FormData
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.detail || err.error || 'Upload failed');
  }

  return response.json();
}

// Usage (e.g. from file input)
const fileInput = document.querySelector('input[type="file"]');
fileInput?.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.type !== 'application/pdf') {
    alert('Please select a PDF file.');
    return;
  }
  try {
    const report = await parseLabReportPdf(file);
    console.log(report);  // { tenantId, output, reportData }
  } catch (err) {
    console.error(err);
  }
});
```

### Using Axios

```ts
import axios from 'axios';

const API_BASE = 'https://pdf-parser-backend-ucsr.onrender.com';

async function parseLabReportPdf(file: File) {
  const formData = new FormData();
  formData.append('pdf', file);

  const { data } = await axios.post(`${API_BASE}/parse-and-report`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    maxBodyLength: 21 * 1024 * 1024,  // 20 MB
  });

  return data;
}
```

---

## Success Response (200)

JSON shape:

```json
{
  "tenantId": "Demo_user",
  "output": "pdf",
  "reportData": {
    "patientId": "PAT-123",
    "patientName": "John Doe",
    "age": 55,
    "gender": "female",
    "labId": "C7869092",
    "reportId": null,
    "reportDate": "25/Aug/2025 02:59PM",
    "packageName": "PUNE CRL PACKAGE",
    "profiles": [
      {
        "profileName": "Lipid Profile",
        "parameters": [
          {
            "testName": "Total Cholesterol",
            "value": 238,
            "unit": "mg/dL",
            "referenceRange": { "min": 0, "max": 200 }
          }
        ]
      }
    ],
    "aiAssessment": {
      "healthScore": 64,
      "overallRecommendations": [
        "Initiate a lipid-lowering therapy...",
        "Investigate and manage the cause of anemia..."
      ]
    }
  }
}
```

- **`reportData.profiles`** — array of panels; each has `profileName` and `parameters` (test name, value, unit, referenceRange).
- **`reportData.aiAssessment`** — `healthScore` (0–100) and `overallRecommendations` (array of strings).
- Any of the patient/report fields may be `null` if not found in the PDF.

---

## Error Responses

### 400 — No PDF or wrong field

When no file is sent or the field is not named `pdf`:

```json
{
  "error": "No PDF file uploaded. Send it as a form field named \"pdf\"."
}
```

**How to handle:** Show a message like “Please select a PDF file” and ensure the form field name is `pdf`.

### 500 — Parsing failed

When the backend or Vertex AI fails (e.g. auth, invalid PDF):

```json
{
  "error": "PDF parsing failed.",
  "detail": "[VertexAI.GoogleAuthError]: Unable to authenticate..."
}
```

**How to handle:** Show `error` to the user and optionally `detail` in a dev/debug view. Do not send the raw `detail` to analytics if it may contain internal info.

### Other (e.g. 413, 502)

- **413** — body too large (over 20 MB).
- **502/503** — service down or overloaded.

Treat as generic “Upload failed, please try again.”

---

## Optional Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness; returns `{ status: "ok", service: "pdf-parser-backend", timestamp }`. |
| `GET` | `/auth-check` | Checks if backend has valid Google/Vertex credentials; 200 = OK, 503 = not configured. |

---

## CORS

The backend allows all origins (`cors()` with default). If you deploy the frontend on a custom domain, it should work without extra CORS config.

---

## Quick checklist for your portal

1. **URL:** `POST {baseUrl}/parse-and-report`.
2. **Body:** `FormData` with one field: **name `pdf`**, value = PDF `File`.
3. **Success:** `response.ok` → `await response.json()` gives `{ tenantId, output, reportData }`.
4. **Failure:** Non‑2xx → parse JSON for `error` and optional `detail` and show a user-friendly message.
