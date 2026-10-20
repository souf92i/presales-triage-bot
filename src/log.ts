export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => void;

export function createLogger(
  write: (line: string) => void = process.stdout.write.bind(process.stdout),
  clock: () => Date = () => new Date(),
): Logger {
  return (level, msg, fields = {}) => {
    write(`${JSON.stringify({ level, time: clock().toISOString(), msg, ...fields })}\n`);
  };
}
