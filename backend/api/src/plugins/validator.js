const fp = require("fastify-plugin");

// Input sanitization utilities
const sanitizeString = (value) => {
  if (typeof value !== "string") return value;
  // Remove null bytes and other dangerous characters
  return value
    .replace(/\0/g, "")
    .trim()
    .substring(0, 10000); // Limit string length
};

const sanitizeEmail = (email) => {
  if (typeof email !== "string") return email;
  const sanitized = email.toLowerCase().trim().substring(0, 255);
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized)) {
    throw new Error("Invalid email format");
  }
  return sanitized;
};

const sanitizeInput = (data, schema) => {
  const sanitized = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (!schema[key]) continue; // Ignore unknown fields
    
    const rules = schema[key];
    
    if (rules.type === "string") {
      sanitized[key] = sanitizeString(value);
    } else if (rules.type === "email") {
      sanitized[key] = sanitizeEmail(value);
    } else if (rules.type === "number") {
      const num = Number(value);
      if (isNaN(num)) continue;
      sanitized[key] = num;
    } else if (rules.type === "boolean") {
      sanitized[key] = Boolean(value);
    } else if (rules.type === "array") {
      if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          rules.items === "string" ? sanitizeString(item) : item
        );
      }
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

const createValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const validateInput = (schema, data = {}) => {
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const isMissing = value === undefined || value === null;

    if (rules.required && isMissing) {
      throw createValidationError(`Field '${field}' is required`);
    }

    if (isMissing) {
      continue;
    }

    if (rules.type === "string" && typeof value !== "string") {
      throw createValidationError(`Field '${field}' must be a string`);
    }

    if (rules.type === "number" && typeof value !== "number") {
      throw createValidationError(`Field '${field}' must be a number`);
    }

    if (rules.type === "boolean" && typeof value !== "boolean") {
      throw createValidationError(`Field '${field}' must be a boolean`);
    }

    if (rules.type === "array" && !Array.isArray(value)) {
      throw createValidationError(`Field '${field}' must be an array`);
    }

    if (rules.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
      throw createValidationError(`Field '${field}' must be an object`);
    }

    if (rules.type === "array" && rules.items === "string" && !value.every((item) => typeof item === "string")) {
      throw createValidationError(`Field '${field}' must contain only strings`);
    }

    if (rules.minLength && typeof value === "string" && value.length < rules.minLength) {
      throw createValidationError(`Field '${field}' must be at least ${rules.minLength} characters`);
    }

    if (rules.maxLength && typeof value === "string" && value.length > rules.maxLength) {
      throw createValidationError(`Field '${field}' must be at most ${rules.maxLength} characters`);
    }

    if (rules.minItems && Array.isArray(value) && value.length < rules.minItems) {
      throw createValidationError(`Field '${field}' must contain at least ${rules.minItems} items`);
    }

    if (rules.maxItems && Array.isArray(value) && value.length > rules.maxItems) {
      throw createValidationError(`Field '${field}' must contain at most ${rules.maxItems} items`);
    }

    if (rules.enum && !rules.enum.includes(value)) {
      throw createValidationError(`Field '${field}' must be one of: ${rules.enum.join(", ")}`);
    }
  }
};

async function validatorPlugin(fastify) {
  fastify.decorate("sanitize", sanitizeInput);
  fastify.decorate("validate", validateInput);
  return fastify;
}

const plugin = fp(validatorPlugin, {
  name: "qaira-validator"
});

plugin.validateInput = validateInput;
module.exports = plugin;
