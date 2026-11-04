import { beforeAll } from "vitest";

beforeAll(() => {
  globalThis.fetch = async () => {
    throw new Error("LiveNetworkBlocked");
  };
});
