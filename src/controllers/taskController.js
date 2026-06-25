import { Project } from '../models/Project.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validateTaskData } from '../utils/validators.js';
import { sanitizeString } from '../utils/sanitize.js';
import { auditLog } from '../utils/auditLog.js';
import { cacheDeletePattern } from '../utils/cache.js';
import { emitToProject, broadcastProjectActivity } from '../utils/socketEmitter.js';
import { sendNotification } from '../socket/index.js';

function getProjectId(req) {
  return req.projectId || req.params.projectId || req.body.projectId || req.query.projectId;
}

function invalidateTaskCache(projectId, workspaceId) {
  cacheDeletePattern(`project:${projectId}`);
  cacheDeletePattern(`project-stats:${projectId}`);
  if (workspaceId) cacheDeletePattern(`projects:${workspaceId}`);
}

async function getProjectOrFail(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw new AppError('Project not found', 404);
  return project;
}

async function logTaskAudit(req, project, taskId, action, metadata = {}, changes = null) {
  await auditLog(req, {
    action,
    entityType: 'task',
    entityId: taskId,
    workspaceId: project.workspaceId,
    projectId: project._id,
    metadata,
    changes,
  });
}

function normalizeTaskBody(body = {}) {
  const normalized = { ...body };
  if (normalized.assigneeId !== undefined && normalized.assignee === undefined) {
    normalized.assignee = normalized.assigneeId;
  }
  if (normalized.content !== undefined && normalized.text === undefined) {
    normalized.text = normalized.content;
  }
  return normalized;
}

function normalizeTaskRequest(req) {
  req.body = normalizeTaskBody(req.body);
  if (req.query.assigneeId && !req.query.assignee) {
    req.query.assignee = req.query.assigneeId;
  }
}

export const createTask = asyncHandler(async (req, res) => {
  normalizeTaskRequest(req);
  const projectId = getProjectId(req);
  const data = {
    ...req.body,
    title: sanitizeString(req.body.title, 500),
    description: sanitizeString(req.body.description, 5000),
    createdBy: req.user.id,
  };

  const validation = validateTaskData(data);
  if (!validation.valid) throw new AppError(validation.message, 400);

  const project = await getProjectOrFail(projectId);
  const { project: updated, task } = await Project.addTask(projectId, data);

  await Project.pushTaskHistory(projectId, task._id, {
    action: 'created',
    userId: req.user.id,
    details: { title: task.title },
  });

  await logTaskAudit(req, project, task._id, 'task.created', { title: task.title });
  invalidateTaskCache(projectId, project.workspaceId.toString());

  emitToProject(projectId, 'task-created', {
    projectId,
    task,
    createdBy: { id: req.user.id, name: req.user.email },
    timestamp: new Date().toISOString(),
  });
  broadcastProjectActivity(projectId, project.workspaceId.toString(), {
    type: 'task-created',
    task,
    userId: req.user.id,
  });

  res.status(201).json({ success: true, data: { task, projectId } });
});

export const getTasks = asyncHandler(async (req, res) => {
  normalizeTaskRequest(req);
  const projectId = getProjectId(req);
  await getProjectOrFail(projectId);

  const filters = {
    status: req.query.status,
    priority: req.query.priority,
    assignee: req.query.assignee,
    search: req.query.search,
  };

  const tasks = await Project.getTasks(projectId, filters);
  res.json({ success: true, data: { tasks, total: tasks.length } });
});

export const getTaskById = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  const { taskId } = req.params;

  await getProjectOrFail(projectId);
  const task = await Project.getTaskById(projectId, taskId);
  if (!task) throw new AppError('Task not found', 404);

  res.json({ success: true, data: { task } });
});

export const updateTask = asyncHandler(async (req, res) => {
  normalizeTaskRequest(req);
  const projectId = getProjectId(req);
  const { taskId } = req.params;
  const project = await getProjectOrFail(projectId);

  const allowed = ['title', 'description', 'status', 'priority', 'assignee', 'dueDate', 'tags', 'position', 'timeSpent'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates[field] = typeof req.body[field] === 'string'
        ? sanitizeString(req.body[field], field === 'description' ? 5000 : 500)
        : req.body[field];
    }
  }

  if (Object.keys(updates).length === 0) throw new AppError('No valid fields to update', 400);

  const { task } = await Project.updateTask(projectId, taskId, updates);

  await Project.pushTaskHistory(projectId, taskId, {
    action: 'updated',
    userId: req.user.id,
    details: updates,
  });

  await logTaskAudit(req, project, taskId, 'task.updated', {}, updates);
  invalidateTaskCache(projectId, project.workspaceId.toString());

  emitToProject(projectId, 'task-updated', {
    projectId,
    taskId,
    task,
    changes: updates,
    updatedBy: { id: req.user.id },
    timestamp: new Date().toISOString(),
  });

  res.json({ success: true, data: { task } });
});

export const deleteTask = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  const { taskId } = req.params;
  const project = await getProjectOrFail(projectId);

  const task = await Project.getTaskById(projectId, taskId);
  if (!task) throw new AppError('Task not found', 404);

  await Project.deleteTask(projectId, taskId);
  await logTaskAudit(req, project, taskId, 'task.deleted', { title: task.title });
  invalidateTaskCache(projectId, project.workspaceId.toString());

  res.json({ success: true, message: 'Task deleted successfully' });
});

