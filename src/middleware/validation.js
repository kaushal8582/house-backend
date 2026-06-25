import Joi from 'joi';
import { sanitizeString, sanitizeHtml, sanitizeObject } from '../utils/sanitize.js';
import { ValidationError } from './errorHandler.js';

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': '{{#label}} must be a valid ID',
  'string.length': '{{#label}} must be a valid ID',
});

const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[A-Z]/, 'uppercase')
  .pattern(/[a-z]/, 'lowercase')
  .pattern(/[0-9]/, 'number')
  .messages({
    'string.min': 'Password must be at least 8 characters',
    'string.pattern.name': 'Password must contain at least one {#name} character',
  });

const email = Joi.string().email({ tlds: { allow: false } }).trim().lowercase().max(255);

const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};

export const schemas = {
  register: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: email.required(),
    password: password.required(),
  }),

  login: Joi.object({
    email: email.required(),
    password: Joi.string().required().messages({ 'any.required': 'Password is required' }),
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required(),
  }),

  profileUpdate: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    email: email,
    avatar: Joi.string().uri().allow('', null),
    preferences: Joi.object({
      theme: Joi.string().valid('light', 'dark', 'system'),
      notifications: Joi.boolean(),
    }),
  }).min(1),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: password.required(),
  }),

  forgotPassword: Joi.object({
    email: email.required(),
  }),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: password.required(),
  }),

  createProject: Joi.object({
    name: Joi.string().trim().min(2).max(200).required(),
    description: Joi.string().trim().max(5000).allow('', null),
    workspaceId: objectId.required(),
    status: Joi.string().valid('active', 'archived', 'completed', 'on_hold'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow('', null),
    dueDate: Joi.date().iso().allow(null),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
  }),

  updateProject: Joi.object({
    name: Joi.string().trim().min(2).max(200),
    description: Joi.string().trim().max(5000).allow('', null),
    status: Joi.string().valid('active', 'archived', 'completed', 'on_hold'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow('', null),
    dueDate: Joi.date().iso().allow(null),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
    isFavorite: Joi.boolean(),
  }).min(1),

  projectQuery: Joi.object({
    workspaceId: objectId.required(),
    status: Joi.string().valid('active', 'archived', 'completed', 'on_hold'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    search: Joi.string().trim().max(200),
    archived: Joi.boolean(),
    favorite: Joi.boolean(),
    ...pagination,
  }),

  addTeamMember: Joi.object({
    userId: objectId.required(),
    role: Joi.string().valid('viewer', 'member', 'admin').default('member'),
  }),

  changeMemberRole: Joi.object({
    role: Joi.string().valid('viewer', 'member', 'admin').required(),
  }),

  inviteWorkspaceMember: Joi.object({
    email: email.required(),
    role: Joi.string().valid('viewer', 'member', 'admin').default('member'),
    name: Joi.string().trim().min(2).max(100),
    password,
  }),

  changeWorkspaceMemberRole: Joi.object({
    role: Joi.string().valid('viewer', 'member', 'admin').required(),
  }),

  createTask: Joi.object({
    title: Joi.string().trim().min(1).max(500).required(),
    description: Joi.string().trim().max(10000).allow('', null),
    projectId: objectId.required(),
    status: Joi.string().valid('todo', 'in_progress', 'review', 'done'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    assigneeId: objectId.allow(null),
    dueDate: Joi.date().iso().allow(null),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
    estimatedHours: Joi.number().min(0).max(1000),
  }),

  updateTask: Joi.object({
    projectId: objectId,
    title: Joi.string().trim().min(1).max(500),
    description: Joi.string().trim().max(10000).allow('', null),
    status: Joi.string().valid('todo', 'in_progress', 'review', 'done'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    assigneeId: objectId.allow(null),
    dueDate: Joi.date().iso().allow(null),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
    estimatedHours: Joi.number().min(0).max(1000),
    position: Joi.number().integer().min(0),
  }).min(1),

  taskQuery: Joi.object({
    projectId: objectId.required(),
    status: Joi.string().valid('todo', 'in_progress', 'review', 'done'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    assigneeId: objectId,
    search: Joi.string().trim().max(200),
    ...pagination,
  }),

  assignTask: Joi.object({
    projectId: objectId,
    assigneeId: objectId.allow(null).required(),
  }),

  updateTaskStatus: Joi.object({
    projectId: objectId,
    status: Joi.string().valid('todo', 'in_progress', 'review', 'done').required(),
    position: Joi.number().integer().min(0),
  }),

  addSubtask: Joi.object({
    projectId: objectId,
    title: Joi.string().trim().min(1).max(500).required(),
  }),

  addComment: Joi.object({
    projectId: objectId,
    content: Joi.string().trim().min(1).max(5000).required(),
  }),

  createDocument: Joi.object({
    title: Joi.string().trim().min(1).max(500).required(),
    content: Joi.string().max(500000).allow('', null),
    contentFormat: Joi.string().valid('html', 'markdown', 'plain').default('html'),
    projectId: objectId.required(),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
  }),

  updateDocument: Joi.object({
    title: Joi.string().trim().min(1).max(500),
    content: Joi.string().max(500000),
    contentFormat: Joi.string().valid('html', 'markdown', 'plain'),
    createVersion: Joi.boolean(),
    changeNote: Joi.string().trim().max(500).allow('', null),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20),
  }).min(1),

  autoSaveDocument: Joi.object({
    content: Joi.string().max(500000).required(),
    expectedVersion: Joi.number().integer().min(1),
  }),

  documentQuery: Joi.object({
    projectId: objectId.required(),
    search: Joi.string().trim().max(200),
    ...pagination,
  }),

  documentSearch: Joi.object({
    q: Joi.string().trim().min(1).max(200).required(),
    projectId: objectId,
    workspaceId: objectId,
    ...pagination,
  }),

  addCollaborator: Joi.object({
    userId: Joi.alternatives().try(objectId, email).required(),
    permission: Joi.string().valid('read', 'write', 'owner', 'view', 'edit', 'comment').default('read'),
  }),

  shareDocument: Joi.object({
    permission: Joi.string().valid('view', 'edit', 'read', 'write').default('view'),
    expiresInHours: Joi.number().integer().min(1).max(720).default(72),
  }),

  exportDocument: Joi.object({
    format: Joi.string().valid('html', 'json', 'markdown').default('html'),
  }),

  analyticsQuery: Joi.object({
    workspaceId: objectId,
    projectId: objectId,
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().when('startDate', {
      is: Joi.exist(),
      then: Joi.date().greater(Joi.ref('startDate')),
    }),
    period: Joi.string().valid('day', 'week', 'month', 'quarter', 'year'),
    ...pagination,
  }),

  objectIdParam: Joi.object({
    workspaceId: objectId,
    projectId: objectId,
    taskId: objectId,
    documentId: objectId,
    versionId: objectId,
    notificationId: objectId,
    userId: objectId,
    token: Joi.string().min(10).max(500),
  }),
};

const HTML_FIELDS = ['content', 'description'];

function sanitizeValue(key, value) {
  if (typeof value !== 'string') return value;
  if (HTML_FIELDS.includes(key)) return sanitizeHtml(value);
  return sanitizeString(value);
}

function sanitizeBody(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value;
    } else if (typeof value === 'string') {
      result[key] = sanitizeValue(key, value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string' ? sanitizeString(item) : item
      );
    } else if (typeof value === 'object') {
      result[key] = sanitizeBody(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function sanitizeRequest(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeBody(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        req.query[key] = sanitizeString(value, 500);
      }
    }
  }
  next();
}

function formatJoiErrors(error) {
  return error.details.map((detail) => ({
    field: detail.path.join('.') || 'body',
    message: detail.message.replace(/"/g, ''),
  }));
}

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const data = source === 'params'
      ? req.params
      : source === 'query'
        ? req.query
        : req.body;

    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: source === 'body',
      convert: true,
    });

    if (error) {
      const errors = formatJoiErrors(error);
      return next(new ValidationError('Validation failed', errors));
    }

    if (source === 'body') req.body = value;
    else if (source === 'query') req.query = { ...req.query, ...value };
    else if (source === 'params') req.params = { ...req.params, ...value };

    next();
  };
}

export function validateObjectIdParam(...paramNames) {
  return (req, _res, next) => {
    const errors = [];
    for (const name of paramNames) {
      const value = req.params[name];
      if (!value) continue;
      const { error } = objectId.validate(value);
      if (error) {
        errors.push({ field: name, message: `Invalid ${name}` });
      }
    }
    if (errors.length > 0) {
      return next(new ValidationError('Invalid parameters', errors));
    }
    next();
  };
}

export const validateRegistrationBody = validate(schemas.register);
export const validateLoginBody = validate(schemas.login);
export const validateProfileUpdate = validate(schemas.profileUpdate);
export const validatePasswordChange = validate(schemas.changePassword);
export const validateForgotPassword = validate(schemas.forgotPassword);
export const validateResetPassword = validate(schemas.resetPassword);

export { sanitizeObject };
