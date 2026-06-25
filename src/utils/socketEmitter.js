let ioInstance = null;

export const roomNames = {
  user: (userId) => `user:${userId}`,
  workspace: (workspaceId) => `workspace:${workspaceId}`,
  project: (projectId) => `project:${projectId}`,
  document: (documentId) => `document:${documentId}`,
};

export function setIO(io) {
  ioInstance = io;
}

export function getIO() {
  return ioInstance;
}

export function emitToProject(projectId, event, data) {
  ioInstance?.to(roomNames.project(projectId)).emit(event, data);
}

export function emitToWorkspace(workspaceId, event, data) {
  ioInstance?.to(roomNames.workspace(workspaceId)).emit(event, data);
}

export function emitToUser(userId, event, data) {
  ioInstance?.to(roomNames.user(userId)).emit(event, data);
}

export function emitToDocument(documentId, event, data) {
  ioInstance?.to(roomNames.document(documentId)).emit(event, data);
}

export function broadcastProjectActivity(projectId, workspaceId, activity) {
  const payload = { ...activity, projectId, timestamp: new Date().toISOString() };
  emitToProject(projectId, 'project-activity', payload);
  if (workspaceId) emitToWorkspace(workspaceId, 'project-activity', payload);
}
