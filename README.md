# SymptoBridge AI — From Symptoms to the Right Specialist
https://symptobridge-ai.onrender.com/

A multi-specialty telemedicine platform: AI-powered symptom triage that routes patients to the
right specialist, doctor discovery with geo-search, appointment booking, real-time video
consultations, prescriptions, and payments.

## 🏗️ Architecture

A monorepo of three independently deployable services:

| Service | Stack | Responsibility |
|---------|-------|----------------|
| **Frontend** | Next.js (static export) · React · TypeScript · Tailwind CSS | Patient / Doctor / Admin SPAs |
| **Backend API** | Node.js · Express · MongoDB (Mongoose) · Socket.IO | REST API, auth, real-time signaling & push |
| **ML service** | Python · FastAPI · NumPy | Trained triage model with information-gain question selection |

### How the AI triage works
The triage engine is a **trained Bayesian model**, not a wrapper around a third-party LLM. It
maintains a posterior over conditions and, at each step, asks the single question with the highest
**information gain** (expected reduction in entropy) — so it reaches a confident specialist
recommendation in as few questions as possible. The Node API proxies to the Python service
(`ML_SERVICE_URL`); the model does the inference.

### Real-time layer
Video consultations use **WebRTC** (peer-to-peer media) with **Socket.IO** as the signaling
server — SDP offer/answer and ICE candidates are relayed through the backend, while audio/video
flows directly between browsers. The same socket layer pushes notifications and “call ringing”
events instantly, replacing polling.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm 9+
- MongoDB (local or Atlas)
- Python 3.10+ (for the ML service)

### Backend API
```bash
cd backend
npm install
cp .env.example .env          # set MONGODB_URI, JWT secrets, ML_SERVICE_URL
npm run dev
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local    # set NEXT_PUBLIC_API_URL
npm run dev
```

### ML service
```bash
cd ml-service
pip install -r requirements.txt
python train.py               # trains and saves the model
uvicorn app:app --port 8001
```

### Environment Variables

**Backend (`.env`)**
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/symptobridge
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-super-secret-refresh-key
CLIENT_URL=http://localhost:3000
ML_SERVICE_URL=http://localhost:8001
REDIS_URL=            # optional — enables distributed rate limiting & the Redis event bus
```

**Frontend (`.env.local`)**
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

## 🔐 Security & Reliability
- **JWT access + refresh tokens** with automatic, transparent refresh
- **Account lockout** after repeated failed logins; **bcrypt** password hashing
- **Rate limiting** — Redis-backed when `REDIS_URL` is set (holds across instances), in-memory otherwise
- **`trust proxy`** configured for correct client-IP handling behind a load balancer
- **Observability** — request-ID tracing, structured logs, and a Prometheus `/metrics` endpoint
- **Graceful degradation** — the app runs without Redis (in-process fallbacks) and survives a cold ML service

## 👥 Roles
- **Patient** — symptom triage, doctor search, appointments, video consults, prescriptions, records
- **Doctor** — schedule & availability, appointments, consultations, prescriptions, revenue overview
- **Admin** — user & doctor management, verification, platform analytics

## 🛠️ Development

**Backend**
```bash
npm run dev        # start with reload
npm run build      # compile TypeScript
npm run start      # run compiled server
npm run lint       # ESLint
npm test           # Jest
npm run seed       # seed demo accounts & doctors
```

**Frontend**
```bash
npm run dev        # start dev server
npm run build      # static export to out/
npm run lint       # ESLint
npm run type-check # tsc --noEmit
```

### Key API Endpoints
```
POST /api/auth/register            Register (patient / doctor)
POST /api/auth/login               Login
POST /api/auth/refresh             Refresh access token
GET  /api/auth/me                  Current user
GET  /api/users/doctors            Doctor search (geo + filters)
POST /api/ai/triage                Run a triage step
POST /api/appointments             Book an appointment
POST /api/payments                 Create a payment
POST /api/video-calls              Start a video call
GET  /metrics                      Prometheus metrics
GET  /health                       Health check
```

## 📚 Technology Stack

**Backend** — Node.js, Express, MongoDB/Mongoose, Socket.IO, JWT, bcryptjs, helmet, Winston,
ioredis, prom-client, TypeScript

**Frontend** — Next.js, React, Tailwind CSS, React Hook Form + Yup, Axios, React Context,
React Hot Toast, Heroicons

**ML service** — Python, FastAPI, NumPy, pytest

## 🤝 Contributing
1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License
Licensed under the MIT License — see the LICENSE file for details.
