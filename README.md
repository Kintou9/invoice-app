# invoice-app
[![CI/CD](https://github.com/Kintou9/invoice-app/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/Kintou9/invoice-app/actions/workflows/ci-cd.yml)

Invoice App

A full-stack invoice and claims management system built for a small appliance repair business — replacing a paper-based workflow with a digital system for tracking invoices, worker claims, and parts requests.

Built to solve a real operational problem: a 6-person team processing 500–1,000 invoices a month, previously tracked entirely on paper. This app cut invoicing and claim-tracking time by up to 75%.

Features
Invoice management — create, view, and track invoices from creation through completion
Claims workflow — technicians submit claims, managers review and approve/deny them
Parts requests — request and track parts needed for repair jobs
AI-assisted intake — uses the Claude API to read equipment photos and extract model/serial numbers automatically, and to power natural-language review of claims and part requests
File uploads — photo and document uploads stored in Azure Blob Storage
Role-based access — authenticated routes with manager vs. technician permissions
JWT authentication — secure login and protected API routes
Tech Stack

Frontend

React 19 + React Router
Axios for API calls
React Toastify for notifications
Lucide React for icons

Backend

Node.js + Express 5
PostgreSQL (pg) for data storage
JWT (jsonwebtoken) + bcryptjs for auth
Multer for file upload handling
pdf-lib for PDF generation
Azure Blob Storage SDK for file storage
Anthropic SDK (Claude API) for AI-assisted features

CI/CD

Automated via GitHub Actions (.github/workflows/ci-cd.yml)
Every push and pull request to main builds and tests both the frontend and backend
A push to main additionally deploys both to Azure App Service — gated on the build succeeding, so a broken build never reaches production
Frontend: npm ci, test, and a production build (same build used for deploy, uploaded as a workflow artifact)
Backend: npm ci and a syntax smoke-check
Deploy target: two Azure App Service instances (Node 22 LTS, Linux) — one for the Express API, one serving the static React build
One-time Azure/GitHub setup steps are documented in .github/workflows/README.md