export const requestLogger = (req, res, next) => {
  const { method, url, ip } = req;
  const timestamp = new Date().toISOString();

  console.log(`${timestamp} ${method} ${url} - ${ip}`);

  // Log response when it finishes
  const originalSend = res.send;
  res.send = function (data) {
    console.log(`${timestamp} ${method} ${url} - ${res.statusCode}`);
    originalSend.call(this, data);
  };

  next();
};

export const apiLogger = (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const { method, url, body } = req;
    const timestamp = new Date().toISOString();

    console.log(`[API] ${timestamp} ${method} ${url}`);

    if (body && Object.keys(body).length > 0) {
      console.log(`[API] Request body keys: ${Object.keys(body).join(', ')}`);
    }
  }

  next();
};
