import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validateProjectData } from '../utils/validators.js';
import { sanitizeString, parsePagination, buildPaginationMeta } from '../utils/sanitize.js';
import { auditLog } from '../utils/auditLog.js';
import { cacheGet, cacheSet, cacheDeletePattern, cacheKey } from '../utils/cache.js';

async function ensureWorkspaceAccess(req, workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) throw new AppError('Workspace not found', 404);

  const isMember = workspace.members.some(
    (m) => m.userId.toString() === req.user.id.toString()
  );
  if (!isMember && req.user.role !== 'admin') {
    throw new AppError('You do not have access to this workspace', 403);
  }
  return workspace;
}

function invalidateProjectCache(workspaceId, projectId) {
  cacheDeletePattern(`projects:${workspaceId}`);
  if (projectId) cacheDeletePattern(`project:${projectId}`);
}

export const createProject = asyncHandler(async (req, res) => {
  const data = {
    ...req.body,
    name: sanitizeString(req.body.name, 200),
    description: sanitizeString(req.body.description, 5000),
    createdBy: req.user.id,
  };

  const validation = validateProjectData(data);
  if (!validation.valid) throw new AppError(validation.message, 400);

  await ensureWorkspaceAccess(req, data.workspaceId);

  const project = await Project.create(data);

  await auditLog(req, {
    action: 'project.created',
    entityType: 'project',
    entityId: project._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    metadata: { name: project.name },
  });

  invalidateProjectCache(data.workspaceId);

  res.status(201).json({ success: true, data: { project } });
});

export const getProjects = asyncHandler(async (req, res) => {
  const { workspaceId, status, priority, search, archived, favorite } = req.query;
  if (!workspaceId) throw new AppError('workspaceId query parameter is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const { page, limit, skip } = parsePagination(req.query);
  const cacheKeyStr = cacheKey('projects', workspaceId, page, limit, status, priority, search, archived, favorite);
  const cached = cacheGet(cacheKeyStr);
  if (cached) {
    return res.json({ success: true, data: cached, cached: true });
  }

  const { projects, total } = await Project.findByWorkspace(workspaceId, {
    skip, limit, status, priority, search, archived, favorite, userId: req.user.id,
  });

  const enriched = await Promise.all(
    projects.map(async (project) => {
      const stats = await Project.getProjectStats(project._id);
      return { ...project, stats };
    })
  );

  const result = { projects: enriched, pagination: buildPaginationMeta(total, page, limit) };
  cacheSet(cacheKeyStr, result, 30000);

  res.json({ success: true, data: result });
});

export const getProjectById = asyncHandler(async (req, res) => {
  const project = await Project.findByIdPopulated(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const [stats, teamMembers] = await Promise.all([
    Project.getProjectStats(project._id),
    Project.getTeamMembers(project._id),
  ]);

  res.json({
    success: true,
    data: { project: { ...project, stats, teamMembers } },
  });
});

export const updateProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const allowed = ['name', 'description', 'status', 'priority', 'dueDate', 'tags'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates[field] = typeof req.body[field] === 'string'
        ? sanitizeString(req.body[field], field === 'description' ? 5000 : 200)
        : req.body[field];
    }
  }

  if (Object.keys(updates).length === 0 && req.body.isFavorite === undefined) {
    throw new AppError('No valid fields to update', 400);
  }

  let updated = project;
  if (Object.keys(updates).length > 0) {
    updated = await Project.update(req.params.projectId, updates);
  }

  if (req.body.isFavorite !== undefined) {
    updated = await Project.setFavorite(
      req.params.projectId,
      req.user.id,
      req.body.isFavorite
    );
  }

  await auditLog(req, {
    action: 'project.updated',
    entityType: 'project',
    entityId: project._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    changes: updates,
  });

  invalidateProjectCache(project.workspaceId.toString(), project._id.toString());

  res.json({ success: true, data: { project: updated } });
});

export const deleteProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  await Project.softDelete(req.params.projectId, req.user.id);

  await auditLog(req, {
    action: 'project.deleted',
    entityType: 'project',
    entityId: project._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    metadata: { name: project.name },
  });

  invalidateProjectCache(project.workspaceId.toString(), project._id.toString());

  res.json({ success: true, message: 'Project deleted successfully' });
});

export const archiveProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const archived = project.isArchived
    ? await Project.unarchive(req.params.projectId)
    : await Project.archive(req.params.projectId);

  await auditLog(req, {
    action: 'project.archived',
    entityType: 'project',
    entityId: project._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
  });

  invalidateProjectCache(project.workspaceId.toString(), project._id.toString());

  res.json({ success: true, data: { project: archived } });
});

export const getProjectStats = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const cacheKeyStr = cacheKey('project-stats', req.params.projectId);
  const cached = cacheGet(cacheKeyStr);
  if (cached) return res.json({ success: true, data: cached, cached: true });

  const stats = await Project.getProjectStats(req.params.projectId);
  cacheSet(cacheKeyStr, stats, 60000);

  res.json({ success: true, data: { stats } });
});

export const getProjectActivity = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const { limit, skip } = parsePagination(req.query);
  const { AuditLog } = await import('../utils/auditLog.js');
  const activity = await AuditLog.getProjectActivity(req.params.projectId, { limit, skip });

  res.json({ success: true, data: { activity } });
});

export const getAvailableMembers = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const workspaceMembers = await Workspace.getMembersWithDetails(project.workspaceId);
  const projectMemberIds = new Set(
    (project.teamMembers || []).map((m) => m.userId.toString())
  );

  const available = workspaceMembers.filter(
    (m) => !projectMemberIds.has(m.userId.toString())
  );

  res.json({ success: true, data: { members: available } });
});

export const addTeamMember = asyncHandler(async (req, res) => {
  const { userId, role = 'member' } = req.body;
  if (!userId) throw new AppError('userId is required', 400);

  const validRoles = ['owner', 'admin', 'member', 'viewer'];
  if (!validRoles.includes(role)) throw new AppError(`Role must be one of: ${validRoles.join(', ')}`, 400);

  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const isWorkspaceMember = await Workspace.isMember(project.workspaceId, userId);
  if (!isWorkspaceMember) {
    throw new AppError('User must be added to the workspace first', 400);
  }

  const updated = await Project.addTeamMember(req.params.projectId, userId, role);

  await auditLog(req, {
    action: 'project.member.added',
    entityType: 'project',
    entityId: project._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    metadata: { userId, role },
  });

  invalidateProjectCache(project.workspaceId.toString(), project._id.toString());

  res.json({ success: true, data: { project: updated } });
});

export const removeTeamMember = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const updated = await Project.removeTeamMember(req.params.projectId, userId);

  await auditLog(req, {
    action: 'project.member.removed',
    entityType: 'project',
    entityId: project._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    metadata: { userId },
  });

  invalidateProjectCache(project.workspaceId.toString(), project._id.toString());

  res.json({ success: true, data: { project: updated } });
});

export const changeMemberRole = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;
  if (!role) throw new AppError('role is required', 400);

  const validRoles = ['owner', 'admin', 'member', 'viewer'];
  if (!validRoles.includes(role)) throw new AppError(`Role must be one of: ${validRoles.join(', ')}`, 400);

  const project = await Project.findById(req.params.projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const updated = await Project.changeMemberRole(req.params.projectId, userId, role);

  await auditLog(req, {
    action: 'project.member.role_changed',
    entityType: 'project',
    entityId: project._id,
    workspaceId: project.workspaceId,
    projectId: project._id,
    metadata: { userId, role },
  });

  res.json({ success: true, data: { project: updated } });
});
