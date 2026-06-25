import { ObjectId } from 'mongodb';
import { getDb } from '../config/database.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { cacheGet, cacheSet, cacheKey } from '../utils/cache.js';
import { AuditLog } from '../utils/auditLog.js';

function toObjectId(id) {
  if (!ObjectId.isValid(id)) throw new Error('Invalid ID');
  return new ObjectId(id);
}

async function ensureWorkspaceAccess(req, workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) throw new AppError('Workspace not found', 404);

  const isMember = workspace.members.some(
    (m) => m.userId.toString() === req.user.id.toString()
  );
  if (!isMember && req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }
  return workspace;
}

function parseDateRange(query) {
  const now = new Date();
  const startDate = query.startDate ? new Date(query.startDate) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = query.endDate ? new Date(query.endDate) : now;
  return { startDate, endDate };
}

export const getDashboardStats = asyncHandler(async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const cacheKeyStr = cacheKey('dashboard-stats', workspaceId);
  const cached = cacheGet(cacheKeyStr);
  if (cached) return res.json({ success: true, data: cached, cached: true });

  const wsId = toObjectId(workspaceId);
  const pipeline = [
    { $match: { workspaceId: wsId, isDeleted: { $ne: true } } },
    { $unwind: { path: '$tasks', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        totalProjects: { $addToSet: '$_id' },
        activeProjects: {
          $addToSet: { $cond: [{ $eq: ['$status', 'active'] }, '$_id', '$$REMOVE'] },
        },
        totalTasks: { $sum: { $cond: [{ $ifNull: ['$tasks._id', false] }, 1, 0] } },
        completedTasks: { $sum: { $cond: [{ $eq: ['$tasks.status', 'done'] }, 1, 0] } },
        inProgressTasks: { $sum: { $cond: [{ $eq: ['$tasks.status', 'in_progress'] }, 1, 0] } },
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
      },
    },
    {
      $project: {
        _id: 0,
        totalProjects: { $size: '$totalProjects' },
        activeProjects: { $size: '$activeProjects' },
        totalTasks: 1,
        completedTasks: 1,
        inProgressTasks: 1,
        overdueTasks: 1,
        completionRate: {
          $cond: [
            { $gt: ['$totalTasks', 0] },
            { $round: [{ $multiply: [{ $divide: ['$completedTasks', '$totalTasks'] }, 100] }, 1] },
            0,
          ],
        },
      },
    },
  ];

  const [stats] = await getDb().collection('projects').aggregate(pipeline).toArray();

  const documentCount = await getDb().collection('documents').countDocuments({
    workspaceId: wsId,
    isDeleted: { $ne: true },
  });

  const workspace = await Workspace.findById(workspaceId);
  const teamMembers = workspace?.members?.length || 0;

  const result = {
    ...(stats || {
      totalProjects: 0, activeProjects: 0, totalTasks: 0,
      completedTasks: 0, inProgressTasks: 0, overdueTasks: 0, completionRate: 0,
    }),
    documents: documentCount,
    teamMembers,
  };

  cacheSet(cacheKeyStr, result, 60000);
  res.json({ success: true, data: result });
});

export const getProjectAnalytics = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const project = await Project.findById(projectId);
  if (!project) throw new AppError('Project not found', 404);

  await ensureWorkspaceAccess(req, project.workspaceId.toString());

  const [stats, taskMetrics, byPriority, byStatus] = await Promise.all([
    Project.getProjectStats(projectId),
    Project.getTaskMetrics(projectId),
    Project.getTasksByPriority(projectId),
    getDb().collection('projects').aggregate([
      { $match: { _id: toObjectId(projectId) } },
      { $unwind: { path: '$tasks', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$tasks.status',
          count: { $sum: 1 },
        },
      },
    ]).toArray(),
  ]);

  res.json({
    success: true,
    data: { stats, taskMetrics, byPriority, byStatus },
  });
});

export const getUserPerformance = asyncHandler(async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const pipeline = [
    { $match: { workspaceId: toObjectId(workspaceId), isDeleted: { $ne: true } } },
    { $unwind: '$tasks' },
    { $match: { 'tasks.assignee': { $ne: null } } },
    {
      $group: {
        _id: '$tasks.assignee',
        totalAssigned: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$tasks.status', 'done'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$tasks.status', 'in_progress'] }, 1, 0] } },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$tasks.status', 'done'] },
                  { $lt: ['$tasks.dueDate', new Date()] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalTimeSpent: { $sum: { $ifNull: ['$tasks.timeSpent', 0] } },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        name: '$user.name',
        email: '$user.email',
        totalAssigned: 1,
        completed: 1,
        inProgress: 1,
        overdue: 1,
        totalTimeSpent: 1,
        completionRate: {
          $cond: [
            { $gt: ['$totalAssigned', 0] },
            { $round: [{ $multiply: [{ $divide: ['$completed', '$totalAssigned'] }, 100] }, 1] },
            0,
          ],
        },
      },
    },
    { $sort: { completed: -1 } },
  ];

  const performance = await getDb().collection('projects').aggregate(pipeline).toArray();
  res.json({ success: true, data: { performance } });
});

