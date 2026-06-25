export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, message: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return { valid: false, message: 'Invalid email format' };
  }

  return { valid: true };
}

export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }

  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }

  return { valid: true };
}

export function validateName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: 'Name is required' };
  }

  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: 'Name must be at least 2 characters' };
  }

  if (trimmed.length > 100) {
    return { valid: false, message: 'Name must not exceed 100 characters' };
  }

  return { valid: true };
}

export function validateObjectId(id, fieldName = 'ID') {
  if (!id) return { valid: false, message: `${fieldName} is required` };
  if (!/^[a-f\d]{24}$/i.test(id)) {
    return { valid: false, message: `Invalid ${fieldName}` };
  }
  return { valid: true };
}

export function validateProjectData(data) {
  const errors = [];

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
    errors.push('Project name must be at least 2 characters');
  }

  if (!data.workspaceId) {
    errors.push('Workspace ID is required');
  }

  const validStatuses = ['active', 'archived', 'completed', 'on_hold'];
  if (data.status && !validStatuses.includes(data.status)) {
    errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
  }

  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  if (data.priority && !validPriorities.includes(data.priority)) {
    errors.push(`Priority must be one of: ${validPriorities.join(', ')}`);
  }

  if (errors.length > 0) {
    return { valid: false, message: errors.join('; ') };
  }

  return { valid: true };
}

export function validateTaskData(data) {
  const errors = [];

  if (!data.title || typeof data.title !== 'string' || data.title.trim().length < 1) {
    errors.push('Task title is required');
  }

  const validStatuses = ['todo', 'in_progress', 'review', 'done'];
  if (data.status && !validStatuses.includes(data.status)) {
    errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
  }

  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  if (data.priority && !validPriorities.includes(data.priority)) {
    errors.push(`Priority must be one of: ${validPriorities.join(', ')}`);
  }

  if (errors.length > 0) {
    return { valid: false, message: errors.join('; ') };
  }

  return { valid: true };
}

export function validateDocumentData(data) {
  const errors = [];

  if (!data.title || typeof data.title !== 'string' || data.title.trim().length < 1) {
    errors.push('Document title is required');
  }

  if (!data.projectId) {
    errors.push('Project ID is required');
  }

  const validFormats = ['html', 'markdown', 'plain'];
  if (data.contentFormat && !validFormats.includes(data.contentFormat)) {
    errors.push(`Content format must be one of: ${validFormats.join(', ')}`);
  }

  if (errors.length > 0) {
    return { valid: false, message: errors.join('; ') };
  }

  return { valid: true };
}

export function validateRegistration(data) {
  const errors = [];

  const nameCheck = validateName(data.name);
  if (!nameCheck.valid) errors.push(nameCheck.message);

  const emailCheck = validateEmail(data.email);
  if (!emailCheck.valid) errors.push(emailCheck.message);

  const passwordCheck = validatePassword(data.password);
  if (!passwordCheck.valid) errors.push(passwordCheck.message);

  if (errors.length > 0) {
    return { valid: false, message: errors.join('; ') };
  }

  return { valid: true };
}
