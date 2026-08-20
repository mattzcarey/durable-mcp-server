import { describe, expect, it } from "vitest";
import { HOME_PATH, parseRoute, routedTaskId, taskPath } from "./route";

describe("parseRoute", () => {
  it("reads the home at the root (and the static index)", () => {
    expect(parseRoute("/")).toEqual({ kind: "home" });
    expect(parseRoute("")).toEqual({ kind: "home" });
    expect(parseRoute("/index.html")).toEqual({ kind: "home" });
    expect(parseRoute(HOME_PATH)).toEqual({ kind: "home" });
  });

  it("reads /task/<id> as that task, trailing slash tolerated", () => {
    expect(parseRoute("/task/3f2c8a54-6b1d")).toEqual({ kind: "task", taskId: "3f2c8a54-6b1d" });
    expect(parseRoute("/task/3f2c8a54-6b1d/")).toEqual({ kind: "task", taskId: "3f2c8a54-6b1d" });
  });

  it("decodes an encoded task id and round-trips with taskPath", () => {
    const odd = "task id/with spaces?&#";
    expect(parseRoute(taskPath(odd))).toEqual({ kind: "task", taskId: odd });
    expect(taskPath("abc")).toBe("/task/abc");
  });

  it("treats anything else as unknown", () => {
    expect(parseRoute("/task")).toEqual({ kind: "unknown" });
    expect(parseRoute("/task/")).toEqual({ kind: "unknown" });
    expect(parseRoute("/task/a/b")).toEqual({ kind: "unknown" });
    expect(parseRoute("/tasks/a")).toEqual({ kind: "unknown" });
    expect(parseRoute("/elsewhere")).toEqual({ kind: "unknown" });
    expect(parseRoute("/task/%E0%A4%A")).toEqual({ kind: "unknown" }); // malformed escape
  });
});

describe("routedTaskId", () => {
  it("names the task of a task route and nothing else", () => {
    expect(routedTaskId({ kind: "task", taskId: "t1" })).toBe("t1");
    expect(routedTaskId({ kind: "home" })).toBeUndefined();
    expect(routedTaskId({ kind: "unknown" })).toBeUndefined();
  });
});
