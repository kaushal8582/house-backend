import logger from '../utils/logger.js';

export class AppError extends Error {
  constructor(message, statusCode = 500, errors = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message || 'Validation failed', 400, errors);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized. Please log in.') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists.') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

function formatMongoDuplicateKeyError(err) {
  const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
  return {
    statusCode: 409,
    message: `Duplicate value for ${field}. Please use a different value.`,
    errors: [{ field, message: `${field} already exists` }],
  };
}

function formatMongoValidationError(err) {
  const errors = Object.values(err.errors || {}).map((e) => ({
    field: e.path,
    message: e.message,
  }));
  return {
    statusCode: 400,
    message: errors.map((e) => e.message).join('; ') || 'Validation failed',
    errors,
  };
}

function formatCastError(err) {
  return {
    statusCode: 400,
    message: `Invalid ${err.path}: ${err.value}`,
    errors: [{ field: err.path, message: `Invalid ${err.path}` }],
  };
}

function formatJwtError(err) {
  if (err.name === 'TokenExpiredError') {
    return { statusCode: 401, message: 'Token expired. Please log in again.' };
  }
  return { statusCode: 401, message: 'Invalid token. Please log in again.' };
}

export function notFound(req, _res, next) {
  next(new NotFoundError(`Route ${req.originalUrl}`));
}

export function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let errors = err.errors || null;

  if (err.isJoi) {
    statusCode = 400;
    message = 'Validation failed';
    errors = err.details.map((detail) => ({
      field: detail.path.join('.'),
      message: detail.message.replace(/"/g, ''),
    }));
  } else if (err instanceof ValidationError) {
    statusCode = 400;
    errors = err.errors;
  } else if (err.code === 11000) {
    const formatted = formatMongoDuplicateKeyError(err);
    statusCode = formatted.statusCode;
    message = formatted.message;
    errors = formatted.errors;
  } else if (err.name === 'ValidationError' && err.errors) {
    const formatted = formatMongoValidationError(err);
    statusCode = formatted.statusCode;
    message = formatted.message;
    errors = formatted.errors;
  } else if (err.name === 'CastError') {
    const formatted = formatCastError(err);
    statusCode = formatted.statusCode;
    message = formatted.message;
    errors = formatted.errors;
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    const formatted = formatJwtError(err);
    statusCode = formatted.statusCode;
    message = formatted.message;
  } else if (err.name === 'MongoServerError' && err.code === 73) {
    statusCode = 500;
    message = 'Database configuration error. Check MONGODB_URI and MONGODB_DB_NAME.';
  }

  const logPayload = {
    statusCode,
    message,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id,
    stack: err.stack,
  };

  if (statusCode >= 500) {
    logger.error(logPayload, 'Unhandled server error');
  } else if (statusCode >= 400) {
    logger.warn(logPayload, 'Client error');
  }

  const response = {
    success: false,
    message,
    ...(errors && errors.length > 0 && { errors }),
  };

  res.status(statusCode).json(response);
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
