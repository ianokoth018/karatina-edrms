// -----------------------------------------------------------------------------
// Structured JSON logger -- zero external dependencies
// -----------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  userId?: string;
  route?: string;
  action?: string;
  method?: string;
  statusCode?: number;
  ip?: string;
  duration?: number;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL =
  LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? LOG_LEVELS.info;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= MIN_LEVEL;
}

function formatLog(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: unknown
) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (context) {
    Object.assign(entry, context);
  }

  if (error) {
    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
      };
    } else {
      entry.error = String(error);
    }
  }

  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (shouldLog("debug")) {
      console.debug(formatLog("debug", message, context));
    }
  },

  info(message: string, context?: LogContext) {
    if (shouldLog("info")) {
      console.info(formatLog("info", message, context));
    }
  },

  warn(message: string, context?: LogContext) {
    if (shouldLog("warn")) {
      console.warn(formatLog("warn", message, context));
    }
  },

  error(message: string, error?: unknown, context?: LogContext) {
    if (shouldLog("error")) {
      console.error(formatLog("error", message, context, error));
    }
  },
};
