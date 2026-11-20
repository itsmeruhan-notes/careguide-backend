import { z } from 'zod';
import { badRequest } from './http.js';
import { config } from '../config.js';

export const toEmail = (nickname) => `${nickname}@${config.emailDomain}`;
const name = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'Nickname must be 3–30 characters: letters, numbers, . _ -');
const loginId = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Nickname is required')
  .max(120)
  .transform((v) => (v.includes('@') ? v : toEmail(v)));
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Password needs at least one letter')
  .regex(/[0-9]/, 'Password needs at least one number');
const interests = z
  .array(z.string().trim().toLowerCase().min(2, 'Each interest must be 2–30 characters').max(30, 'Each interest must be 2–30 characters'))
  .max(10, 'Up to 10 interests')
  .transform((list) => [...new Set(list)]);
const role = z.enum(['user', 'admin']);
const status = z.enum(['active', 'deleted']);

export const schemas = {
  register: z.object({ name, password, interests: interests.optional() }),
  login: z.object({ email: loginId, password: z.string().min(1, 'Password is required') }),
  updateMe: z.object({ bio: z.string().trim().max(200).optional(), interests: interests.optional() }),
  changePassword: z.object({ currentPassword: z.string().min(1, 'Current password is required'), newPassword: password }),
  noteCreate: z.object({
    title: z.string().trim().min(1, 'Give your note a title').max(120),
    content: z.string().max(20000).optional().default(''),
  }),
  noteUpdate: z
    .object({ title: z.string().trim().min(1, 'Give your note a title').max(120).optional(), content: z.string().max(20000).optional() })
    .refine((v) => v.title !== undefined || v.content !== undefined, 'Nothing to update'),
  share: z.object({ email: loginId, access: z.enum(['read', 'write']) }),
  postCreate: z.object({
    title: z.string().trim().min(1, 'Title is required').max(120),
    body: z.string().trim().min(1, 'Body is required').max(5000),
  }),
  adminCreateUser: z.object({ name, password, role: role.default('user'), interests: interests.optional(), bio: z.string().trim().max(200).optional() }),
  adminUpdateUser: z.object({
    role: role.optional(),
    status: status.optional(),
    interests: interests.optional(),
    bio: z.string().trim().max(200).optional(),
    password: password.optional(),
  }),
};

export const parse = (schema, data) => {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw badRequest(Object.values(fields)[0] || 'Invalid input', fields);
};
