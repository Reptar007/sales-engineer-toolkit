# Sales Engineer Toolkit

A comprehensive toolkit for sales engineers with ratio estimation capabilities, featuring a React frontend and Express.js backend.

## 🏗️ Project Structure

```
sales-engineer-toolkit/
├── backend/          # Express.js API server
│   ├── src/
│   │   ├── index.js  # Main server file
│   │   ├── helpers.js
│   │   └── prompts.js
│   └── package.json
├── frontend/         # React application
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── styles/
│   │   └── utils/
│   ├── tests/
│   └── package.json
├── package.json      # Root dependencies and scripts
└── test-data.csv
```

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher)
- npm

### Installation

```bash
# Install all dependencies (root, backend, and frontend)
npm run install:all
```

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

- **GET** `/healthz` – Health check endpoint
- **POST** `/estimate/initial` – Initial ratio estimation
- **POST** `/estimate/postprocess` – Post-process CSV data
- **POST** `/estimate/fix-rejections` – Fix rejected rows (planned)

### Environment Variables

Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PORT=7071
```

## 🎨 Frontend

The frontend is a React application built with Vite, featuring:

- Modern UI with theme support (light/dark)
- CSV file upload and processing
- Real-time data visualization
- Responsive design
- Comprehensive testing suite

## 🧹 Pre-Commit Automation

This project uses **Husky** + **lint-staged** to maintain code quality:

- **Prettier** formats staged files automatically
- **ESLint** lints and fixes JavaScript files
- Commits are blocked if code doesn't meet quality standards

## 📦 Dependencies

- **Backend**: Express.js, OpenAI API, CORS, Socket.io
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
