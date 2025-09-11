export const errorHandler = (err, req, res) => {
  console.error('Error:', err);

  // Default error
  let status = 500;
  let message = 'Internal Server Error';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    status = 400;
    message = err.message;
  } else if (err.name === 'UnauthorizedError') {
    status = 401;
    message = 'Unauthorized';
  } else if (err.name === 'ForbiddenError') {
    status = 403;
    message = 'Forbidden';
  } else if (err.name === 'NotFoundError') {
    status = 404;
    message = 'Not Found';
  } else if (err.message) {
    message = err.message;
  }

  res.status(status).json({
    error: message,
    status,
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  });
};

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    status: 404,
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  });
};
