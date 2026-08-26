/* eslint-disable @typescript-eslint/no-explicit-any */
export declare const MAINTAINER_ACTIONS: readonly string[];
export declare function classifyWatcherEvent(event?: Record<string, any>): Record<string, any>;
export declare function createIncidentCapsule(input?: Record<string, any>): Record<string, any>;
export declare function registerIncidentAction(
  state?: Record<string, any>,
  event?: Record<string, any>,
): Record<string, any>;