export const assignTask = asyncHandler(async (req, res) => {
  normalizeTaskRequest(req);
  const projectId = getProjectId(req);
  const { taskId } = req.params;
  const assignee = req.body.assignee || req.body.assigneeId;

  if (!assignee) throw new AppError('assignee is required', 400);

  const project = await getProjectOrFail(projectId);
  const { task } = await Project.updateTask(projectId, taskId, { assignee });

  await Project.pushTaskHistory(projectId, taskId, {
    action: 'assigned',
    userId: req.user.id,
    details: { assignee },
  });

  await logTaskAudit(req, project, taskId, 'task.assigned', { assignee });
  invalidateTaskCache(projectId, project.workspaceId.toString());

  if (assignee !== req.user.id) {
    await sendNotification(assignee, {
      type: 'task_assigned',
      title: 'Task assigned to you',
      message: `You were assigned "${task.title}"`,
      link: `/projects/${projectId}`,
      metadata: { projectId, taskId },
    });
  }

  emitToProject(projectId, 'task-updated', {
    projectId,
    taskId,
    task,
    changes: { assignee },
    updatedBy: { id: req.user.id },
    timestamp: new Date().toISOString(),
  });

  res.json({ success: true, data: { task } });
});

export const updateTaskStatus = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  const { taskId } = req.params;
  const { status, position } = req.body;

  if (!status) throw new AppError('status is required', 400);

  const validStatuses = ['todo', 'in_progress', 'review', 'done'];
  if (!validStatuses.includes(status)) {
    throw new AppError(`Status must be one of: ${validStatuses.join(', ')}`, 400);
  }

  const project = await getProjectOrFail(projectId);
  const { task } = await Project.updateTaskStatus(projectId, taskId, status, position);

  await Project.pushTaskHistory(projectId, taskId, {
    action: 'status_changed',
    userId: req.user.id,
    details: { status, position },
  });

  await logTaskAudit(req, project, taskId, 'task.status_changed', { status, position });
  invalidateTaskCache(projectId, project.workspaceId.toString());

  emitToProject(projectId, 'task-updated', {
    projectId,
    taskId,
    task,
    changes: { status, position },
    updatedBy: { id: req.user.id },
    timestamp: new Date().toISOString(),
  });

  res.json({ success: true, data: { task } });
});

export const addSubtask = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  const { taskId } = req.params;
  const { title } = req.body;

  if (!title) throw new AppError('Subtask title is required', 400);

  const project = await getProjectOrFail(projectId);
  const { subtask } = await Project.addSubtask(projectId, taskId, {
    title: sanitizeString(title, 300),
  });

  await logTaskAudit(req, project, taskId, 'task.subtask.added', { subtaskTitle: title });
  invalidateTaskCache(projectId, project.workspaceId.toString());

  res.status(201).json({ success: true, data: { subtask } });
});

export const completeSubtask = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  const { taskId, subtaskId } = req.params;
  const { completed = true } = req.body;

  const project = await getProjectOrFail(projectId);
  const result = await Project.completeSubtask(projectId, taskId, subtaskId, completed);
  if (!result) throw new AppError('Subtask not found', 404);

  await logTaskAudit(req, project, taskId, 'task.subtask.completed', { subtaskId, completed });
  invalidateTaskCache(projectId, project.workspaceId.toString());

  res.json({ success: true, data: { subtask: result.subtask } });
});

export const addComment = asyncHandler(async (req, res) => {
  normalizeTaskRequest(req);
  const projectId = getProjectId(req);
  const { taskId } = req.params;
  const text = req.body.text || req.body.content;

  if (!text?.trim()) throw new AppError('Comment text is required', 400);

  const project = await getProjectOrFail(projectId);
  const { comment } = await Project.addComment(projectId, taskId, {
    text: sanitizeString(text, 2000),
    author: req.user.id,
  });

  await logTaskAudit(req, project, taskId, 'task.comment.added', { commentId: comment._id });
  invalidateTaskCache(projectId, project.workspaceId.toString());

  emitToProject(projectId, 'comment-added', {
    projectId,
    taskId,
    comment,
    timestamp: new Date().toISOString(),
  });

  res.status(201).json({ success: true, data: { comment } });
});

export const getComments = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  const { taskId } = req.params;

  await getProjectOrFail(projectId);
  const comments = await Project.getComments(projectId, taskId);

  res.json({ success: true, data: { comments } });
});

export const getTaskHistory = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  const { taskId } = req.params;

  await getProjectOrFail(projectId);

  const [embeddedHistory, auditHistory] = await Promise.all([
    Project.getTaskById(projectId, taskId).then((t) => t?.history || []),
    import('../utils/auditLog.js').then(({ AuditLog }) =>
      AuditLog.getTaskHistory(projectId, taskId)
    ),
  ]);

  res.json({
    success: true,
    data: {
      history: [...auditHistory, ...embeddedHistory].sort(
        (a, b) => new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp)
      ),
    },
  });
});

export const getTasksByPriority = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  await getProjectOrFail(projectId);

  const grouped = await Project.getTasksByPriority(projectId);
  res.json({ success: true, data: { groups: grouped } });
});

export const getTaskMetrics = asyncHandler(async (req, res) => {
  const projectId = getProjectId(req);
  await getProjectOrFail(projectId);

  const metrics = await Project.getTaskMetrics(projectId);
  res.json({ success: true, data: { metrics } });
});