export const getActivityTimeline = asyncHandler(async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const { startDate, endDate } = parseDateRange(req.query);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  const activity = await AuditLog.getActivityTimeline(workspaceId, { startDate, endDate, limit });
  res.json({ success: true, data: { activity, dateRange: { startDate, endDate } } });
});

export const getTaskTrends = asyncHandler(async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const { startDate, endDate } = parseDateRange(req.query);

  const pipeline = [
    { $match: { workspaceId: toObjectId(workspaceId), isDeleted: { $ne: true } } },
    { $unwind: '$tasks' },
    {
      $match: {
        'tasks.createdAt': { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$tasks.createdAt' } },
        },
        created: { $sum: 1 },
        completed: {
          $sum: { $cond: [{ $eq: ['$tasks.status', 'done'] }, 1, 0] },
        },
      },
    },
    { $sort: { '_id.date': 1 } },
    {
      $project: {
        _id: 0,
        date: '$_id.date',
        created: 1,
        completed: 1,
      },
    },
  ];

  const trends = await getDb().collection('projects').aggregate(pipeline).toArray();

  const withMovingAvg = trends.map((item, i, arr) => {
    const window = arr.slice(Math.max(0, i - 6), i + 1);
    const movingAvgCompleted = window.reduce((s, w) => s + w.completed, 0) / window.length;
    return { ...item, movingAvgCompleted: Math.round(movingAvgCompleted * 10) / 10 };
  });

  res.json({ success: true, data: { trends: withMovingAvg, dateRange: { startDate, endDate } } });
});

export const getUpcomingDeadlines = asyncHandler(async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);

  const pipeline = [
    { $match: { workspaceId: toObjectId(workspaceId), isDeleted: { $ne: true } } },
    { $unwind: '$tasks' },
    {
      $match: {
        'tasks.status': { $ne: 'done' },
        'tasks.dueDate': { $exists: true, $ne: null },
      },
    },
    { $sort: { 'tasks.dueDate': 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        taskId: '$tasks._id',
        title: '$tasks.title',
        priority: '$tasks.priority',
        dueDate: '$tasks.dueDate',
        projectId: '$_id',
        project: '$name',
      },
    },
  ];

  const deadlines = await getDb().collection('projects').aggregate(pipeline).toArray();
  res.json({ success: true, data: { deadlines } });
});

export const getTeamVelocity = asyncHandler(async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const weeksBack = parseInt(req.query.weeks, 10) || 4;
  const startDate = new Date(Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000);

  const pipeline = [
    { $match: { workspaceId: toObjectId(workspaceId), isDeleted: { $ne: true } } },
    { $unwind: '$tasks' },
    {
      $match: {
        'tasks.status': 'done',
        'tasks.updatedAt': { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          week: { $isoWeek: '$tasks.updatedAt' },
          year: { $isoWeekYear: '$tasks.updatedAt' },
        },
        tasksCompleted: { $sum: 1 },
        storyPoints: { $sum: { $ifNull: ['$tasks.timeSpent', 1] } },
      },
    },
    { $sort: { '_id.year': 1, '_id.week': 1 } },
    {
      $project: {
        _id: 0,
        week: '$_id.week',
        year: '$_id.year',
        tasksCompleted: 1,
        storyPoints: 1,
      },
    },
  ];

  const velocity = await getDb().collection('projects').aggregate(pipeline).toArray();

  const avgVelocity = velocity.length
    ? velocity.reduce((s, v) => s + v.tasksCompleted, 0) / velocity.length
    : 0;

  res.json({
    success: true,
    data: {
      velocity,
      averageTasksPerWeek: Math.round(avgVelocity * 10) / 10,
      weeksAnalyzed: weeksBack,
    },
  });
});

