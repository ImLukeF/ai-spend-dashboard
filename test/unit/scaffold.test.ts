import { expect, it } from "vitest";
import worker from "../../src/worker";

it("has no unauthenticated data endpoint", () => expect(worker.fetch().status).toBe(404));
