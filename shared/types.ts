/** Types used by both the browser app and the Worker. Keep this file dependency-free. */

export interface HealthResponse {
  ok: true;
  service: 'sabboura';
  phase: number;
  time: string;
}

export interface ApiErrorResponse {
  error: string;
}
