# elorm-borborbor-website.org

Official website for ELORM BORBORBOR GROUP — Traditional Dance Group from Saviefe Agorkpo, Volta Region, Ghana

---

## Project overview
A modern, responsive website showcasing the ELORM BORBORBOR GROUP: history, events, media gallery, booking/contact, and news. Built with a static frontend (HTML/CSS/JavaScript) and a lightweight Node.js + Express backend for contact forms, event management, and API endpoints.

## Features
- Responsive landing and about pages
- Photo and video gallery
- Events and calendar listing
- Contact / booking form with server-side handling
- Admin API endpoints (protected) for event management
- SEO-friendly markup and accessible design

## Technology stack
- Frontend: HTML, CSS, JavaScript (vanilla or framework of choice)
- Backend: Node.js, Express
- Optional: SQLite/Postgres (or other) for event storage
- Build & deployment: npm, Docker (optional)

---

## Getting started

### Prerequisites
- Node.js (v16+ recommended) and npm or yarn
- Git

### Clone repository
```bash
git clone https://github.com/<your-org>/elorm-borborbor-website.org.git
cd elorm-borborbor-website.org
```

---

## Installation

Install dependencies for backend and frontend (if split):

Backend:
```bash
cd backend
npm install
```

Frontend (if separate):
```bash
cd frontend
npm install
```

Or if single-repo with root package.json:
```bash
npm install
```

---

## Setup

### Backend
1. Create a .env file in the backend folder (see Environment variables below).
2. Run migrations or initialize database if applicable.
3. Start server:
```bash
cd backend
npm run dev        # for development (e.g., nodemon)
npm start          # for production
```
4. API endpoints typically available at: http://localhost:3000/api

### Frontend
1. Configure API base URL to point to backend (see Environment variables).
2. Start dev server or open static files:
```bash
cd frontend
npm run dev        # if project uses a bundler
# or
open index.html    # for static sites
```

---

## Environment variables

Create a .env file in the backend directory. Example:
```
PORT=3000
NODE_ENV=development
API_BASE_URL=http://localhost:3000
SESSION_SECRET=yourStrongSessionSecretHere
# Optional email settings for contact form
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=supersecret
# Optional DB connection
DATABASE_URL=postgres://user:pass@localhost:5432/elormdb
```

- Keep secrets out of version control.
- Use environment-specific values for production.

---

## Deployment

Recommended minimal options:

1. Platform-as-a-Service (Heroku, Render, Railway)
    - Set environment variables in the platform dashboard
    - Push code and configure build/start scripts in package.json
    - Example Heroku:
      ```bash
      heroku create elorm-borborbor
      git push heroku main
      heroku config:set NODE_ENV=production SESSION_SECRET=...
      ```

2. Static frontend + separate backend
    - Deploy frontend to Netlify / Vercel / GitHub Pages
    - Deploy backend to Heroku / Render / DigitalOcean App Platform
    - Ensure CORS and API_BASE_URL are correctly configured

3. Docker
    - Add Dockerfile for backend and optional nginx/static for frontend
    - Build and run:
      ```bash
      docker build -t elorm-backend ./backend
      docker run -e NODE_ENV=production -p 3000:3000 elorm-backend
      ```

Security & ops notes:
- Use HTTPS in production
- Protect admin endpoints with authentication
- Regularly rotate secrets and keep dependencies updated

---

## Project structure (suggested)
- /frontend — static site or SPA
- /backend — Node.js + Express server
- /public — images, assets
- /data or /db — optional database files or migrations
- README.md, package.json, .env.example

---

## Contact & Owner

ELORM BORBORBOR GROUP  
Location: Saviefe Agorkpo, Volta Region, Ghana

Owner / Primary Contact:
- Email: degboekwasielorm97@gmail.com
- Tel: 0246826309

For bookings, events, media or press inquiries, use the contact form on the website or reach out via the details above.

---

Thank you for contributing. For contributions, open an issue or submit a pull request with clear description and testing steps.