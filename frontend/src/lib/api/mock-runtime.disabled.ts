/** Stand-in for mock-runtime.ts in http-mode builds: no mock code or fixtures are bundled. */
export const createMockRuntime: typeof import("./mock-runtime").createMockRuntime | null = null;
