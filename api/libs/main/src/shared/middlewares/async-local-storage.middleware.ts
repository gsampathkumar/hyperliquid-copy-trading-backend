import { v4 as uuid, validate as isUUID } from 'uuid';
import { Request, Response } from 'express';
import { mainStorage } from '../storage/main.storage';

export const asyncLocalStorageMiddleware = (
  req: Request,
  res: Response,
  next: () => void
) => {
  const contextStore = new Map();
  mainStorage.enterWith(contextStore);
  mainStorage.run(contextStore, () => {
    contextStore.set('client', req.header('hyperliquid-api-client'));

    const REQUEST_ID_KEY = 'request_id';
    const providedRequestId = req.header('x-request-id');
    let requestId: string;

    if (providedRequestId) {
      if (!isUUID(providedRequestId)) {
        res.status(400).json({
          statusCode: 400,
          message: 'Invalid x-request-id header: must be a valid UUID format',
          error: 'Bad Request',
        });
        return;
      }
      requestId = providedRequestId;
    } else {
      requestId = uuid();
    }

    contextStore.set(REQUEST_ID_KEY, requestId);
    res.setHeader('X-Request-ID', requestId);

    next();
  });
};
