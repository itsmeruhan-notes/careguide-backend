export const publicUser = (user, withPrivate = false) => {
  const base = {
    id: String(user._id),
    name: user.name,
    bio: user.bio,
    interests: user.interests,
    role: user.role,
    createdAt: user.createdAt,
  };
  if (!withPrivate) return base;
  return {
    ...base,
    email: user.email,
    status: user.status,
    isDemo: user.isDemo,
    updatedAt: user.updatedAt,
    createdBy: user.createdBy,
    createdByName: user.createdByName,
    updatedBy: user.updatedBy,
    updatedByName: user.updatedByName,
  };
};

export const accessFor = (note, user) => {
  if (String(note.owner) === String(user._id)) return 'owner';
  const share = (note.sharedWith || []).find((s) => String(s.userId) === String(user._id));
  if (share) return share.access;
  if (user.role === 'admin') return 'admin';
  return null;
};

export const noteView = (note, access) => ({
  id: String(note._id),
  title: note.title,
  content: note.content,
  owner: { id: String(note.owner), name: note.ownerName, email: note.ownerEmail },
  sharedWith: (note.sharedWith || []).map((s) => ({
    userId: String(s.userId),
    name: s.name,
    email: s.email,
    access: s.access,
    sharedAt: s.sharedAt,
  })),
  access,
  revision: (note.history || []).length,
  status: note.status,
  createdAt: note.createdAt,
  createdByName: note.createdByName,
  updatedAt: note.updatedAt,
  updatedByName: note.updatedByName,
});

export const postView = (post) => ({
  id: String(post._id),
  title: post.title,
  body: post.body,
  author: { id: String(post.author), name: post.authorName, role: post.authorRole },
  tags: post.tags || [],
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
});
