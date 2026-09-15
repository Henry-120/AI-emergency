import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

it('skips queries when the native plugin is missing', async () => {
  const health = await import('./healthService');
  expect(await health.initHealthKit()).toBe(false);
  expect(await health.getLatestHeartRate()).toBeNull();
});

it('uses the installed Cordova namespace and waits for authorization', async () => {
  let authorize!: () => void;
  const query = vi.fn((_options, success) => success([{ value: 76.4 }]));
  vi.stubGlobal('cordova', { plugins: { health: {
    isAvailable: (success: (value: boolean) => void) => success(true),
    requestAuthorization: (_types: unknown, success: () => void) => { authorize = success; },
    query,
  } } });
  const health = await import('./healthService');
  const initialization = health.initHealthKit();
  await Promise.resolve();
  expect(await health.getLatestHeartRate()).toBeNull();
  query.mockClear();
  authorize();
  expect(await initialization).toBe(true);
  expect(await health.getLatestHeartRate()).toBe(76);
  expect(query).toHaveBeenCalledTimes(1);
});

it('stops repeatedly querying after a native failure', async () => {
  const query = vi.fn((_options, _success, failure) => failure('plugin_not_installed'));
  vi.stubGlobal('cordova', { plugins: { health: {
    isAvailable: (success: (value: boolean) => void) => success(true),
    requestAuthorization: (_types: unknown, success: () => void) => success(),
    query,
  } } });
  const health = await import('./healthService');
  await health.initHealthKit();
  expect(await health.getLatestHeartRate()).toBeNull();
  expect(await health.getLatestHeartRate()).toBeNull();
  expect(query).toHaveBeenCalledTimes(1);
});

it('passes a nonempty heart-rate read set through the actual iOS plugin', async () => {
  const requestAuthorization = vi.fn((_options, success) => success());
  const cordova = { plugins: {}, addConstructor: (initialize: () => void) => initialize() };
  runInNewContext(readFileSync('node_modules/cordova-plugin-health/www/ios/health.js', 'utf8'), {
    cordova,
    window: { plugins: { healthkit: {
      available: (success: (value: boolean) => void) => success(true),
      requestAuthorization,
    } } },
  });
  vi.stubGlobal('cordova', cordova);
  const health = await import('./healthService');
  expect(await health.initHealthKit()).toBe(true);
  expect(requestAuthorization).toHaveBeenCalledTimes(1);
  expect(requestAuthorization.mock.calls[0][0]).toEqual({
    readTypes: ['HKQuantityTypeIdentifierHeartRate'], writeTypes: [],
  });
});
