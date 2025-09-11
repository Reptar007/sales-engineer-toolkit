# SalesWolf

A comprehensive toolkit for sales engineers with ratio estimation capabilities, featuring a React frontend and Express.js backend.

## 🏗️ Project Structure

```
sales-engineer-toolkit/
├── backend/                    # Express.js API server
│   ├── src/
│   │   ├── index.js           # Main server file
│   │   ├── routes/            # API routes
│   │   │   ├── api.js         # Main API router
│   │   │   └── health.js      # Health check routes
│   │   ├── services/          # Shared services
│   │   │   └── openaiService.js
│   │   ├── middleware/        # Custom middleware
│   │   ├── projects/          # Project-specific modules
│   │   │   └── ratio-estimator/
│   │   │       └── routes/    # Project routes with business logic
│   │   ├── helpers.js         # Utility functions
│   │   └── prompts.js         # AI prompts
│   └── package.json
├── frontend/                   # React application
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── styles/
│   │   └── utils/
│   └── package.json
├── scripts/                    # Helper scripts
│   └── setup-env.sh           # Environment setup
├── package.json               # Root dependencies and scripts
└── .env.example               # Environment template
```

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher)
- npm (v8 or higher)

### Installation

```bash
# Install all dependencies (root, backend, and frontend)
npm run install:all
```

### Environment Setup

#### Option 1: Using 1Password CLI (Recommended)

This project is configured to use 1Password CLI for secure environment variable management.

1. **Install 1Password CLI** (if not already installed):

   ```bash
   brew install --cask 1password-cli
   ```

2. **Sign in to 1Password**:

   ```bash
   op signin
   ```

3. **Set up environment variables** (one-time setup):

   ```bash
   npm run env:setup
   ```

   Or to refresh existing environment variables:

   ```bash
   npm run env:refresh
   ```

This will automatically inject the API keys from your 1Password vault into a `.env` file.

#### Option 2: Manual Setup

Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PORT=7071
```

**Note**: The app will work without an OpenAI API key, but ratio estimation features will be disabled.

### Development

```bash
# Run both backend and frontend in development mode
npm run dev

# Or run them separately:
npm run dev:backend  # Backend API on port 7071
npm run dev:frontend # Frontend on port 5173
```

### Production

```bash
# Build the frontend
npm run build

# Start the backend server
npm start
```

## 📜 Available Scripts

### Development

- **`dev`** – Runs both backend and frontend concurrently
- **`dev:backend`** – Runs only the backend API server
- **`dev:frontend`** – Runs only the frontend development server

### Production

- **`start`** – Starts the backend server in production mode
- **`build`** – Builds the frontend for production
- **`preview`** – Previews the built frontend

### Testing

- **`test`** – Runs frontend unit tests
- **`test:ui`** – Opens Vitest UI for interactive testing
- **`test:coverage`** – Runs tests with coverage report
- **`test:a11y`** – Runs accessibility tests
- **`test:visual`** – Runs visual regression tests
- **`test:e2e`** – Runs end-to-end tests with Playwright
- **`test:ci`** – Runs tests suitable for CI environments
- **`test:all`** – Runs all test suites

### Code Quality

- **`format`** – Formats all files with Prettier
- **`format:check`** – Checks file formatting without modifying files
- **`lint`** – Runs ESLint across the entire project
- **`lint:fix`** – Runs ESLint and automatically fixes issues

## 🛠️ Backend API

The backend provides a REST API for ratio estimation:

### Health Check

- **GET** `/api/health` – Basic health check
- **GET** `/api/health/detailed` – Detailed health information

### Ratio Estimator

- **GET** `/api/ratio-estimator` – Project information
- **POST** `/api/ratio-estimator/estimate/initial` – Initial AI estimation
- **POST** `/api/ratio-estimator/estimate/postprocess` – Post-processing
- **POST** `/api/ratio-estimator/estimate/fix-rejections` – Fix rejections (planned)

### Environment Variables

The backend looks for environment variables in this order:

1. `backend/.env`
2. Root `.env`
3. System environment variables

Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PORT=7071
```

**Note**: If no OpenAI API key is provided, the app will still start but ratio estimation endpoints will return a 503 error.

## 🎨 Frontend

The frontend is a React application built with Vite, featuring:

- Modern UI with theme support (light/dark)
- CSV file upload and processing
- Real-time data visualization
- Responsive design
- Comprehensive testing suite

## 🚀 Deployment

### Heroku Deployment

This project is configured for Heroku deployment:

1. **Build Process**: The `build` script installs all dependencies and builds the frontend
2. **Start Command**: Uses `npm start` to run the backend server
3. **Static Files**: The backend serves the built frontend files from `frontend/dist`
4. **Environment**: Set `OPENAI_API_KEY` in Heroku config vars

**Deploy to Heroku:**

```bash
# Login to Heroku
heroku login

# Create a new app (if needed)
heroku create your-app-name

# Set environment variables
heroku config:set OPENAI_API_KEY=your_key_here

# Deploy
git push heroku main
```

### Production Notes

- The app uses Node.js 18+ and npm 8+
- Frontend is built with Vite and served as static files
- Backend uses Express.js with CORS enabled
- All API routes are prefixed (e.g., `/estimate/initial`)
- Non-API routes serve the React app

## 🧹 Pre-Commit Automation

This project uses **Husky** + **lint-staged** to maintain code quality:

- **Prettier** formats staged files automatically
- **ESLint** lints and fixes JavaScript files
- Commits are blocked if code doesn't meet quality standards

## 🔧 Troubleshooting

### Common Issues

**"Application Error" on Heroku:**

- Check Heroku logs: `heroku logs --app your-app-name`
- Ensure all dependencies are installed: `npm run install:all`
- Verify the build process: `npm run build`

**Frontend not loading:**

- The backend serves static files from `frontend/dist`
- Ensure the frontend is built: `npm run build`
- Check that the `frontend/dist` directory exists

**OpenAI API errors:**

- Verify your API key is set correctly
- Check that the model name is valid (e.g., `gpt-4o-mini`)
- The app will work without an API key but estimation features will be disabled

**Build failures:**

- Clear node_modules and reinstall: `rm -rf node_modules package-lock.json && npm run install:all`
- Check Node.js version: `node --version` (should be 18+)

## 📦 Dependencies

- **Backend**: Express.js, OpenAI API, CORS, Socket.io, serve-static
- **Frontend**: React, Vite, Less, Testing Library, Playwright
- **Development**: ESLint, Prettier, Husky, Concurrently

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:all`
5. Commit your changes (pre-commit hooks will run automatically)
6. Push to your branch and create a Pull Request

## 📄 License

ISC
