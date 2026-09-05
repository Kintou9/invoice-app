# invoice-app
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