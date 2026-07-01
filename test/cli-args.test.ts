import { describe, expect, it } from "vitest"
import { parsePort, readArg, readHostAndPort } from "../src/cli-args.js"

describe("cli args", () => {
  it("reads explicit flag values from argv", () => {
    const previous = process.argv
    process.argv = [
      "node",
      "cli.mjs",
      "serve",
      "--host",
      "10.0.0.1",
      "--port",
      "8080",
    ]

    expect(readArg("--host", "127.0.0.1")).toBe("10.0.0.1")
    expect(readArg("--port", "4646")).toBe("8080")
    expect(readArg("--missing", "fallback")).toBe("fallback")

    process.argv = previous
  })

  it("throws when a flag is missing its value", () => {
    const previous = process.argv
    process.argv = ["node", "cli.mjs", "serve", "--port"]

    expect(() => readArg("--port", undefined)).toThrow(
      "Missing value for --port",
    )

    process.argv = previous
  })

  it("parses valid ports and rejects invalid values", () => {
    expect(parsePort("4646", 8080)).toBe(4646)
    expect(parsePort(undefined, 8080)).toBe(8080)
    expect(() => parsePort("nope", 8080)).toThrow("Invalid port: nope")
    expect(() => parsePort("0", 8080)).toThrow("Invalid port: 0")
    expect(() => parsePort("70000", 8080)).toThrow("Invalid port: 70000")
  })

  it("reads host and port from argv with defaults", () => {
    const previousArgv = process.argv
    const previousHost = process.env.HOST
    const previousPort = process.env.PORT
    delete process.env.HOST
    delete process.env.PORT
    process.argv = [
      "node",
      "cli.mjs",
      "doctor",
      "--host",
      "127.0.0.1",
      "--port",
      "4321",
    ]

    expect(readHostAndPort()).toEqual({ host: "127.0.0.1", port: 4321 })

    process.argv = previousArgv
    if (previousHost === undefined) delete process.env.HOST
    else process.env.HOST = previousHost
    if (previousPort === undefined) delete process.env.PORT
    else process.env.PORT = previousPort
  })
})
