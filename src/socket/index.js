import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';
import { Document } from '../models/Document.js';
import { Notification } from '../models/Notification.js';
import { setIO, getIO, roomNames } from '../utils/socketEmitter.js';

const connectedUsers = new Map();

function authenticateSocket(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication required'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name || decoded.email,
      role: decoded.role,
    };
    next();
  } catch (error) {
    next(new Error(error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token'));
  }
}

async function verifyProjectAccess(userId, projectId) {
  const project = await Project.findById(projectId);
  if (!project) return { allowed: false, error: 'Project not found' };

  const workspace = await Workspace.findById(project.workspaceId);
  if (!workspace) return { allowed: false, error: 'Workspace not found' };

  const isWorkspaceMember = workspace.members.some(
    (m) => m.userId.toString() === userId.toString()
  );
  const isTeamMember = await Project.isTeamMember(projectId, userId);

  if (!isWorkspaceMember && !isTeamMember) {
    return { allowed: false, error: 'Access denied' };
  }

  return { allowed: true, project, workspace };
}

async function verifyWorkspaceAccess(userId, workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) return { allowed: false, error: 'Workspace not found' };

  const isMember = workspace.members.some(
    (m) => m.userId.toString() === userId.toString()
  );
  if (!isMember) return { allowed: false, error: 'Access denied' };

  return { allowed: true, workspace };
}

function trackUserConnection(userId, socketId) {
  if (!connectedUsers.has(userId)) {
    connectedUsers.set(userId, new Set());
  }
  connectedUsers.get(userId).add(socketId);
}

function untrackUserConnection(userId, socketId) {
  const sockets = connectedUsers.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) connectedUsers.delete(userId);
  }
}

