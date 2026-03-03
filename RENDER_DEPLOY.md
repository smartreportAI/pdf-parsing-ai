# Render Deployment Guide (PDF Parser Backend)

This project is fully automated for Render using the included `render.yaml` file (Infrastructure as Code). 

## Step 1: Push Your Code to GitHub
Render needs to pull your code from a Git repository.
1. Create a new empty repository on [GitHub](https://github.com/new).
2. Open your terminal in the `PDF Parser Backend` folder and run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
   git push -u origin main
   ```

*Note: Your `.gitignore` is already set up to ignore `gcp-key.json` and `.env` files, keeping your secrets safe.*

## Step 2: Deploy to Render via Blueprint
Render has a "Blueprint" feature that automatically reads the `render.yaml` file we created and sets up the server perfectly.

1. Log into your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** → **Blueprint** at the top right.
3. Connect your GitHub account and select the repository you just created.
4. Render will read the `render.yaml` and show a proposed Web Service named `pdf-parser-backend`.
5. Click **Apply**. 

*Render will automatically start building your application using `npm install && npm run build` and start it with `npm start`.*

## Step 3: Add Your Secret Environment Variables
The `render.yaml` file automatically configures public environment variables (like `PORT` and `GOOGLE_PROJECT_ID`), but you MUST manually add the secret variables on the Render Dashboard.

1. Once the service is created, click on it in the Render Dashboard (`pdf-parser-backend`).
2. Go to the **Environment** tab on the left.
3. Add the following **Secret Files / Variables**:

| Key | Value (What to put) |
|---|---|
| `SMART_REPORT_ENGINE_URL` | The URL of your deployed Smart Report Engine (e.g., `https://smart-report-engine.onrender.com`). *If you haven't deployed it yet, enter anything for now, but remember to update it later!* |
| `GOOGLE_CREDENTIALS_JSON` | Open your local `gcp-key.json` file on your computer, copy the **entire contents** (all the `{ "type": "service_account", ... }` JSON), and paste it directly into the Value field on Render. Our code automatically handles converting this back into a secure file on Render's side! |

4. Click **Save Changes**. This will trigger a new deployment automatically.

## Step 4: Test Your Live Endpoint
Once Render says "Live", your backend is fully deployed!

In Postman, just change your `PARSER_URL` from `http://localhost:4000` to the new URL Render gives you (e.g., `https://pdf-parser-backend-xxxx.onrender.com`).

---

### Important Note on the Smart Report Engine
Your PDF Parser Backend connects directly to your Smart Report Engine to generate the reports. 
**You must also deploy the Smart Report Engine project to Render** in a similar way (create a GitHub repo -> deploy Web Service on Render). Once deployed, copy its URL and put it into the `SMART_REPORT_ENGINE_URL` environment variable for the PDF Parser Backend.
