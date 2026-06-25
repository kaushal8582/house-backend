import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { Project } from '../models/Project.js';

export function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please refresh your token.',
        code: 'TOKEN_EXPIRED',
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid token.',
    });
  }
}

export function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
      };
    }

    next();
  } catch {
    next();
  }
}

export function checkRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions.',
      });
    }

    next();
  };
}

export function checkWorkspaceAccess(paramName = 'workspaceId') {
  return async (req, res, next) => {
    try {
      const workspaceId =
        req.params[paramName] ||
        req.body.workspaceId ||
        req.query.workspaceId;

      if (!workspaceId) {
        return res.status(400).json({
          success: false,
          message: 'Workspace ID is required.',
        });
      }

      const workspace = await Workspace.findById(workspaceId);
      if (!workspace) {
        return res.status(404).json({
          success: false,
          message: 'Workspace not found.',
        });
      }

      const isMember = workspace.members.some(
        (m) => m.userId.toString() === req.user.id.toString()
      );

      if (!isMember && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this workspace.',
        });
      }

      const member = workspace.members.find(
        (m) => m.userId.toString() === req.user.id.toString()
      );

      req.workspace = workspace;
      req.workspaceRole = member?.role || req.user.role;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireWorkspaceRole(...roles) {
  return (req, res, next) => {
    const role = req.workspaceRole;
    if (!role || (!roles.includes(role) && req.user.role !== 'admin')) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to manage workspace members.',
      });
    }
    next();
  };
}

export function checkProjectAccess(paramName = 'projectId') {
  return async (req, res, next) => {
    try {
      const projectId =
        req.params[paramName] ||
        req.body.projectId ||
        req.query.projectId;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          message: 'Project ID is required.',
        });
      }

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found.',
        });
      }

      const workspace = await Workspace.findById(project.workspaceId);
      if (!workspace) {
        return res.status(404).json({
          success: false,
          message: 'Workspace not found.',
        });
      }

      const isWorkspaceMember = workspace.members.some(
        (m) => m.userId.toString() === req.user.id.toString()
      );

      const isTeamMember = (project.teamMembers || []).some((m) => {
        const memberId = m.userId ? m.userId.toString() : m.toString();
        return memberId === req.user.id.toString();
      });

      if (!isWorkspaceMember && !isTeamMember && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this project.',
        });
      }

      req.project = project;
      req.workspace = workspace;
      req.projectId = projectId.toString();
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function attachUser(req, res, next) {
  try {
    if (req.user?.id) {
      const user = await User.findById(req.user.id);
      if (user) {
        req.fullUser = user;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}
