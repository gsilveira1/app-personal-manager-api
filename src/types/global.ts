import { type Request as ExpressRequest } from 'express';

export interface RequestWithUser extends ExpressRequest {
  user: {
    userId: string;
    username: string;
    role: string;
  };
}