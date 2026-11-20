import { User } from './models/User.js';

export const groupByInterestsPipeline = ({ interests = [], sort = 'count', skip = 0, limit = 10, membersPerGroup = 50 }) => {
  const match = interests.length ? { interests: { $in: interests }, status: 'active' } : { interests: { $gte: '' }, status: 'active' };
  const pipeline = [{ $match: match }, { $project: { name: 1, interests: 1 } }, { $unwind: '$interests' }];
  if (interests.length) pipeline.push({ $match: { interests: { $in: interests } } });
  pipeline.push(
    { $group: { _id: '$interests', count: { $sum: 1 }, members: { $push: { id: '$_id', name: '$name' } } } },
    { $sort: sort === 'name' ? { _id: 1 } : { count: -1, _id: 1 } },
    {
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limit },
          { $project: { _id: 0, interest: '$_id', count: 1, members: { $slice: ['$members', membersPerGroup] } } },
        ],
        total: [{ $count: 'n' }],
      },
    },
  );
  return pipeline;
};

export const userPostsPipeline = (userId, { skip = 0, limit = 10 }) => [
  { $match: { _id: userId, status: 'active' } },
  {
    $lookup: {
      from: 'posts',
      localField: '_id',
      foreignField: 'author',
      pipeline: [
        { $match: { status: 'active' } },
        { $sort: { _id: -1 } },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }, { $project: { title: 1, body: 1, createdAt: 1, updatedAt: 1 } }],
            total: [{ $count: 'n' }],
          },
        },
      ],
      as: 'posts',
    },
  },
  { $project: { name: 1, bio: 1, interests: 1, role: 1, createdAt: 1, posts: { $first: '$posts' } } },
];

export const groupByInterests = async (opts) => {
  const [result] = await User.aggregate(groupByInterestsPipeline(opts));
  return { data: result.data, total: result.total[0]?.n || 0 };
};
