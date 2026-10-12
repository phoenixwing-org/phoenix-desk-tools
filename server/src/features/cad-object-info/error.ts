export class CadObjectInfoError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
