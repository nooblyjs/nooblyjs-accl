// The test host: the dev host from src/host/standalone.js on the Express the run asks for (EXPRESS_MAJOR=4 runs
// on Express 4, as the accelerators launcher does; otherwise Express 5), and a stand-in serverManager.
import { EventEmitter } from 'node:events';
import { createStandaloneHost } from '../../src/host/standalone.js';

export { PEOPLE, MATRIX, PERSON_HEADER, PERSON_COOKIE, CSRF_COOKIE, readCookies } from '../../src/host/standalone.js';

export const EXPRESS_MAJOR = process.env.EXPRESS_MAJOR === '4' ? 4 : 5;
export const express = (await import(EXPRESS_MAJOR === 4 ? 'express4' : 'express')).default;

/** createStandaloneHost on this run's Express. */
export const createHost = (options = {}) => createStandaloneHost({ express, ...options });

/** nooblyjs-core's memory queue, as far as accelerators use it: enqueue and dequeue by queue name. */
function memoryQueue() {
  const queues = new Map();
  const q = (name) => (queues.has(name) ? queues.get(name) : queues.set(name, []).get(name));
  return {
    enqueue: async (name, item) => void q(name).push(item),
    dequeue: async (name) => q(name).shift(),
    size: async (name) => q(name).length,
  };
}

/**
 * A stand-in for the initialised nooblyjs-core serverManager: the methods accelerators may call, with a record of
 * the calls. initialize() throws, because only the launcher initialises it.
 */
export function createTestServerManager() {
  const calls = [];
  const lines = [];
  const logger = (name) => Object.fromEntries(['error', 'warn', 'info', 'log', 'debug'].map((level) => [
    level, async (message) => { lines.push({ level, instance: name, message: String(message) }); },
  ]));
  const service = (kind) => (providerType = 'memory', options = {}) => {
    calls.push({ service: kind, providerType, instanceName: options.instanceName ?? 'default' });
    if (kind === 'logging') return logger(options.instanceName ?? 'default');
    if (kind === 'queueing') return memoryQueue();
    return {};
  };
  return {
    initialized: true,
    calls,
    lines,
    initialize() {
      throw new Error('Only the launcher initialises the serverManager.');
    },
    getDefaultProviderType: () => 'memory',
    getEventEmitter: () => new EventEmitter(),
    logger: service('logging'),
    cache: service('caching'),
    queue: service('queueing'),
    scheduling: service('scheduling'),
    notifying: service('notifying'),
    measuring: service('measuring'),
    searching: service('searching'),
  };
}