function getOnlineUsersInRoom(io, room) {
  const roomSet = io.sockets.adapter.rooms.get(room);
  if (!roomSet) return 0;
  return roomSet.size;
}

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  setIO(io);

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const userRoom = roomNames.user(userId);

    trackUserConnection(userId, socket.id);
    socket.join(userRoom);

    socket.emit('connected', {
      userId,
      socketId: socket.id,
      message: 'Connected to CollabSpace',
    });

    socket.on('join-workspace', async ({ workspaceId }, callback) => {
      try {
        if (!workspaceId) throw new Error('workspaceId is required');
        const access = await verifyWorkspaceAccess(userId, workspaceId);
        if (!access.allowed) throw new Error(access.error);

        const room = roomNames.workspace(workspaceId);
        socket.join(room);
        socket.data.workspaceId = workspaceId;

        const response = {
          workspaceId,
          onlineUsers: getOnlineUsersInRoom(io, room),
        };

        callback?.({ success: true, data: response });
        socket.to(room).emit('user-joined-workspace', {
          userId,
          name: socket.user.name,
          workspaceId,
        });
      } catch (error) {
        callback?.({ success: false, message: error.message });
        socket.emit('error', { message: error.message, event: 'join-workspace' });
      }
    });

    socket.on('leave-workspace', ({ workspaceId }, callback) => {
      if (workspaceId) {
        const room = roomNames.workspace(workspaceId);
        socket.leave(room);
        socket.to(room).emit('user-left-workspace', { userId, workspaceId });
      }
      callback?.({ success: true });
    });

    socket.on('join-project', async ({ projectId }, callback) => {
      try {
        if (!projectId) throw new Error('projectId is required');
        const access = await verifyProjectAccess(userId, projectId);
        if (!access.allowed) throw new Error(access.error);

        const room = roomNames.project(projectId);
        socket.join(room);
        socket.data.projectId = projectId;

        callback?.({
          success: true,
          data: {
            projectId,
            onlineUsers: getOnlineUsersInRoom(io, room),
          },
        });

        socket.to(room).emit('user-joined-project', {
          userId,
          name: socket.user.name,
          projectId,
        });
      } catch (error) {
        callback?.({ success: false, message: error.message });
        socket.emit('error', { message: error.message, event: 'join-project' });
      }
    });

    socket.on('leave-project', ({ projectId }, callback) => {
      if (projectId) {
        const room = roomNames.project(projectId);
        socket.leave(room);
        socket.to(room).emit('user-left-project', { userId, projectId });
      }
      callback?.({ success: true });
    });

    socket.on('join-document', async ({ documentId }, callback) => {
      try {
        if (!documentId) throw new Error('documentId is required');
        const hasAccess = await Document.hasAccess(documentId, userId, 'read');
        if (!hasAccess) throw new Error('Access denied');

        const room = roomNames.document(documentId);
        socket.join(room);
        socket.data.documentId = documentId;

        callback?.({ success: true, data: { documentId } });
        socket.to(room).emit('user-joined-document', {
          userId,
          name: socket.user.name,
          documentId,
        });
      } catch (error) {
        callback?.({ success: false, message: error.message });
        socket.emit('error', { message: error.message, event: 'join-document' });
      }
    });

    socket.on('leave-document', ({ documentId }, callback) => {
      if (documentId) {
        const room = roomNames.document(documentId);
        socket.leave(room);
        socket.to(room).emit('user-left-document', { userId, documentId });
      }
      callback?.({ success: true });
    });

    socket.on('task-updated', async (payload, callback) => {
      try {
        const { projectId, taskId, task, changes } = payload;
        const access = await verifyProjectAccess(userId, projectId);
        if (!access.allowed) throw new Error(access.error);

        const eventData = {
          projectId,
          taskId,
          task,
          changes,
          updatedBy: { id: userId, name: socket.user.name },
          timestamp: new Date().toISOString(),
        };

        socket.to(roomNames.project(projectId)).emit('task-updated', eventData);
        io.to(roomNames.workspace(access.project.workspaceId.toString())).emit(
          'project-activity',
          {
            type: 'task-updated',
            projectId,
            ...eventData,
          }
        );

        callback?.({ success: true });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('task-created', async (payload, callback) => {
      try {
        const { projectId, task } = payload;
        const access = await verifyProjectAccess(userId, projectId);
        if (!access.allowed) throw new Error(access.error);

        const eventData = {
          projectId,
          task,
          createdBy: { id: userId, name: socket.user.name },
          timestamp: new Date().toISOString(),
        };

        socket.to(roomNames.project(projectId)).emit('task-created', eventData);
        io.to(roomNames.workspace(access.project.workspaceId.toString())).emit(
          'project-activity',
          { type: 'task-created', ...eventData }
        );

        callback?.({ success: true });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('comment-added', async (payload, callback) => {
      try {
        const { projectId, taskId, comment } = payload;
        const access = await verifyProjectAccess(userId, projectId);
        if (!access.allowed) throw new Error(access.error);

        const eventData = {
          projectId,
          taskId,
          comment: { ...comment, author: { id: userId, name: socket.user.name } },
          timestamp: new Date().toISOString(),
        };

        io.to(roomNames.project(projectId)).emit('comment-added', eventData);
        callback?.({ success: true });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('document-edit', async (payload, callback) => {
      try {
        const { documentId, content, version, cursor } = payload;
        const hasAccess = await Document.hasAccess(documentId, userId, 'write');
        if (!hasAccess) throw new Error('Write access required');

        const eventData = {
          documentId,
          content,
          version,
          cursor,
          editedBy: { id: userId, name: socket.user.name },
          timestamp: new Date().toISOString(),
        };

        socket.to(roomNames.document(documentId)).emit('document-edit', eventData);
        callback?.({ success: true });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('cursor-move', (payload) => {
      const { documentId, projectId, position, selection } = payload;
      const room = documentId
        ? roomNames.document(documentId)
        : projectId
          ? roomNames.project(projectId)
          : null;

      if (room) {
        socket.to(room).emit('cursor-move', {
          userId,
          name: socket.user.name,
          documentId,
          projectId,
          position,
          selection,
          timestamp: new Date().toISOString(),
        });
      }
    });

    socket.on('user-typing', (payload) => {
      const { documentId, projectId, taskId, isTyping } = payload;
      let room = null;
      if (documentId) room = roomNames.document(documentId);
      else if (projectId) room = roomNames.project(projectId);

      if (room) {
        socket.to(room).emit('user-typing', {
          userId,
          name: socket.user.name,
          documentId,
          projectId,
          taskId,
          isTyping,
          timestamp: new Date().toISOString(),
        });
      }
    });

    socket.on('disconnect', (reason) => {
      untrackUserConnection(userId, socket.id);

      if (socket.data.projectId) {
        socket.to(roomNames.project(socket.data.projectId)).emit('user-left-project', {
          userId,
          projectId: socket.data.projectId,
        });
      }
      if (socket.data.documentId) {
        socket.to(roomNames.document(socket.data.documentId)).emit('user-left-document', {
          userId,
          documentId: socket.data.documentId,
        });
      }
      if (socket.data.workspaceId) {
        socket.to(roomNames.workspace(socket.data.workspaceId)).emit('user-left-workspace', {
          userId,
          workspaceId: socket.data.workspaceId,
        });
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error.message);
    });
  });

  console.log('Socket.io initialized');
  return io;
}

export async function sendNotification(userId, notificationData) {
  const io = getIO();
  const notification = await Notification.create({
    userId,
    ...notificationData,
  });

  io?.to(roomNames.user(userId)).emit('notification', {
    ...notification,
    timestamp: new Date().toISOString(),
  });

  return notification;
}

export { getIO };
