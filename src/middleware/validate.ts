import { validationResult } from 'express-validator'
import type { Request, Response, NextFunction } from 'express'

export function validate(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: errors.array()[0]?.msg ?? 'Validation failed',
      errors: errors.array(),
    })
    return
  }
  next()
}