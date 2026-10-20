export type Dependency = 'linear' | 'twenty' | 'graph' | 'llm';

export class DependencyError extends Error {
  constructor(
    readonly dependency: Dependency,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DependencyError';
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
