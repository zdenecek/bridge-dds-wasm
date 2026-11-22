import type { Dds } from './dds.js';
import { DdsError } from './error.js';

type Method = 'calcTable' | 'par' | 'sidesPar' | 'analyse' | 'solveBoard' | 'analysePlay';

/** The `Dds` methods, run in a Web Worker and returning promises. */
export type DdsWorker = {
  [K in Method]: (...args: Parameters<Dds[K]>) => Promise<ReturnType<Dds[K]>>;
} & { terminate(): void };

interface Reply { id: number; result?: unknown; error?: { name: string; message: string; code?: number } }

/**
 * Runs the solver in a worker. Without an argument it starts the worker that ships
 * with the package, which Vite and webpack bundle on their own. Pass a worker to
 * load it some other way.
 */
export function connectDdsWorker(worker?: Worker): DdsWorker {
  const w = worker ?? new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve(value: unknown): void; reject(reason: unknown): void }>();
  let nextId = 0;

  w.addEventListener('message', (event: MessageEvent<Reply>) => {
    const { id, result, error } = event.data;
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (!error) return call.resolve(result);
    if (error.code !== undefined) return call.reject(Object.assign(new DdsError(error.code, ''), { message: error.message }));
    call.reject(Object.assign(new Error(error.message), { name: error.name }));
  });
  w.addEventListener('error', (event) => {
    for (const call of pending.values()) call.reject(event.error ?? new Error(event.message));
    pending.clear();
  });

  const call = (method: Method) => (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, method, args });
    });

  return {
    calcTable: call('calcTable'),
    par: call('par'),
    sidesPar: call('sidesPar'),
    analyse: call('analyse'),
    solveBoard: call('solveBoard'),
    analysePlay: call('analysePlay'),
    terminate: () => w.terminate(),
  } as DdsWorker;
}
