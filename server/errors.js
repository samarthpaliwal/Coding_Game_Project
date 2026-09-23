// Errors that become {t:'error', code, message} replies to the client.
export class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
