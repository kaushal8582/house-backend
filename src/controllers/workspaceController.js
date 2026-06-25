import { Workspace } from '../models/Workspace.js';
import { User } from '../models/User.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { auditLog } from '../utils/auditLog.js';

export const getWorkspaceMembers = asyncHandler(async (req, res) => {
  const members = await Workspace.getMembersWithDetails(req.params.workspaceId);
  res.json({ success: true, data: { members } });
});

export const inviteWorkspaceMember = asyncHandler(async (req, res) => {
  const { email, role = 'member', name, password } = req.body;
  const workspaceId = req.params.workspaceId;
  const workspace = req.workspace;

  let user = await User.findByEmail(email);
  let accountCreated = false;

  if (!user) {
    if (!name?.trim() || !password) {
      throw new AppError('Name and password are required to create a new account', 400);
    }
    user = await User.create({ name: name.trim(), email, password });
    accountCreated = true;
  }

  const existing = workspace.members.find(
    (m) => m.userId.toString() === user._id.toString()
  );

  if (existing && existing.role === role) {
    throw new AppError('User is already a member of this workspace', 409);
  }

  await Workspace.addMember(workspaceId, user._id, role);
  await User.addToWorkspace(user._id, workspaceId, role);

  const members = await Workspace.getMembersWithDetails(workspaceId);

  await auditLog(req, {
    action: accountCreated ? 'workspace.member.created' : 'workspace.member.invited',
    entityType: 'workspace',
    entityId: workspace._id,
    workspaceId: workspace._id,
    metadata: { userId: user._id, email: user.email, role },
  });

  res.status(accountCreated || !existing ? 201 : 200).json({
    success: true,
    data: { members, created: accountCreated },
  });
});

export const removeWorkspaceMember = asyncHandler(async (req, res) => {
  const { workspaceId, userId } = req.params;
  const workspace = req.workspace;

  const member = workspace.members.find(
    (m) => m.userId.toString() === userId.toString()
  );

  if (!member) {
    throw new AppError('Member not found in this workspace', 404);
  }

  if (member.role === 'owner') {
    throw new AppError('Cannot remove the workspace owner', 400);
  }

  await Workspace.removeMember(workspaceId, userId);
  await User.removeFromWorkspace(userId, workspaceId);

  const members = await Workspace.getMembersWithDetails(workspaceId);

  await auditLog(req, {
    action: 'workspace.member.removed',
    entityType: 'workspace',
    entityId: workspace._id,
    workspaceId: workspace._id,
    metadata: { userId },
  });

  res.json({ success: true, data: { members } });
});

export const changeWorkspaceMemberRole = asyncHandler(async (req, res) => {
  const { workspaceId, userId } = req.params;
  const { role } = req.body;
  const workspace = req.workspace;

  const member = workspace.members.find(
    (m) => m.userId.toString() === userId.toString()
  );

  if (!member) {
    throw new AppError('Member not found in this workspace', 404);
  }

  if (member.role === 'owner') {
    throw new AppError('Cannot change the workspace owner role', 400);
  }

  if (role === 'owner') {
    throw new AppError('Cannot assign owner role', 400);
  }

  await Workspace.addMember(workspaceId, userId, role);
  await User.addToWorkspace(userId, workspaceId, role);

  const members = await Workspace.getMembersWithDetails(workspaceId);

  await auditLog(req, {
    action: 'workspace.member.role_changed',
    entityType: 'workspace',
    entityId: workspace._id,
    workspaceId: workspace._id,
    metadata: { userId, role },
  });

  res.json({ success: true, data: { members } });
});
