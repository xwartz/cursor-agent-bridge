export function readArg(name: string, fallback: string | undefined) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith("-"))
    throw new Error(`Missing value for ${name}`)
  return value
}

export function parsePort(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return port
}

export function readHostAndPort(defaultHost = "127.0.0.1", defaultPort = 4646) {
  const host = readArg("--host", process.env.HOST) ?? defaultHost
  const port = parsePort(readArg("--port", process.env.PORT), defaultPort)
  return { host, port }
}
