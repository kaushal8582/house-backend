import crypto from 'crypto';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { getDb } from '../config/database.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  sanitizeUser,
  generateResetToken,
} from '../utils/helpers.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function generateTokens(user) {
  const payload = {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  return { accessToken, refreshToken };
}

async function ensureDefaultWorkspace(user) {
  let workspaces = await User.getWorkspaces(user._id);
  if (workspaces.length > 0) return workspaces;

  const workspace = await Workspace.create({
    name: `${user.name.trim()}'s Workspace`,
    description: 'Personal workspace',
    ownerId: user._id,
  });
  await User.addToWorkspace(user._id, workspace._id, 'owner');
  return User.getWorkspaces(user._id);
}

function serializeWorkspaces(workspaces) {
  return workspaces.map((w) => ({
    ...w,
    _id: w._id?.toString?.() || w._id,
  }));
}

export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const existingUser = await User.findByEmail(email);
  if (existingUser) {
    throw new AppError('Email already registered', 409);
  }

  const user = await User.create({ name, email, password });

  await ensureDefaultWorkspace(user);

  const { accessToken, refreshToken } = generateTokens(user);

  await User.setRefreshToken(user._id, refreshToken);

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  const isMatch = await User.comparePassword(password, user.password);
  if (!isMatch) {
    throw new AppError('Invalid email or password', 401);
  }

  const { accessToken, refreshToken } = generateTokens(user);
  await User.setRefreshToken(user._id, refreshToken);

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    },
  });
});

export const logout = asyncHandler(async (req, res) => {
  await User.clearRefreshToken(req.user.id);

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

export const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    throw new AppError('Refresh token is required', 400);
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  const user = await User.findById(decoded.id);
  if (!user || user.refreshToken !== token) {
    throw new AppError('Invalid refresh token', 401);
  }

  const tokens = generateTokens(user);
  await User.setRefreshToken(user._id, tokens.refreshToken);

  res.json({
    success: true,
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
  });
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const workspaces = serializeWorkspaces(await ensureDefaultWorkspace(user));

  res.json({
    success: true,
    data: {
      user: sanitizeUser(user),
      workspaces,
    },
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, avatar } = req.body;
  const updateData = {};

  if (name !== undefined) updateData.name = name;
  if (avatar !== undefined) updateData.avatar = avatar;

  if (Object.keys(updateData).length === 0) {
    throw new AppError('No fields to update', 400);
  }

  const result = await User.update(req.user.id, updateData);
  const user = result?.value || result;

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { user: sanitizeUser(user) },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const isMatch = await User.comparePassword(currentPassword, user.password);
  if (!isMatch) {
    throw new AppError('Current password is incorrect', 401);
  }

  await User.updatePassword(req.user.id, newPassword);

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findByEmail(email);

  // Always return success to prevent email enumeration
  if (!user) {
    return res.json({
      success: true,
      message: 'If an account with that email exists, a reset link has been sent.',
    });
  }

  const { token, hashedToken } = generateResetToken();

  await getDb().collection('passwordResetTokens').deleteMany({
    userId: user._id,
  });

  await getDb().collection('passwordResetTokens').insertOne({
    userId: user._id,
    token: hashedToken,
    expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS),
    createdAt: new Date(),
  });

  // In production, send email with reset link containing `token`
  if (process.env.NODE_ENV === 'development') {
    console.log(`Password reset token for ${email}: ${token}`);
  }

  res.json({
    success: true,
    message: 'If an account with that email exists, a reset link has been sent.',
    ...(process.env.NODE_ENV === 'development' && { resetToken: token }),
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const resetRecord = await getDb().collection('passwordResetTokens').findOne({
    token: hashedToken,
    expiresAt: { $gt: new Date() },
  });

  if (!resetRecord) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  await User.updatePassword(resetRecord.userId, password);

  await getDb().collection('passwordResetTokens').deleteMany({
    userId: resetRecord.userId,
  });

  res.json({
    success: true,
    message: 'Password reset successful. You can now log in with your new password.',
  });
});
