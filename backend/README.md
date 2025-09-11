# SalesWolf - Backend

A structured Express.js backend API for SalesWolf.

## 🏗️ Architecture

The backend follows a modular, scalable architecture with clear separation of concerns:

```
src/
├── index.js                 # Main application entry point
├── routes/                  # API route definitions
│   ├── api.js              # Main API router
│   ├── health.js           # Health check routes
│   └── ratioEstimator.js   # Ratio estimator routes
├── services/                # External service integrations
│   ├── openaiService.js    # OpenAI API integration
│   └── ratioEstimatorService.js
├── middleware/              # Custom middleware
│   ├── errorHandler.js     # Error handling middleware
│   └── logger.js           # Request logging middleware
├── projects/                # Project-specific modules
│   └── README.md           # Project documentation
├── helpers.js              # Utility functions
└── prompts.js              # AI prompts
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- OpenAI API key (optional)

### Installation

```bash
npm install
```

### Environment Setup

```bash
# Using 1Password CLI (recommended)
npm run env:setup

# Or manually create .env file
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PORT=7071
NODE_ENV=development
```

### Development

```bash
npm run dev
```

## 📡 API Endpoints

### Health Check

- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Detailed health information
- `GET /healthz` - Legacy health check

### Ratio Estimator

- `GET /api/ratio-estimator` - Project information
- `POST /api/ratio-estimator/estimate/initial` - Initial estimation
- `POST /api/ratio-estimator/estimate/postprocess` - Post-processing
- `POST /api/ratio-estimator/estimate/fix-rejections` - Fix rejections (planned)

## 🔧 Project Structure

### Routes

Routes define the API endpoints and handle HTTP requests, validation, and coordinate with services.

### Services

Services contain business logic and external API integrations.

### Middleware

Middleware handles cross-cutting concerns like logging, error handling, and authentication.

## 🆕 Adding New Projects

1. Create a new folder in `src/projects/`
2. Add project-specific routes, controllers, and services
3. Mount the routes in `src/routes/api.js`
4. Update the projects README

### Example Project Structure

```
projects/
├── new-project/
│   ├── controllers/
│   ├── services/
│   ├── routes/
│   └── README.md
```

## 🛠️ Development

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm start` - Start production server
- `npm test` - Run tests (when implemented)

### Logging

The application includes comprehensive logging:

- Request/response logging
- API-specific logging
- Error logging with stack traces

### Error Handling

Centralized error handling with:

- Consistent error response format
- Proper HTTP status codes
- Detailed error logging

## 🔒 Security

- CORS enabled for cross-origin requests
- Request size limits (10MB)
- Input validation
- Error message sanitization

## 📊 Monitoring

- Health check endpoints for monitoring
- Request logging for debugging
- Memory usage tracking
- Uptime monitoring

## 🚀 Deployment

The backend is designed to work with:

- Heroku (current deployment)
- Docker containers
- Traditional VPS hosting
- Serverless functions (with modifications)

## 🤝 Contributing

1. Follow the established project structure
2. Add appropriate error handling
3. Include logging for debugging
4. Write tests for new features
5. Update documentation
