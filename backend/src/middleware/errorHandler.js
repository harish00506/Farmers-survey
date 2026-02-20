/**
 * Global error handler middleware
 * Catches all errors and returns standardized error responses
 */
export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`❌ Error [${statusCode}]: ${message}`);
  if (err.stack) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    error: {
      code: statusCode,
      message,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * App error class for throwing errors with status codes
 */
export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}
