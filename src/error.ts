export class DdsError extends Error {
  constructor(public readonly code: number, message: string) {
    super(`DDS error ${code}: ${message}`);
    this.name = 'DdsError';
  }
}
