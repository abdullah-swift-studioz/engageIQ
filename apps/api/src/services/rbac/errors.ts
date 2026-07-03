/**
 * Typed application error for the RBAC / agency services. The route controllers
 * read `statusCode` + `code` to build the standard error envelope
 * ({ success:false, error:{ code, message } }).
 */
export interface AppError extends Error {
  statusCode: number
  code: string
}

export function appError(statusCode: number, code: string, message: string): AppError {
  const err = new Error(message) as AppError
  err.statusCode = statusCode
  err.code = code
  return err
}

export function isAppError(err: unknown): err is AppError {
  return (
    err instanceof Error &&
    typeof (err as AppError).statusCode === 'number' &&
    typeof (err as AppError).code === 'string'
  )
}
