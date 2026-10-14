SASTHA INFINITE ENTERPRISE — PROFESSIONAL BUSINESS SYSTEM v2.6 (RENDER HOSTING PACKAGE)

FILES
- index.html and job-sheet.html: business system UI
- server.js: Express server, SQLite API, professional PDF and email endpoints
- assets/sastha-logo.jpg: company logo embedded in server-generated PDFs
- package.json: Node dependencies and start command
- render.yaml: Render Blueprint configuration
- .node-version: Node.js 22 runtime preference

DEPLOY TO RENDER (RECOMMENDED)
1. Extract this ZIP. The files are at the project root.
2. Create a NEW private GitHub repository, e.g. sastha-infinite-professional.
3. Upload all files and hidden files from this folder to the repository root. Do not upload node_modules or any database file.
4. In Render, choose New + -> Blueprint and connect that repository. Render reads render.yaml.
5. When prompted, set ADMIN_USERNAME and ADMIN_PASSWORD. Use a unique username and a long, unique password. Do not share these credentials.
6. Deploy. Render builds with `npm install` and starts with `npm start`.
7. Open the URL Render provides. Your browser will show a login prompt; enter the ADMIN_USERNAME and ADMIN_PASSWORD values.
8. Verify https://YOUR-SERVICE.onrender.com/api/health returns a small JSON health response.

DATABASE PERSISTENCE / COST
- The Blueprint sets DATA_DIR=/var/data and mounts a 1 GB persistent disk at /var/data for the SQLite database.
- Render persistent disks require a paid web service; this Blueprint uses the Starter plan. Check Render's current pricing before deploying.
- Do not remove the disk or change DATA_DIR after entering live data unless you have backed up and migrated the database.
- The SQLite file is created automatically at /var/data/sastha-infinite.sqlite.
- Export the system's built-in business backup regularly and keep a separate copy outside Render. A persistent disk is not a substitute for backups.

LOCAL TESTING
- Install Node.js 22 or newer.
- In this folder, run: npm install
- For local development: npm start, then open http://localhost:3000
- The local database defaults to ./data/sastha-infinite.sqlite. For a production-like local test, set ADMIN_USERNAME, ADMIN_PASSWORD, and NODE_ENV=production before starting.

IMPORTANT SECURITY NOTES
- Production startup is blocked if ADMIN_USERNAME or ADMIN_PASSWORD is missing. The server then protects application pages and APIs using HTTP Basic Authentication over HTTPS provided by Render.
- Keep the repository private. Never commit .env files, passwords, or database files.
- The health endpoint /api/health is intentionally public so Render can check service health; it does not return customer or financial records.
- Authentication currently protects all users behind one shared username/password. It is not per-user role-based access control or a full account management system. Add role-based accounts and test backup/restore before using sensitive financial or customer records at scale.
- This system has not been penetration-tested. Verify core workflows on your own service after deployment.

FEATURES PRESENT IN THE PACKAGE
Dashboard, invoices, quotations, delivery orders, payment vouchers, business ledger, bank/cash reports, customers, service catalogue, settings/backup, Digital Job Sheet, SQLite database, job sheet running numbers, document search, server-generated PDF endpoints, and responsive UI refinements.


VERSION 2.4 UI CHANGES
- Removed the Charges section from the Digital Job Sheet. Charges can be managed in linked invoice/quotation documents instead.
- Removed the Quick start panel from the dashboard.
- Hid the dashboard subtitle “Your business at a glance” on mobile and reduced excess top spacing on phone screens.


VERSION 2.6 PDF OUTPUT IMPROVEMENTS
- Invoice PDFs now use the reference invoice layout: company logo, registration and SSM details, document number/date/status, customer block, payment details, clear item table, notes, totals, and footer.
- Job Sheet PDFs have no charge table or totals; customer signature is placed above the signatory name with separated spacing.
- The email attachment endpoint and PDF download/share endpoint use the same PDF renderer so the attached file matches the downloaded file.
- On supported Android/mobile browsers, WhatsApp file sharing shares the generated PDF file itself. On unsupported desktop browsers, the PDF must be downloaded and attached manually.


Version 2.7.0 interface update:
- Removed WhatsApp and Email share controls from all document preview and search pages. The document PDF preview/download remains available.
- Removed linked Create Invoice / Create Quotation / Create DO actions from the job sheet and document registers. Invoice, quotation, and delivery order modules remain available through the main navigation.
- Removed Load Draft and the associated local draft controls from the job sheet. Save Job Sheet remains connected to the central SQLite database.
