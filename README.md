# SymptoBridge AI — From Symptoms to the Right Specialist

A comprehensive healthcare platform with AI-powered symptom checking, doctor appointments, and telemedicine capabilities.

## 🏗️ Architecture

### Backend (Node.js + Express + MongoDB)
- **Authentication System** ✅ JWT-based with role-based access control
- **User Management** ✅ Patient, Doctor, Admin roles with verification
- **API Gateway** ✅ RESTful API with proper validation and error handling
- **Database** ✅ MongoDB with Mongoose ODM

### Frontend (Next.js + React + TypeScript)
- **Authentication UI** ✅ Login, Register, Password Reset pages
- **Role-based Navigation** ✅ Automatic redirection based on user role
- **Protected Routes** ✅ Auth guards and permissions
- **Modern UI/UX** ✅ Tailwind CSS with responsive design

### Shared Types
- **TypeScript Definitions** ✅ Shared types for frontend and backend
- **API Response Types** ✅ Consistent data structures

## 📋 Project Status

### ✅ Completed: Step 1 - Project Structure Setup
- [x] Monorepo structure (frontend, backend, shared)
- [x] TypeScript configuration
- [x] Package management and dependencies
- [x] Development environment setup

### ✅ Completed: Step 2 - Authentication & Role-based Access
- [x] **Backend Authentication System**
  - [x] User model with role-based fields (Patient, Doctor, Admin)
  - [x] JWT token management (access + refresh tokens)
  - [x] Password hashing with bcrypt
  - [x] Account lockout after failed attempts
  - [x] Email verification system
  - [x] Password reset functionality
  - [x] Rate limiting for auth endpoints
- [x] **Frontend Authentication**
  - [x] Authentication context and hooks
  - [x] Login/Register pages with validation
  - [x] Protected route components
  - [x] Role-based redirection
  - [x] Automatic token refresh
  - [x] Error handling and user feedback

### 🔄 Next Steps
- [ ] **Step 3**: Patient UI - Symptom checker (AI), map search, appointment booking
- [ ] **Step 4**: Doctor dashboard - calendar, history, prescriptions
- [ ] **Step 5**: Admin panel
- [ ] **Step 6**: Video calling integration
- [ ] **Step 7**: Payment system
- [ ] **Step 8**: Testing & optimization

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm 9+
- MongoDB (local or Atlas)
- Git

### Backend Setup
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your database URL and JWT secrets
npm run dev
```

### Frontend Setup
```bash
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local with your API URL
npm run dev
```

### Environment Variables

#### Backend (.env)
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/aidoc
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-super-secret-refresh-key
CLIENT_URL=http://localhost:3000
```

#### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 🔐 Authentication System Features

### Security Features
- **JWT Access + Refresh Tokens**: Short-lived access tokens with long-lived refresh tokens
- **Account Lockout**: Automatic lockout after 5 failed login attempts for 2 hours
- **Password Requirements**: Complex password validation
- **Rate Limiting**: Protection against brute force attacks
- **Email Verification**: Required for account activation

### Role-based Access Control
- **Patient**: Access to symptom checker, doctor search, appointments
- **Doctor**: Access to patient management, consultations, schedule
- **Admin**: Full platform management and analytics

### User Registration
- **Patients**: Basic registration with profile information
- **Doctors**: Extended registration with specialization, license, fees
- **Email Verification**: Required for all users
- **Doctor Verification**: Manual admin approval for doctors

## 🛠️ Development

### Available Scripts

#### Backend
```bash
npm run dev        # Start development server
npm run build      # Build TypeScript
npm run start      # Start production server
npm run lint       # Run ESLint
npm test           # Run tests
```

#### Frontend
```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run start      # Start production server
npm run lint       # Run ESLint
npm run type-check # TypeScript checking
```

### API Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/verify-email/:token` - Verify email
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `POST /api/auth/change-password` - Change password
- `GET /api/auth/me` - Get current user profile

## 🧪 Testing the Authentication System

1. **Start both servers**:
   ```bash
   # Terminal 1 - Backend
   cd backend && npm run dev
   
   # Terminal 2 - Frontend
   cd frontend && npm run dev
   ```

2. **Test Registration**:
   - Visit http://localhost:3000
   - Click "Get Started" or "Sign up here"
   - Try both Patient and Doctor registration
   - Verify form validation works

3. **Test Login**:
   - Use registered credentials
   - Verify role-based redirection
   - Test "Remember me" functionality

4. **Test Protected Routes**:
   - Try accessing /patient/dashboard without login
   - Verify automatic redirection to login page

## 🏥 User Personas

### Patient Portal Features
- AI-powered symptom checker
- Doctor search and filtering
- Appointment booking and management
- Video consultations
- Medical history and reports
- Prescription management
- Health reminders

### Doctor Portal Features
- Patient management dashboard
- Appointment scheduling
- Video consultation tools
- Prescription management
- Medical history access
- Revenue analytics
- Patient communication

### Admin Portal Features
- User management (patients, doctors)
- Doctor verification system
- Platform analytics and reporting
- Content management
- System configuration
- Support ticket management

## 📚 Technology Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: express-validator, Joi
- **Security**: bcryptjs, helmet, cors
- **Logging**: Winston
- **Development**: TypeScript, nodemon

### Frontend
- **Framework**: Next.js 14
- **UI Library**: React 18
- **Styling**: Tailwind CSS
- **Forms**: React Hook Form + Yup validation
- **HTTP Client**: Axios
- **State Management**: React Context
- **Notifications**: React Hot Toast
- **Icons**: Heroicons

### Shared
- **Language**: TypeScript
- **Type Definitions**: Shared interfaces and types
- **Utilities**: Common helper functions

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

**Note**: This is a development project. Do not use in production without proper security review and additional hardening.


### Admin Portal Features
- User management (patients, doctors)
- Doctor verification system
- Platform analytics and reporting
- Content management
- System configuration
- Support ticket management

## 📚 Technology Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: express-validator, Joi
- **Security**: bcryptjs, helmet, cors
- **Logging**: Winston
- **Development**: TypeScript, nodemon

### Frontend
- **Framework**: Next.js 14
- **UI Library**: React 18
- **Styling**: Tailwind CSS
- **Forms**: React Hook Form + Yup validation
- **HTTP Client**: Axios
- **State Management**: React Context
- **Notifications**: React Hot Toast
- **Icons**: Heroicons

### Shared
- **Language**: TypeScript
- **Type Definitions**: Shared interfaces and types
- **Utilities**: Common helper functions

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

**Note**: This is a development project. Do not use in production without proper security review and additional hardening.
