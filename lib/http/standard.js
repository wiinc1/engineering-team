class StandardHttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

class AuthenticationError extends StandardHttpError {
  constructor(message = 'Authentication required', details) {
    super(401, 'authentication_required', message, details);
  }
}

class AuthorizationError extends StandardHttpError {
  constructor(message = 'Forbidden', details) {
    super(403, 'forbidden', message, details);
  }
}

class NotFoundError extends StandardHttpError {
  constructor(message = 'Not found', details) {
    super(404, 'not_found', message, details);
  }
}

class ValidationError extends StandardHttpError {
  constructor(message = 'Validation failed', details) {
    super(400, 'validation_error', message, details);
  }
}

class ConflictError extends StandardHttpError {
  constructor(message = 'Conflict', details) {
    super(409, 'conflict', message, details);
  }
}

function validateRequest(body, schema = {}) {
  const normalized = body && typeof body === 'object' ? body : {};
  const errors = [];

  for (const field of schema.required || []) {
    if (normalized[field] === undefined) {
      errors.push({ field, message: 'is required' });
    }
  }

  for (const [field, rule] of Object.entries(schema.properties || {})) {
    if (normalized[field] === undefined || normalized[field] === null) continue;
    if (rule.type === 'string' && typeof normalized[field] !== 'string') {
      errors.push({ field, message: 'must be a string' });
    }
    if (rule.type === 'integer' && !Number.isInteger(normalized[field])) {
      errors.push({ field, message: 'must be an integer' });
    }
    if (rule.enum && !rule.enum.includes(normalized[field])) {
      errors.push({ field, message: `must be one of: ${rule.enum.join(', ')}` });
    }
  }

  if (errors.length) {
    throw new ValidationError('Request body failed validation', { errors });
  }

  return normalized;
}

function withErrorHandling(handler) {
  return async function wrapped(context) {
    return handler(context);
  };
}

module.exports = {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  StandardHttpError,
  ValidationError,
  validateRequest,
  withErrorHandling,
};
