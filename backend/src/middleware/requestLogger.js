/**
 * Request logger middleware for all HTTP requests
 */
export const requestLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const { method, path, query, body } = req;

  console.log(`[${timestamp}] ${method} ${path}`);
  if (Object.keys(query).length > 0) {
    console.log(`  Query: ${JSON.stringify(query)}`);
  }
  if (body && Object.keys(body).length > 0) {
    console.log(`  Body: ${JSON.stringify(body)}`);
  }

  // Track response time
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`  Response: ${res.statusCode} (${duration}ms)`);
  });

  next();
};
