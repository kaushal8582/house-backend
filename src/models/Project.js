import { ObjectId } from 'mongodb';
import { getDb } from '../config/database.js';

const COLLECTION = 'projects';

function getCollection() {
  return getDb().collection(COLLECTION);
}

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (!ObjectId.isValid(id)) throw new Error('Invalid ID');
  return new ObjectId(id);
}

function normalizeMember(member) {
  if (member.userId) return member;
  return { userId: member, role: 'member', joinedAt: new Date() };
}

function getMemberUserId(member) {
  return (member.userId || member).toString();
}

function buildDefaultTask(taskData) {
  return {
    _id: new ObjectId(),
    title: taskData.title.trim(),
    description: taskData.description || '',
    status: taskData.status || 'todo',
    priority: taskData.priority || 'medium',
    assignee: taskData.assignee ? toObjectId(taskData.assignee) : null,
    dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
    tags: taskData.tags || [],
    position: taskData.position ?? 0,
    subtasks: [],
    comments: [],
    attachments: [],
    timeSpent: 0,
    history: [],
    createdBy: toObjectId(taskData.createdBy),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export const Project = {
  async create(projectData) {
    const {
      name,
      description,
      workspaceId,
      createdBy,
      status = 'active',
      priority = 'medium',
      dueDate,
      tags = [],
    } = projectData;

    const creatorId = toObjectId(createdBy);
    const project = {
      name: name.trim(),
      description: description || '',
      workspaceId: toObjectId(workspaceId),
      createdBy: creatorId,
      status,
      priority,
      dueDate: dueDate ? new Date(dueDate) : null,
      tags,
      tasks: [],
      teamMembers: [
        { userId: creatorId, role: 'owner', joinedAt: new Date() },
      ],
      favorites: [],
      isArchived: false,
      archivedAt: null,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getCollection().insertOne(project);
    return { ...project, _id: result.insertedId };
  },

  async findById(id, { includeDeleted = false } = {}) {
    const filter = { _id: toObjectId(id) };
    if (!includeDeleted) filter.isDeleted = { $ne: true };
    return getCollection().findOne(filter);
  },

  async findByIdPopulated(id) {
    const pipeline = [
      { $match: { _id: toObjectId(id), isDeleted: { $ne: true } } },
      { $unwind: { path: '$teamMembers', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'teamMembers.userId',
          foreignField: '_id',
          as: 'memberUser',
        },
      },
      { $unwind: { path: '$memberUser', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$_id',
          doc: { $first: '$$ROOT' },
          populatedMembers: {
            $push: {
              $cond: [
                { $ifNull: ['$memberUser._id', false] },
                {
                  _id: '$memberUser._id',
                  name: '$memberUser.name',
                  email: '$memberUser.email',
                  avatar: '$memberUser.avatar',
                  role: '$teamMembers.role',
                  joinedAt: '$teamMembers.joinedAt',
                },
                '$$REMOVE',
              ],
            },
          },
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              '$doc',
              { teamMembersPopulated: '$populatedMembers' },
            ],
          },
        },
      },
    ];

    const results = await getCollection().aggregate(pipeline).toArray();
    return results[0] || null;
  },

  async findWithFilters(filters = {}, { skip = 0, limit = 20, sort = { updatedAt: -1 } } = {}) {
    const query = { isDeleted: { $ne: true }, ...filters };
    const [projects, total] = await Promise.all([
      getCollection().find(query).sort(sort).skip(skip).limit(limit).toArray(),
      getCollection().countDocuments(query),
    ]);
    return { projects, total };
  },

  async findByWorkspace(workspaceId, options = {}) {
    const { skip = 0, limit = 20, status, priority, search, archived, favorite, userId } = options;
    const filter = {
      workspaceId: toObjectId(workspaceId),
      isDeleted: { $ne: true },
    };

    if (archived === 'true') filter.isArchived = true;
    else if (archived !== 'all') filter.isArchived = { $ne: true };

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (search) filter.name = { $regex: search, $options: 'i' };
    if (favorite === 'true' && userId) filter.favorites = toObjectId(userId);

    return this.findWithFilters(filter, { skip, limit });
  },

  async update(id, data) {
    const forbidden = ['_id', 'tasks', 'workspaceId', 'createdBy', 'isDeleted', 'deletedAt'];
    const update = { updatedAt: new Date() };

    for (const [key, value] of Object.entries(data)) {
      if (!forbidden.includes(key) && value !== undefined) {
        update[key] = key === 'dueDate' && value ? new Date(value) : value;
      }
    }

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(id), isDeleted: { $ne: true } },
      { $set: update },
      { returnDocument: 'after' }
    );

    return result;
  },

  async softDelete(id, deletedBy) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(id), isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: toObjectId(deletedBy),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
  },

  async archive(id) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(id), isDeleted: { $ne: true } },
      {
        $set: {
          isArchived: true,
          archivedAt: new Date(),
          status: 'archived',
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
  },

  async unarchive(id) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(id), isDeleted: { $ne: true } },
      {
        $set: {
          isArchived: false,
          archivedAt: null,
          status: 'active',
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
  },

  async setFavorite(id, userId, isFavorite) {
    const pId = toObjectId(id);
    const uId = toObjectId(userId);
    const update = isFavorite
      ? { $addToSet: { favorites: uId }, $set: { updatedAt: new Date() } }
      : { $pull: { favorites: uId }, $set: { updatedAt: new Date() } };

    return getCollection().findOneAndUpdate(
      { _id: pId, isDeleted: { $ne: true } },
      update,
      { returnDocument: 'after' }
    );
  },

  async addTeamMember(projectId, userId, role = 'member') {
    const pId = toObjectId(projectId);
    const uId = toObjectId(userId);
    const project = await this.findById(pId);
    if (!project) return null;

    const members = (project.teamMembers || []).map(normalizeMember);
    const existing = members.find((m) => getMemberUserId(m) === uId.toString());

    if (existing) {
      return getCollection().findOneAndUpdate(
        { _id: pId, 'teamMembers.userId': uId },
        {
          $set: { 'teamMembers.$.role': role, updatedAt: new Date() },
        },
        { returnDocument: 'after' }
      );
    }

    return getCollection().findOneAndUpdate(
      { _id: pId },
      {
        $push: {
          teamMembers: { userId: uId, role, joinedAt: new Date() },
        },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async removeTeamMember(projectId, userId) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(projectId) },
      {
        $pull: { teamMembers: { userId: toObjectId(userId) } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async changeMemberRole(projectId, userId, role) {
    return getCollection().findOneAndUpdate(
      {
        _id: toObjectId(projectId),
        'teamMembers.userId': toObjectId(userId),
      },
      {
        $set: { 'teamMembers.$.role': role, updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async getTeamMembers(projectId) {
    const pipeline = [
      { $match: { _id: toObjectId(projectId) } },
      { $unwind: '$teamMembers' },
      {
        $lookup: {
          from: 'users',
          localField: 'teamMembers.userId',
          foreignField: '_id',
          as: 'memberDetails',
        },
      },
      { $unwind: '$memberDetails' },
      {
        $project: {
          _id: '$memberDetails._id',
          name: '$memberDetails.name',
          email: '$memberDetails.email',
          avatar: '$memberDetails.avatar',
          role: '$teamMembers.role',
          joinedAt: '$teamMembers.joinedAt',
        },
      },
    ];

    return getCollection().aggregate(pipeline).toArray();
  },

  async isTeamMember(projectId, userId) {
    const project = await this.findById(projectId);
    if (!project) return false;
    return (project.teamMembers || []).some(
      (m) => getMemberUserId(normalizeMember(m)) === userId.toString()
    );
  },

  getTaskFromProject(project, taskId) {
    return project?.tasks?.find((t) => t._id.toString() === taskId.toString());
  },

  async addTask(projectId, taskData) {
    const task = buildDefaultTask(taskData);
    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(projectId), isDeleted: { $ne: true } },
      { $push: { tasks: task }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    return { project: result, task };
  },

  async getTasks(projectId, filters = {}) {
    const project = await this.findById(projectId);
    if (!project) return [];
    let tasks = project.tasks || [];
    if (filters.status) tasks = tasks.filter((t) => t.status === filters.status);
    if (filters.priority) tasks = tasks.filter((t) => t.priority === filters.priority);
    if (filters.assignee) {
      tasks = tasks.filter(
        (t) => t.assignee && t.assignee.toString() === filters.assignee
      );
    }
    if (filters.search) {
      const re = new RegExp(filters.search, 'i');
      tasks = tasks.filter((t) => re.test(t.title) || re.test(t.description));
    }
    return tasks.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  },

  async getTaskById(projectId, taskId) {
    const project = await this.findById(projectId);
    return this.getTaskFromProject(project, taskId);
  },

  async updateTask(projectId, taskId, taskData) {
    const setFields = { updatedAt: new Date(), 'tasks.$.updatedAt': new Date() };
    const allowedFields = [
      'title', 'description', 'status', 'priority', 'assignee', 'dueDate', 'tags', 'position', 'timeSpent',
    ];

    for (const field of allowedFields) {
      if (taskData[field] !== undefined) {
        if (field === 'assignee') {
          setFields[`tasks.$.${field}`] = taskData.assignee ? toObjectId(taskData.assignee) : null;
        } else if (field === 'dueDate') {
          setFields[`tasks.$.${field}`] = taskData.dueDate ? new Date(taskData.dueDate) : null;
        } else {
          setFields[`tasks.$.${field}`] = taskData[field];
        }
      }
    }

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(projectId), 'tasks._id': toObjectId(taskId) },
      { $set: setFields },
      { returnDocument: 'after' }
    );

    const task = this.getTaskFromProject(result, taskId);
    return { project: result, task };
  },

  async updateTaskStatus(projectId, taskId, status, position) {
    const update = {
      'tasks.$.status': status,
      'tasks.$.updatedAt': new Date(),
      updatedAt: new Date(),
    };
    if (position !== undefined) update['tasks.$.position'] = position;

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(projectId), 'tasks._id': toObjectId(taskId) },
      { $set: update },
      { returnDocument: 'after' }
    );

    return { project: result, task: this.getTaskFromProject(result, taskId) };
  },

  async deleteTask(projectId, taskId) {
    return getCollection().findOneAndUpdate(
      { _id: toObjectId(projectId) },
      {
        $pull: { tasks: { _id: toObjectId(taskId) } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );
  },

  async addSubtask(projectId, taskId, subtaskData) {
    const subtask = {
      _id: new ObjectId(),
      title: subtaskData.title.trim(),
      completed: false,
      createdAt: new Date(),
    };

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(projectId), 'tasks._id': toObjectId(taskId) },
      {
        $push: { 'tasks.$.subtasks': subtask },
        $set: { 'tasks.$.updatedAt': new Date(), updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );

    return { project: result, subtask };
  },

  async completeSubtask(projectId, taskId, subtaskId, completed = true) {
    const project = await this.findById(projectId);
    const task = this.getTaskFromProject(project, taskId);
    if (!task) return null;

    const subtasks = (task.subtasks || []).map((s) =>
      s._id.toString() === subtaskId.toString() ? { ...s, completed } : s
    );

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(projectId), 'tasks._id': toObjectId(taskId) },
      {
        $set: { 'tasks.$.subtasks': subtasks, 'tasks.$.updatedAt': new Date(), updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );

    return { project: result, subtask: subtasks.find((s) => s._id.toString() === subtaskId.toString()) };
  },

  async addComment(projectId, taskId, commentData) {
    const comment = {
      _id: new ObjectId(),
      text: commentData.text.trim(),
      author: toObjectId(commentData.author),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getCollection().findOneAndUpdate(
      { _id: toObjectId(projectId), 'tasks._id': toObjectId(taskId) },
      {
        $push: { 'tasks.$.comments': comment },
        $set: { 'tasks.$.updatedAt': new Date(), updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );

    return { project: result, comment };
  },

  async getComments(projectId, taskId) {
    const task = await this.getTaskById(projectId, taskId);
    if (!task) return [];

    const pipeline = [
      { $match: { _id: toObjectId(projectId) } },
      { $unwind: '$tasks' },
      { $match: { 'tasks._id': toObjectId(taskId) } },
      { $unwind: '$tasks.comments' },
      {
        $lookup: {
          from: 'users',
          localField: 'tasks.comments.author',
          foreignField: '_id',
          as: 'author',
        },
      },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: '$tasks.comments._id',
          text: '$tasks.comments.text',
          createdAt: '$tasks.comments.createdAt',
          author: { _id: '$author._id', name: '$author.name', avatar: '$author.avatar' },
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    return getCollection().aggregate(pipeline).toArray();
  },

  async pushTaskHistory(projectId, taskId, entry) {
    return getCollection().updateOne(
      { _id: toObjectId(projectId), 'tasks._id': toObjectId(taskId) },
      {
        $push: {
          'tasks.$.history': {
            _id: new ObjectId(),
            ...entry,
            timestamp: new Date(),
          },
        },
      }
    );
  },

  async getTasksByPriority(projectId) {
    const pipeline = [
      { $match: { _id: toObjectId(projectId) } },
      { $unwind: { path: '$tasks', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$tasks.priority',
          count: { $sum: 1 },
          tasks: {
            $push: {
              _id: '$tasks._id',
              title: '$tasks.title',
              status: '$tasks.status',
              assignee: '$tasks.assignee',
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ];

    return getCollection().aggregate(pipeline).toArray();
  },

  async getTaskMetrics(projectId) {
    const pipeline = [
      { $match: { _id: toObjectId(projectId) } },
      { $unwind: { path: '$tasks', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: { $cond: [{ $ifNull: ['$tasks._id', false] }, 1, 0] } },
          totalTimeSpent: { $sum: { $ifNull: ['$tasks.timeSpent', 0] } },
          avgTimeSpent: { $avg: { $ifNull: ['$tasks.timeSpent', 0] } },
          totalSubtasks: { $sum: { $size: { $ifNull: ['$tasks.subtasks', []] } } },
          completedSubtasks: {
            $sum: {
              $size: {
                $filter: {
                  input: { $ifNull: ['$tasks.subtasks', []] },
                  as: 's',
                  cond: { $eq: ['$$s.completed', true] },
                },
              },
            },
          },
          totalComments: { $sum: { $size: { $ifNull: ['$tasks.comments', []] } } },
          totalAttachments: { $sum: { $size: { $ifNull: ['$tasks.attachments', []] } } },
        },
      },
    ];

    const results = await getCollection().aggregate(pipeline).toArray();
    return results[0] || {
      totalTasks: 0, totalTimeSpent: 0, avgTimeSpent: 0,
      totalSubtasks: 0, completedSubtasks: 0, totalComments: 0, totalAttachments: 0,
    };
  },

  async getProjectStats(projectId) {
    const pipeline = [
      { $match: { _id: toObjectId(projectId) } },
      { $unwind: { path: '$tasks', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$_id',
          totalTasks: { $sum: { $cond: [{ $ifNull: ['$tasks._id', false] }, 1, 0] } },
          completedTasks: { $sum: { $cond: [{ $eq: ['$tasks.status', 'done'] }, 1, 0] } },
          inProgressTasks: { $sum: { $cond: [{ $eq: ['$tasks.status', 'in_progress'] }, 1, 0] } },
          todoTasks: { $sum: { $cond: [{ $eq: ['$tasks.status', 'todo'] }, 1, 0] } },
          reviewTasks: { $sum: { $cond: [{ $eq: ['$tasks.status', 'review'] }, 1, 0] } },
          highPriorityTasks: {
            $sum: { $cond: [{ $in: ['$tasks.priority', ['high', 'urgent']] }, 1, 0] },
          },
          overdueTasks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$tasks.status', 'done'] },
                    { $lt: ['$tasks.dueDate', new Date()] },
                    { $ifNull: ['$tasks.dueDate', false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          teamSize: { $first: { $size: { $ifNull: ['$teamMembers', []] } } },
        },
      },
      {
        $project: {
          _id: 0,
          totalTasks: 1,
          completedTasks: 1,
          inProgressTasks: 1,
          todoTasks: 1,
          reviewTasks: 1,
          highPriorityTasks: 1,
          overdueTasks: 1,
          teamSize: 1,
          completionRate: {
            $cond: [
              { $gt: ['$totalTasks', 0] },
              { $multiply: [{ $divide: ['$completedTasks', '$totalTasks'] }, 100] },
              0,
            ],
          },
        },
      },
    ];

    const results = await getCollection().aggregate(pipeline).toArray();
    return results[0] || {
      totalTasks: 0, completedTasks: 0, inProgressTasks: 0, todoTasks: 0,
      reviewTasks: 0, highPriorityTasks: 0, overdueTasks: 0, teamSize: 0, completionRate: 0,
    };
  },

  async getTasksByStatus(projectId, status) {
    const project = await this.findById(projectId);
    if (!project) return [];
    return (project.tasks || []).filter((t) => t.status === status);
  },
};