export const getWorkDistribution = asyncHandler(async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const pipeline = [
    { $match: { workspaceId: toObjectId(workspaceId), isDeleted: { $ne: true } } },
    { $unwind: '$tasks' },
    { $match: { 'tasks.assignee': { $ne: null } } },
    {
      $group: {
        _id: '$tasks.assignee',
        taskCount: { $sum: 1 },
        byPriority: {
          $push: '$tasks.priority',
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $project: {
        userId: '$_id',
        name: '$user.name',
        taskCount: 1,
        priorityBreakdown: {
          urgent: { $size: { $filter: { input: '$byPriority', as: 'p', cond: { $eq: ['$$p', 'urgent'] } } } },
          high: { $size: { $filter: { input: '$byPriority', as: 'p', cond: { $eq: ['$$p', 'high'] } } } },
          medium: { $size: { $filter: { input: '$byPriority', as: 'p', cond: { $eq: ['$$p', 'medium'] } } } },
          low: { $size: { $filter: { input: '$byPriority', as: 'p', cond: { $eq: ['$$p', 'low'] } } } },
        },
      },
    },
  ];

  const distribution = await getDb().collection('projects').aggregate(pipeline).toArray();

  const totalTasks = distribution.reduce((s, d) => s + d.taskCount, 0);
  const withPercentage = distribution.map((d) => ({
    ...d,
    percentage: totalTasks ? Math.round((d.taskCount / totalTasks) * 1000) / 10 : 0,
  }));

  res.json({ success: true, data: { distribution: withPercentage, totalTasks } });
});

export const getProductivityMetrics = asyncHandler(async (req, res) => {
  const { workspaceId } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const { startDate, endDate } = parseDateRange(req.query);

  const pipeline = [
    { $match: { workspaceId: toObjectId(workspaceId), isDeleted: { $ne: true } } },
    { $unwind: { path: '$tasks', preserveNullAndEmptyArrays: true } },
    {
      $facet: {
        taskStats: [
          {
            $group: {
              _id: null,
              total: { $sum: { $cond: [{ $ifNull: ['$tasks._id', false] }, 1, 0] } },
              completed: { $sum: { $cond: [{ $eq: ['$tasks.status', 'done'] }, 1, 0] } },
              avgCompletionTime: {
                $avg: {
                  $cond: [
                    { $eq: ['$tasks.status', 'done'] },
                    { $subtract: ['$tasks.updatedAt', '$tasks.createdAt'] },
                    null,
                  ],
                },
              },
            },
          },
        ],
        dailyOutput: [
          {
            $match: {
              'tasks.status': 'done',
              'tasks.updatedAt': { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$tasks.updatedAt' } },
              completed: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ];

  const [result] = await getDb().collection('projects').aggregate(pipeline).toArray();
  const taskStats = result.taskStats[0] || { total: 0, completed: 0, avgCompletionTime: 0 };

  res.json({
    success: true,
    data: {
      totalTasks: taskStats.total,
      completedTasks: taskStats.completed,
      completionRate: taskStats.total
        ? Math.round((taskStats.completed / taskStats.total) * 1000) / 10
        : 0,
      avgCompletionTimeMs: taskStats.avgCompletionTime || 0,
      avgCompletionTimeDays: taskStats.avgCompletionTime
        ? Math.round(taskStats.avgCompletionTime / (1000 * 60 * 60 * 24) * 10) / 10
        : 0,
      dailyOutput: result.dailyOutput,
      dateRange: { startDate, endDate },
    },
  });
});

export const exportAnalytics = asyncHandler(async (req, res) => {
  const { workspaceId, format = 'csv' } = req.query;
  if (!workspaceId) throw new AppError('workspaceId is required', 400);

  await ensureWorkspaceAccess(req, workspaceId);

  const pipeline = [
    { $match: { workspaceId: toObjectId(workspaceId), isDeleted: { $ne: true } } },
    { $unwind: { path: '$tasks', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        projectName: '$name',
        projectStatus: '$status',
        taskTitle: '$tasks.title',
        taskStatus: '$tasks.status',
        taskPriority: '$tasks.priority',
        taskDueDate: '$tasks.dueDate',
        taskCreatedAt: '$tasks.createdAt',
      },
    },
  ];

  const rows = await getDb().collection('projects').aggregate(pipeline).toArray();

  if (format === 'json') {
    return res.json({ success: true, data: { rows, exportedAt: new Date() } });
  }

  const headers = ['Project', 'Project Status', 'Task', 'Task Status', 'Priority', 'Due Date', 'Created'];
  const csvRows = [
    headers.join(','),
    ...rows.map((r) =>
      [
        `"${(r.projectName || '').replace(/"/g, '""')}"`,
        r.projectStatus || '',
        `"${(r.taskTitle || '').replace(/"/g, '""')}"`,
        r.taskStatus || '',
        r.taskPriority || '',
        r.taskDueDate ? new Date(r.taskDueDate).toISOString().split('T')[0] : '',
        r.taskCreatedAt ? new Date(r.taskCreatedAt).toISOString().split('T')[0] : '',
      ].join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="analytics-${workspaceId}.csv"`);
  res.send(csvRows.join('\n'));
});
