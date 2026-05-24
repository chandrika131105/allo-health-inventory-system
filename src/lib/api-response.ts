import { NextResponse } from 'next/server';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Returns a standardized 2xx success response.
 */
export function jsonSuccess<T>(data: T, status = 200) {
  const payload: ApiResponse<T> = {
    success: true,
    data,
  };
  return NextResponse.json(payload, { status });
}

/**
 * Returns a standardized error response.
 */
export function jsonError(message: string, code: string, status = 400) {
  const payload: ApiResponse = {
    success: false,
    error: {
      code,
      message,
    },
  };
  return NextResponse.json(payload, { status });
}
