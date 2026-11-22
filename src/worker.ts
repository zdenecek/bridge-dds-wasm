import { createDds, type Dds } from './dds.js';
import { DdsError } from './error.js';

type Method = 'calcTable' | 'par' | 'sidesPar' | 'analyse' | 'solveBoard' | 'analysePlay';
interface Request { id: number; method: Method; args: unknown[] }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown): void;
};

const ready = createDds();

scope.onmessage = async ({ data: { id, method, args } }) => {
  try {
    const dds = await ready;
    const result = (dds[method] as (...a: unknown[]) => unknown).apply(dds, args);
    scope.postMessage({ id, result });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    scope.postMessage({ id, error: { name: error.name, message: error.message, code: e instanceof DdsError ? e.code : undefined } });
  }
};

export type { Dds };
