import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { connectDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed, DEMO } from '../src/seed/seed.js';

export const setup = async () => {
  const mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri('careguide-test'));
  await seed();
  const app = createApp();
  const api = request(app);
  const login = async (name, password) => {
    const res = await api.post('/auth/login').send({ email: name.includes('@') ? name : `${name}@ruhan.lol`, password });
    return res.body.token;
  };
  const tokens = {
    admin: await login(DEMO.admin.name, DEMO.admin.password),
    user: await login(DEMO.user.name, DEMO.user.password),
    karim: await login('karim', 'Karim1234'),
    sara: await login('sara@ruhan.lol', 'Sara1234'),
  };
  const as = (who) => ({
    get: (url) => api.get(url).set('Authorization', `Bearer ${tokens[who]}`),
    post: (url, data) => api.post(url).set('Authorization', `Bearer ${tokens[who]}`).send(data),
    patch: (url, data) => api.patch(url).set('Authorization', `Bearer ${tokens[who]}`).send(data),
    put: (url, data) => api.put(url).set('Authorization', `Bearer ${tokens[who]}`).send(data),
    delete: (url) => api.delete(url).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const teardown = async () => {
    await mongoose.disconnect();
    await mongo.stop();
  };
  return { api, as, tokens, login, teardown };
};
