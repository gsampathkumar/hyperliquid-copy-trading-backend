import { AsyncLocalStorage } from 'async_hooks';

export const mainStorage = new AsyncLocalStorage<Map<string, any>>();
