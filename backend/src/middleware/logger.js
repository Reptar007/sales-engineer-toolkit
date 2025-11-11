export const requestLogger = (req, res, next) => {
  // Log response when it finishes
  const originalSend = res.send;
  res.send = function (data) {
    originalSend.call(this, data);
  };

  next();
};

export const apiLogger = (req, res, next) => {
  next();
};
