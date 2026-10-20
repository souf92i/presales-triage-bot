export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => void;

export function createLogger(
  clock: () => Date,
  write: (line: string) => void = process.stdout.write.bind(process.stdout),
): Logger {
  return (level, msg, fields = {}) => {
    write(`${JSON.stringify({ ...fields, level, time: clock().toISOString(), msg })}\n`);
  };
}
